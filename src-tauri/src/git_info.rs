//! git 子命令执行与 worktree 列表解析（左栏工作区树与会话归属共用）。
//!
//! 为什么走 git CLI 而不是自己解析 `.git`：worktree、packed-refs、submodule 的
//! 指针文件细节太多。CLI 缺失、目录不是仓库、命令超时一律降级（空表 / 错误原文），
//! 不阻断界面。
//!
//! 解析逻辑是纯函数（见文末单测），进程调用只负责喂字符串。

use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::Duration;

/// 单条 git 查询超时：大仓库 `status` 可能很慢，超时按未知降级，不卡 UI。
const GIT_TIMEOUT: Duration = Duration::from_secs(4);
/// 登录 shell 探测超时（-ilc 要跑一遍 rc，单独给宽一点）。
const SHELL_TIMEOUT: Duration = Duration::from_secs(5);
/// 跑一条 git 子命令：失败返回 stderr 文本（调用方决定是降级还是当作正常分支缺失）。
pub(crate) async fn run_git(git: &str, dir: &str, args: &[&str]) -> Result<String, String> {
    run_git_timeout(git, dir, args, GIT_TIMEOUT).await
}

/// 同 [`run_git`]，但可指定超时：大仓库的 `status` / `add` / `commit` 这类天然可能
/// 超过 4s 的命令要用更宽的超时（否则好的操作被误判成失败）。
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
}
