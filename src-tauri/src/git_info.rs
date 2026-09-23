//! git 上下文**只读**读取：当前分支 / 本地分支清单 / 工作区是否有未提交改动。
//!
//! 为什么走 git CLI 而不是自己解析 `.git`：worktree、packed-refs、submodule 的
//! 指针文件细节太多，而且「有没有未提交改动」根本读文件读不出来。CLI 缺失、目录
//! 不是仓库、命令超时，一律降级（`isRepo:false` / `dirty:null`）——输入框上方的
//! 这一行永远只是上下文提示，绝不阻断输入与发送。
//!
//! 所有解析逻辑都是纯函数（见文末单测），进程调用只负责喂字符串。

use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

/// 单条 git 查询超时：大仓库 `status` 可能很慢，超时按未知降级，不卡 UI。
const GIT_TIMEOUT: Duration = Duration::from_secs(4);
/// 登录 shell 探测超时（-ilc 要跑一遍 rc，单独给宽一点）。
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);
/// 本地分支清单上限：只读展示，不做无限清单。
const MAX_BRANCHES: usize = 200;

#[derive(Debug, Clone, Serialize)]
pub struct GitInfo {
    /// 是否在 git 工作区内（false = 非仓库 / git 不可用，前端据此隐藏分支展示）。
    #[serde(rename = "isRepo")]
    pub is_repo: bool,
    /// 当前分支名；detached HEAD 时为短 sha；未知为 null。
    pub branch: Option<String>,
    /// 是否 detached HEAD（前端追加「游离」提示）。
    pub detached: bool,
    /// 本地分支清单（当前分支置顶，其余按最近提交倒序）。
    pub branches: Vec<String>,
    /// 工作区是否有已跟踪文件的改动；null = 未检测 / 超时。
    pub dirty: Option<bool>,
    /// 远端默认分支的本地跟踪名（如 `origin/main`）；没有远端 / 查不到为 null。
    /// 新建 worktree 时「基于远端最新」这一档用它做基线。
    #[serde(rename = "remoteDefault")]
    pub remote_default: Option<String>,
    /// 非仓库 / 命令失败的原因（只用于 tooltip 与日志，不弹窗）。
    pub error: Option<String>,
}

impl GitInfo {
    /// 降级值：非仓库、目录缺失、找不到 git 都走这里。
    pub fn not_repo(error: Option<String>) -> Self {
        Self {
            is_repo: false,
            branch: None,
            detached: false,
            branches: vec![],
            dirty: None,
            remote_default: None,
            error,
        }
    }
}

/// 解析 `git symbolic-ref -q --short HEAD`：detached HEAD 时无输出 → None。
pub fn parse_branch_name(out: &str) -> Option<String> {
    let t = out.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// 解析 `git for-each-ref --format=%(refname:short) refs/heads`：
/// 去空行、去重（保序）、当前分支置顶、截断到 [`MAX_BRANCHES`]。
pub fn parse_branches(out: &str, current: Option<&str>) -> Vec<String> {
    let mut list: Vec<String> = vec![];
    for line in out.lines().map(str::trim).filter(|l| !l.is_empty()) {
        let name = line.to_string();
        if !list.contains(&name) {
            list.push(name);
        }
    }
    if let Some(cur) = current {
        if let Some(pos) = list.iter().position(|b| b == cur) {
            let head = list.remove(pos);
            list.insert(0, head);
        }
    }
    list.truncate(MAX_BRANCHES);
    list
}

/// 解析 `git status --porcelain --untracked-files=no`：任一行非空即有改动。
/// 只统计已跟踪文件，未跟踪文件不扫（大仓库里这步最慢）。
pub fn parse_dirty(out: &str) -> bool {
    out.lines().any(|l| !l.trim().is_empty())
}

/// 解析 `git rev-parse --short HEAD`（detached HEAD 的展示名）。
pub fn parse_short_sha(out: &str) -> Option<String> {
    let t = out.trim();
    if t.is_empty() {
        None
    } else {
        Some(t.to_string())
    }
}

/// 跑一条 git 子命令：失败返回 stderr 文本（调用方决定是降级还是当作正常分支缺失）。
pub(crate) async fn run_git(git: &str, dir: &str, args: &[&str]) -> Result<String, String> {
    run_git_timeout(git, dir, args, GIT_TIMEOUT).await
}

/// 同 [`run_git`]，但可指定超时：`fetch` / 大仓库的 `status` / `worktree remove` 这类
/// 天然可能超过 4s 的命令要用更宽的超时（否则好的操作被误判成失败）。
pub(crate) async fn run_git_timeout(
    git: &str,
    dir: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<String, String> {
    let fut = tokio::process::Command::new(git)
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .stdin(Stdio::null())
        .output();
    match tokio::time::timeout(timeout, fut).await {
        Err(_) => Err("git 命令超时".into()),
        Ok(Err(e)) => Err(e.to_string()),
        Ok(Ok(out)) if out.status.success() => Ok(String::from_utf8_lossy(&out.stdout).to_string()),
        Ok(Ok(out)) => {
            let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Err(if err.is_empty() { "git 命令失败".into() } else { err })
        }
    }
}

/// 读取一个目录的 git 上下文。目录不存在 / 非仓库 / git 不可用都返回降级值，不抛错。
pub async fn read_git_info(git: &str, dir: &str) -> GitInfo {
    // 1) 是不是工作区：`rev-parse --is-inside-work-tree` 输出 true 才算
    match run_git(git, dir, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(out) if out.trim() == "true" => {}
        Ok(_) => return GitInfo::not_repo(None),
        Err(e) => return GitInfo::not_repo(Some(e)),
    }
    // 2) 当前分支：detached HEAD 时 symbolic-ref 退出码非 0，属正常情况
    let mut branch = match run_git(git, dir, &["symbolic-ref", "-q", "--short", "HEAD"]).await {
        Ok(out) => parse_branch_name(&out),
        Err(_) => None,
    };
    // 3) detached（或无提交）时用短 sha 顶替分支名，拿不到就只留「游离」标记
    let detached = branch.is_none();
    if detached {
        branch = run_git(git, dir, &["rev-parse", "--short", "HEAD"])
            .await
            .ok()
            .and_then(|out| parse_short_sha(&out));
    }
    // 4) 本地分支清单：按最近提交倒序，当前分支由 parse_branches 置顶
    let branches = run_git(
        git,
        dir,
        &["for-each-ref", "--sort=-committerdate", "--format=%(refname:short)", "refs/heads"],
    )
    .await
    .map(|out| parse_branches(&out, branch.as_deref()))
    .unwrap_or_default();
    // 5) 脏工作区标记（只读提示：有未提交改动时切分支会带着改动走）
    let dirty = run_git(git, dir, &["status", "--porcelain", "--untracked-files=no"])
        .await
        .ok()
        .map(|out| parse_dirty(&out));
    // 6) 远端默认分支的本地跟踪名（`origin/HEAD` 是 git 在 clone / remote set-head 时写的符号引用）
    let remote_default = run_git(git, dir, &["symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD"])
        .await
        .ok()
        .map(|out| out.trim().to_string())
        .filter(|s| !s.is_empty());
    GitInfo { is_repo: true, branch, detached, branches, dirty, remote_default, error: None }
}

/// 探测结果缓存：git 路径一次解析，后续命令零开销（首次可能要走登录 shell，约百毫秒）。
static GIT_BIN: OnceLock<Option<String>> = OnceLock::new();

async fn probe_git(candidate: &str) -> bool {
    let fut = tokio::process::Command::new(candidate)
        .arg("--version")
        .stdin(Stdio::null())
        .output();
    matches!(tokio::time::timeout(SHELL_TIMEOUT, fut).await, Ok(Ok(o)) if o.status.success())
}

/// 解析 git 可执行文件：PATH → 登录 shell `command -v git` → 常见绝对路径（含 Homebrew）。
/// GUI 应用（macOS .app）的 PATH 只有 launchd 默认值，必须带 shell 兜底。
pub async fn git_bin() -> Option<String> {
    if let Some(hit) = GIT_BIN.get() {
        return hit.clone();
    }
    let mut candidates: Vec<String> = vec!["git".into()];
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let fut = tokio::process::Command::new(&shell)
        .args(["-ilc", "command -v git"])
        .stdin(Stdio::null())
        .output();
    if let Ok(Ok(out)) = tokio::time::timeout(SHELL_TIMEOUT, fut).await {
        if out.status.success() {
            if let Some(found) = String::from_utf8_lossy(&out.stdout)
                .lines()
                .map(str::trim)
                .filter(|l| l.starts_with('/'))
                .next_back()
            {
                candidates.push(found.to_string());
            }
        }
    }
    for c in ["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"] {
        candidates.push(c.to_string());
    }
    let mut found = None;
    for c in candidates {
        if probe_git(&c).await {
            found = Some(c);
            break;
        }
    }
    let _ = GIT_BIN.set(found.clone());
    found
}

/// 目录存在性预检：不存在直接降级，不白跑 5 条 git 命令。
pub fn dir_exists(dir: &str) -> bool {
    Path::new(dir).is_dir()
}

/// 一个 git worktree（`git worktree list --porcelain` 的解析结果）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorktreeEntry {
    pub path: String,
    pub branch: Option<String>,
    pub head: Option<String>,
    /// 主 worktree（= 仓库主目录；porcelain 输出第一块，git 的约定）。
    pub main: bool,
}

/// 解析 `git worktree list --porcelain`：
/// 每块以 `worktree <path>` 开头，随后 `HEAD <sha>`、`branch refs/heads/<name>`
/// （detached 时无 branch 行）、可选 `bare` / `locked` / `prunable`；块间空行。
pub fn parse_worktrees(out: &str) -> Vec<WorktreeEntry> {
    let mut list: Vec<WorktreeEntry> = vec![];
    for line in out.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            continue;
        }
        if let Some(p) = line.strip_prefix("worktree ") {
            list.push(WorktreeEntry {
                path: p.trim().to_string(),
                branch: None,
                head: None,
                main: list.is_empty(),
            });
            continue;
        }
        let Some(last) = list.last_mut() else { continue };
        if let Some(h) = line.strip_prefix("HEAD ") {
            last.head = Some(h.trim().to_string());
        } else if let Some(b) = line.strip_prefix("branch refs/heads/") {
            last.branch = Some(b.trim().to_string());
        }
    }
    list
}

/// 列出一个仓库的全部 worktree（含主目录）。非仓库 / git 不可用返回空表——
/// 调用方按「只有主目录」处理，不做特殊错误态。
pub async fn list_worktrees(git: &str, dir: &str) -> Vec<WorktreeEntry> {
    match run_git(git, dir, &["worktree", "list", "--porcelain"]).await {
        Ok(out) => parse_worktrees(&out),
        Err(_) => vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn branch_name_trimmed_or_none() {
        assert_eq!(parse_branch_name("main\n"), Some("main".into()));
        assert_eq!(parse_branch_name("  feature/x  "), Some("feature/x".into()));
        assert_eq!(parse_branch_name("\n"), None);
        assert_eq!(parse_branch_name(""), None);
    }

    #[test]
    fn branches_put_current_first_and_dedup() {
        let out = "dev\ndev_0907\nmain\ndev\n";
        assert_eq!(parse_branches(out, Some("main")), vec!["main", "dev", "dev_0907"]);
        // 当前分支不在清单里（detached 短 sha）时保持原顺序
        assert_eq!(parse_branches("a\nb", Some("abc1234")), vec!["a", "b"]);
        assert_eq!(parse_branches("", Some("main")), Vec::<String>::new());
    }

    #[test]
    fn branches_are_capped() {
        let out = (0..MAX_BRANCHES + 20).map(|i| format!("b{i}")).collect::<Vec<_>>().join("\n");
        assert_eq!(parse_branches(&out, None).len(), MAX_BRANCHES);
    }

    #[test]
    fn dirty_only_counts_real_lines() {
        assert!(!parse_dirty(""));
        assert!(!parse_dirty("\n  \n"));
        assert!(parse_dirty(" M src/main.rs\n"));
    }

    #[test]
    fn short_sha_parsed_or_none() {
        assert_eq!(parse_short_sha("1a2b3c4\n"), Some("1a2b3c4".into()));
        assert_eq!(parse_short_sha(" \n"), None);
    }

    #[test]
    fn not_repo_keeps_reason() {
        let info = GitInfo::not_repo(Some("fatal: not a git repository".into()));
        assert!(!info.is_repo);
        assert!(info.branch.is_none());
        assert!(info.dirty.is_none());
        assert_eq!(info.error.as_deref(), Some("fatal: not a git repository"));
    }

    #[test]
    fn dir_exists_matches_filesystem() {
        assert!(dir_exists("."));
        assert!(!dir_exists("/no/such/dir/omp-mini"));
    }

    #[test]
    fn parse_worktrees_reads_blocks() {
        let out = "\
worktree /repo
HEAD 1a2b3c4d
branch refs/heads/main

worktree /repo.wt/feat
HEAD 5e6f7a8b
branch refs/heads/feat/x

";
        let list = parse_worktrees(out);
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].path, "/repo");
        assert_eq!(list[0].branch.as_deref(), Some("main"));
        assert!(list[0].main, "第一块是主 worktree");
        assert_eq!(list[1].path, "/repo.wt/feat");
        assert_eq!(list[1].branch.as_deref(), Some("feat/x"), "分支名保留斜杠");
        assert!(!list[1].main);
    }

    #[test]
    fn parse_worktrees_detached_and_extras() {
        let out = "\
worktree /repo
HEAD 1a2b3c4d
branch refs/heads/main
locked reason

worktree /repo.wt/det
HEAD 5e6f7a8b
detached
prunable gitdir file points to non-existent location

";
        let list = parse_worktrees(out);
        assert_eq!(list.len(), 2);
        assert_eq!(list[1].branch, None, "detached 块没有分支行");
        assert_eq!(list[1].head.as_deref(), Some("5e6f7a8b"));
        assert_eq!(parse_worktrees(""), vec![]);
        assert_eq!(parse_worktrees("garbage line\n").len(), 0, "没有 worktree 块就不产出行");
    }

    /// 真实仓库：`git worktree add` 后 list 能同时看到主目录与新增 worktree。
    /// CI 上没装 git 时静默跳过。
    #[tokio::test]
    async fn list_worktrees_reads_a_real_repository() {
        let Some(git) = git_bin().await else { return };
        let base = std::env::temp_dir().join(format!("omp-mini-wt-{}", std::process::id()));
        let dir = base.join("repo");
        let wt = base.join("repo.wt");
        let _ = std::fs::remove_dir_all(&base);
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().to_string();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "omp-mini-test"],
        ] {
            run_git(&git, &d, &args).await.unwrap();
        }
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        run_git(&git, &d, &["add", "a.txt"]).await.unwrap();
        run_git(&git, &d, &["commit", "-qm", "init"]).await.unwrap();

        // 非仓库目录：空表而不是报错
        let plain = base.join("plain");
        std::fs::create_dir_all(&plain).unwrap();
        assert!(list_worktrees(&git, &plain.to_string_lossy()).await.is_empty());

        let wt_s = wt.to_string_lossy().to_string();
        run_git(&git, &d, &["worktree", "add", "-q", "-b", "feat-wt", &wt_s]).await.unwrap();
        let list = list_worktrees(&git, &d).await;
        assert_eq!(list.len(), 2, "主目录 + 新 worktree：{list:?}");
        assert!(list[0].main);
        assert_eq!(list[1].branch.as_deref(), Some("feat-wt"));
        assert!(list[1].path.ends_with("repo.wt"), "worktree 路径：{:?}", list[1].path);

        let _ = std::fs::remove_dir_all(&base);
    }

    /// 真实仓库端到端：非仓库降级 → init/commit 后认分支 → 改动文件后判脏。
    /// CI 上没装 git 时静默跳过（返回 None 即视为环境不具备）。
    #[tokio::test]
    async fn reads_a_real_repository() {
        let Some(git) = git_bin().await else { return };
        let dir = std::env::temp_dir().join(format!("omp-mini-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let d = dir.to_string_lossy().to_string();

        // 普通目录：整体降级，不报错
        let plain = read_git_info(&git, &d).await;
        assert!(!plain.is_repo);
        assert!(plain.branch.is_none());

        for args in [
            vec!["init", "-q"],
            vec!["config", "user.email", "test@example.com"],
            vec!["config", "user.name", "omp-mini-test"],
        ] {
            run_git(&git, &d, &args).await.unwrap();
        }
        std::fs::write(dir.join("a.txt"), "a").unwrap();
        run_git(&git, &d, &["add", "a.txt"]).await.unwrap();
        run_git(&git, &d, &["commit", "-qm", "init"]).await.unwrap();

        let clean = read_git_info(&git, &d).await;
        assert!(clean.is_repo);
        assert!(!clean.detached);
        let branch = clean.branch.clone().expect("有提交后应能读出分支名");
        assert!(clean.branches.contains(&branch), "当前分支必须在清单里");
        assert_eq!(clean.dirty, Some(false));

        // 改动已跟踪文件 → 脏工作区
        std::fs::write(dir.join("a.txt"), "b").unwrap();
        assert_eq!(read_git_info(&git, &d).await.dirty, Some(true));

        // detached HEAD → 用短 sha 顶替分支名并标记游离
        run_git(&git, &d, &["checkout", "-q", "--detach", "HEAD"]).await.unwrap();
        let detached = read_git_info(&git, &d).await;
        assert!(detached.detached);
        assert!(detached.branch.is_some());

        let _ = std::fs::remove_dir_all(&dir);
    }
}
