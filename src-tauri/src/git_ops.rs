//! 壳侧 git 写操作（V19）：变更集读取、勾选 → 暂存区同步、worktree 生命周期。
//!
//! 分工（V19 起）：**git 的写操作由壳侧用 git CLI 直接做**——快、可预期、错误就是 git
//! 原文；`omp` 只负责「用哪个模型、怎么出提交信息」（见 `commit_msg.rs`）以及它自己的
//! worktree 命名约定（创建仍走 `omp worktree add`）。这替代了 V14「壳只做编排、不碰
//! git index 语义」的口径，理由就是速度与可控性（V14 每次提交要跑完整条 `omp commit`
//! agent 流水线，实测 16–35s）。
//!
//! 本模块只放「读状态 / 建参数 / 解析输出」的纯函数（全部带单测）与少量 git 调用；
//! 提交 / 推送的**任务编排**在 `git_commit.rs`。

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use serde::Serialize;
use tauri::State;

use crate::commands::{cmd_err, AppState, CmdError};
use crate::git_info::{dir_exists, git_bin, list_worktrees, run_git, run_git_timeout};

/// 变更集里一个文件的上限保护：超大仓库不把整表塞给前端（够用且不卡界面）。
const MAX_CHANGE_FILES: usize = 2000;
/// 大仓库里可能偏慢的 git 操作（status / add / worktree remove）：给 30s，超时才报失败。
/// 只读的行徽章那条链路仍用 `git_info::GIT_TIMEOUT`（4s）——那是背景刷新，慢就降级。
const SLOW: Duration = Duration::from_secs(30);
/// `git fetch` 要走网络，单独给宽一点。
const FETCH_TIMEOUT: Duration = Duration::from_secs(120);

// ---------- 类型（与前端 `shared/types.ts` 同构） ----------

/// 一个待提交的文件（`git status --porcelain=v1 -z` 一行 + numstat 的增删行数）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeFile {
    /// 相对仓库根（porcelain 原样）。
    pub path: String,
    /// 重命名 / 复制时的原名（porcelain `-z` 的第二段；`-z` 下 git 把顺序反了过来：
    /// `from -> to` 变成 `to from`，所以第一段才是当前路径）。
    pub orig_path: Option<String>,
    /// `XY` 的 X（暂存区态）：`M` / `A` / `D` / `R` / `?`（未跟踪时两位都是 `?`）。
    pub index: String,
    /// `XY` 的 Y（工作区态）。
    pub worktree: String,
    /// `??` 未跟踪文件。
    pub untracked: bool,
    /// 已跟踪改动的 +N（未跟踪恒 0；二进制文件也是 0）。
    pub add: u32,
    /// 已跟踪改动的 -M。
    pub del: u32,
}

/// 一个工作区的完整变更视图（面板打开时取一次）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSet {
    pub is_repo: bool,
    /// 当前分支；detached / 无提交时为 None。
    pub branch: Option<String>,
    /// detached 时的短 sha（用于展示「游离」）。
    pub head: Option<String>,
    pub upstream: Option<String>,
    pub upstream_gone: bool,
    pub ahead: u32,
    pub behind: u32,
    pub files: Vec<ChangeFile>,
}

impl ChangeSet {
    fn not_repo() -> Self {
        Self {
            is_repo: false,
            branch: None,
            head: None,
            upstream: None,
            upstream_gone: false,
            ahead: 0,
            behind: 0,
            files: vec![],
        }
    }
}

/// `omp worktree list --json` 里的孤儿条目（目录还在，但已经不是活 worktree）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanWorktree {
    pub path: String,
    pub kind: Option<String>,
    pub parent_repo: Option<String>,
    pub orphan_reason: String,
}

/// `omp worktree clear --json` 的结果。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrphanClearResult {
    pub removed: u32,
    pub failed: u32,
}

// ---------- 纯函数（全部带单测） ----------

/// 解析 `git diff --numstat -z`（路径 → (增, 删)）。
///
/// 普通条目是一段 `add\tdel\tpath`；改名条目的路径字段为空、后跟两段名字。
/// **不对这两段的顺序做假设**：两段都登记进同一张表，查表时任一段命中即可。
pub fn parse_numstat_z(out: &str) -> HashMap<String, (u32, u32)> {
    let mut map: HashMap<String, (u32, u32)> = HashMap::new();
    let tokens: Vec<&str> = out.split('\0').collect();
    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        if token.is_empty() {
            i += 1;
            continue;
        }
        let mut parts = token.splitn(3, '\t');
        let (Some(add), Some(del), path) = (parts.next(), parts.next(), parts.next()) else {
            i += 1;
            continue;
        };
        // `-` 是二进制文件；解析不出来按 0（只影响展示的数字）
        let nums = (add.trim().parse().unwrap_or(0), del.trim().parse().unwrap_or(0));
        match path {
            Some(p) if !p.is_empty() => {
                map.insert(p.to_string(), nums);
            }
            // 改名 / 复制：接下来两段是（新名 / 原名，顺序不假设）
            _ => {
                for extra in tokens.iter().skip(i + 1).take(2) {
                    if !extra.is_empty() {
                        map.insert((*extra).to_string(), nums);
                    }
                }
                i += 2;
            }
        }
        i += 1;
    }
    map
}

/// 解析 `git status --porcelain=v1 -z`：NUL 分隔，条目形如 `XY path`；
/// `R` / `C` 条目再多一段原名。头段（`## …`）由调用方先摘掉，这里遇到也跳过。
pub fn parse_status_porcelain_z(out: &str, numstat: &str) -> Vec<ChangeFile> {
    let nums = parse_numstat_z(numstat);
    let tokens: Vec<&str> = out.split('\0').collect();
    let mut files: Vec<ChangeFile> = vec![];
    let mut i = 0;
    while i < tokens.len() && files.len() < MAX_CHANGE_FILES {
        let token = tokens[i];
        if token.is_empty() || token.starts_with("## ") {
            i += 1;
            continue;
        }
        let bytes = token.as_bytes();
        if bytes.len() < 3 {
            i += 1;
            continue;
        }
        let (x, y) = (bytes[0] as char, bytes[1] as char);
        // 前两字节是 ASCII 状态位 + 一个空格，索引 3 一定是字符边界
        let path = token[3..].to_string();
        let renamed = x == 'R' || x == 'C' || y == 'R' || y == 'C';
        let orig_path = if renamed {
            let next = tokens.get(i + 1).map(|s| s.to_string()).filter(|s| !s.is_empty());
            i += 1;
            next
        } else {
            None
        };
        let untracked = x == '?' && y == '?';
        let (add, del) = if untracked {
            (0, 0)
        } else {
            nums.get(&path)
                .or_else(|| orig_path.as_ref().and_then(|o| nums.get(o)))
                .copied()
                .unwrap_or((0, 0))
        };
        files.push(ChangeFile {
            path,
            orig_path,
            index: x.to_string(),
            worktree: y.to_string(),
            untracked,
            add,
            del,
        });
        i += 1;
    }
    files
}

/// 摘出 `git status --porcelain=v1 -b -z` 的头段（`## …`）；没有则返回空串。
pub fn split_status_header_z(out: &str) -> (&str, &str) {
    match out.split_once('\0') {
        Some((first, rest)) if first.starts_with("## ") => (first, rest),
        _ => ("", out),
    }
}

/// 勾选 → 暂存区的动作计划：返回 `(要 add 的, 要 unstage 的)`。
///
/// `to_add` = 选中集里的全部（幂等，直接全量 `add -A`）；`to_unstage` = 已暂存但**未**选中的。
pub fn stage_plan(selected: &[String], staged: &[String]) -> (Vec<String>, Vec<String>) {
    let to_add = selected.to_vec();
    let to_unstage: Vec<String> = staged
        .iter()
        .filter(|p| !selected.iter().any(|s| s == *p))
        .cloned()
        .collect();
    (to_add, to_unstage)
}

/// 取消暂存的参数：有 HEAD 走 `restore --staged`；空仓库（首个提交前）没有 HEAD，
/// `restore --staged` 会失败，改用 `rm --cached --force`（把新增文件退回未跟踪）。
pub fn unstage_args(has_head: bool, paths: &[String]) -> Vec<String> {
    let mut args: Vec<String> = if has_head {
        vec!["restore".into(), "--staged".into(), "--".into()]
    } else {
        vec!["rm".into(), "--cached".into(), "--force".into(), "--".into()]
    };
    args.extend(paths.iter().cloned());
    args
}

/// 暂存的参数：`add -A` 覆盖新增 / 修改 / 删除（与 V14 `omp commit` 的 stage 语义一致）。
pub fn add_args(paths: &[String]) -> Vec<String> {
    let mut args: Vec<String> = vec!["add".into(), "-A".into(), "--".into()];
    args.extend(paths.iter().cloned());
    args
}

/// `modelRoles.commit`（如 `commandcode/deepseek/deepseek-v4.1-flash:low`）
/// → `(模型选择器, 思考档)`。按**最后一个** `:` 切；层不是已知档位时整串当选择器。
pub fn commit_model_args(role: Option<&str>) -> (Option<String>, Option<String>) {
    const LEVELS: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    let Some(role) = role.map(str::trim).filter(|r| !r.is_empty()) else {
        return (None, None);
    };
    match role.rsplit_once(':') {
        Some((selector, level)) if !selector.is_empty() && LEVELS.contains(&level) => {
            (Some(selector.to_string()), Some(level.to_string()))
        }
        _ => (Some(role.to_string()), None),
    }
}

/// 推送的参数：有上游直接 `push`；没有上游时显式设上游（`-u <remote> <branch>`），
/// 与 Cursor / GitHub Desktop 的「首次推送自动建立跟踪」同口径。
pub fn push_args(branch: &str, has_upstream: bool, remotes: &[String]) -> Result<Vec<String>, String> {
    if has_upstream {
        return Ok(vec!["push".into()]);
    }
    if let Some(remote) = remotes.iter().find(|r| r.as_str() == "origin") {
        return Ok(vec!["push".into(), "-u".into(), remote.clone(), branch.to_string()]);
    }
    match remotes {
        [only] => Ok(vec!["push".into(), "-u".into(), only.clone(), branch.to_string()]),
        _ => Err("没有配置远程仓库".into()),
    }
}

/// 新建 worktree 的参数（`omp worktree add`；`-q` 静音、新分支带 `-b`、base 可选）。
pub fn worktree_add_args(new_branch: bool, branch: &str, wt_path: &str, base: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = vec!["worktree".into(), "add".into(), "-q".into()];
    if new_branch {
        args.push("-b".into());
        args.push(branch.to_string());
        args.push(wt_path.to_string());
        if let Some(b) = base.map(str::trim).filter(|b| !b.is_empty()) {
            args.push(b.to_string());
        }
    } else {
        args.push(wt_path.to_string());
        args.push(branch.to_string());
    }
    args
}

/// `git worktree prune -v` 的输出 → 非空行（每条 = 一条被清掉的失效登记）。
pub fn parse_prune_verbose(out: &str) -> Vec<String> {
    out.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_string).collect()
}

/// 选远端：优先 `origin`，否则只有唯一一个 remote 时用它；多个且无 origin 不猜。
pub fn pick_remote(remotes: &[String]) -> Option<String> {
    if let Some(origin) = remotes.iter().find(|r| r.as_str() == "origin") {
        return Some(origin.clone());
    }
    match remotes {
        [only] => Some(only.clone()),
        _ => None,
    }
}

/// 远端默认分支名：`<remote>/HEAD` 的符号引用优先，其次本地已有的 `<remote>/main` / `<remote>/master`。
pub fn remote_default_branch(remote: &str, symbolic: Option<&str>, refs: &[String]) -> Option<String> {
    if let Some(sym) = symbolic {
        let t = sym.trim();
        if let Some(rest) = t.strip_prefix(&format!("{remote}/")) {
            if !rest.is_empty() {
                return Some(rest.to_string());
            }
        }
    }
    for cand in ["main", "master"] {
        let full = format!("{remote}/{cand}");
        if refs.iter().any(|r| r.trim() == full) {
            return Some(cand.to_string());
        }
    }
    None
}

/// 「新建分支 + 基于远端最新」用的基线：先 `fetch` 再给出 `<remote>/<branch>`。
/// 没有远端 / 认不出默认分支都会给出可执行的错误提示（不静默挑一个分支）。
pub(crate) async fn resolve_remote_base(git: &str, cwd: &str) -> Result<String, CmdError> {
    let remotes: Vec<String> = run_git(git, cwd, &["remote"])
        .await
        .map_err(|e| cmd_err("REMOTE_LIST", e, None))?
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty())
        .map(str::to_string)
        .collect();
    let remote = pick_remote(&remotes).ok_or_else(|| {
        cmd_err(
            "NO_REMOTE",
            "没有配置远程仓库".into(),
            Some("在终端里执行 git remote add origin <url>".into()),
        )
    })?;
    let symbolic = run_git(git, cwd, &["symbolic-ref", "--short", "-q", &format!("refs/remotes/{remote}/HEAD")])
        .await
        .ok();
    let refs: Vec<String> = run_git(git, cwd, &["for-each-ref", "--format=%(refname:short)", &format!("refs/remotes/{remote}")])
        .await
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect();
    let branch = remote_default_branch(&remote, symbolic.as_deref(), &refs).ok_or_else(|| {
        cmd_err(
            "UNKNOWN_DEFAULT_BRANCH",
            "无法确定远端默认分支".into(),
            Some("先在终端里 git fetch 一次，或改用「当前 HEAD」基线".into()),
        )
    })?;
    run_git_timeout(git, cwd, &["fetch", &remote, &branch], FETCH_TIMEOUT)
        .await
        .map_err(|e| cmd_err("FETCH_FAILED", format!("拉取远端失败：{e}"), None))?;
    Ok(format!("{remote}/{branch}"))
}

/// 解析 `git status --porcelain` 的非空条目数（worktree 脏检查用）。
pub fn count_status_entries(out: &str) -> u32 {
    out.lines().filter(|l| !l.trim().is_empty()).count() as u32
}

// ---------- git 调用 ----------

/// 读当前已暂存的文件（`git diff --cached --name-only -z`）。
pub(crate) async fn staged_paths(git: &str, cwd: &str) -> Result<Vec<String>, String> {
    let out = run_git_timeout(git, cwd, &["diff", "--cached", "--name-only", "-z"], SLOW).await?;
    Ok(out.split('\0').filter(|s| !s.is_empty()).map(str::to_string).collect())
}

/// 把勾选同步到暂存区（**生成 / 提交都先做这一步**）：
/// 未选中的取消暂存、选中的全量 `add -A`，最后复查「暂存集合 ⊆ 勾选集合」。
///
/// 只做**子集**校验：选中但没有改动的文件不会出现在暂存区，等值校验会误报。
pub(crate) async fn apply_selection(git: &str, cwd: &str, paths: &[String]) -> Result<(), CmdError> {
    let selected: Vec<String> = paths.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
    if selected.is_empty() {
        return Err(cmd_err("NO_SELECTION", "请至少勾选一个文件".into(), None));
    }
    let staged = staged_paths(git, cwd)
        .await
        .map_err(|e| cmd_err("STATUS_FAILED", e, None))?;
    let (to_add, to_unstage) = stage_plan(&selected, &staged);
    if !to_unstage.is_empty() {
        let has_head = run_git(git, cwd, &["rev-parse", "--verify", "-q", "HEAD"]).await.is_ok();
        let args = unstage_args(has_head, &to_unstage);
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_git_timeout(git, cwd, &refs, SLOW).await.map_err(|e| cmd_err("STAGE_FAILED", e, None))?;
    }
    if !to_add.is_empty() {
        let args = add_args(&to_add);
        let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        run_git(git, cwd, &refs).await.map_err(|e| cmd_err("STAGE_FAILED", e, None))?;
    }
    // 复查：暂存区不能出现勾选之外的文件（那是「提交了没勾的东西」，必须挡住）
    let after = staged_paths(git, cwd)
        .await
        .map_err(|e| cmd_err("STATUS_FAILED", e, None))?;
    if let Some(extra) = after.iter().find(|p| !selected.iter().any(|s| s == *p)) {
        return Err(cmd_err(
            "STAGE_MISMATCH",
            "暂存区与勾选不一致（文件在操作期间被改动），请重试".into(),
            Some(format!("意外暂存：{extra}")),
        ));
    }
    Ok(())
}

/// 是否同一个路径（git 在 macOS 上会回 `/private/var/…` 这类规范化形式）。
fn same_path(a: &str, b: &str) -> bool {
    if a == b {
        return true;
    }
    match (Path::new(a).canonicalize(), Path::new(b).canonicalize()) {
        (Ok(x), Ok(y)) => x == y,
        _ => false,
    }
}

// ---------- 命令 ----------

/// 面板打开时取一次变更集（**只读**）：文件清单 + 分支 / 上游状态。
/// 非仓库 / 目录不存在都降级为 `isRepo:false`（不抛错，前端显示「不是 git 仓库」）。
#[tauri::command]
pub async fn get_change_set(cwd: String) -> Result<ChangeSet, CmdError> {
    let Some(git) = git_bin().await else {
        return Err(cmd_err("GIT_MISSING", "未找到 git".into(), None));
    };
    if !dir_exists(&cwd) {
        return Err(cmd_err("DIR_MISSING", "工作目录不存在".into(), None));
    }
    match run_git(&git, &cwd, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(out) if out.trim() == "true" => {}
        _ => return Ok(ChangeSet::not_repo()),
    }
    let status = run_git_timeout(&git, &cwd, &["status", "--porcelain=v1", "-b", "-z"], SLOW)
        .await
        .map_err(|e| cmd_err("STATUS_FAILED", e, None))?;
    let (header, body) = split_status_header_z(&status);
    let (upstream, ahead, behind, upstream_gone) = crate::git_commit::parse_status_header(header);
    // numstat 覆盖「已跟踪的改动」；空仓库（没有 HEAD）退到只看暂存区
    let numstat = match run_git_timeout(&git, &cwd, &["diff", "HEAD", "--numstat", "-z"], SLOW).await {
        Ok(out) => out,
        Err(_) => run_git_timeout(&git, &cwd, &["diff", "--cached", "--numstat", "-z"], SLOW).await.unwrap_or_default(),
    };
    let files = parse_status_porcelain_z(body, &numstat);
    let branch = run_git(&git, &cwd, &["symbolic-ref", "-q", "--short", "HEAD"])
        .await
        .ok()
        .and_then(|out| {
            let t = out.trim().to_string();
            (!t.is_empty()).then_some(t)
        });
    let head = if branch.is_none() {
        run_git(&git, &cwd, &["rev-parse", "--short", "HEAD"])
            .await
            .ok()
            .and_then(|out| {
                let t = out.trim().to_string();
                (!t.is_empty()).then_some(t)
            })
    } else {
        None
    };
    Ok(ChangeSet { is_repo: true, branch, head, upstream, upstream_gone, ahead, behind, files })
}

/// 删除一个 worktree（`git worktree remove` + `git worktree prune`）。
///
/// - 主目录不能删（`WORKTREE_MAIN`）；
/// - 有未提交改动且 `force = false` → `WORKTREE_DIRTY`（前端拿到这个码后弹二次确认，再带 force 重试）；
/// - 同目录有提交任务在跑 → `WORKTREE_BUSY`；
/// - 目录已经不在了（登记残留）→ 直接跑 `prune`，把失效登记清掉。
#[tauri::command]
pub async fn remove_worktree(
    state: State<'_, AppState>,
    project_id: String,
    path: String,
    force: bool,
) -> Result<(), CmdError> {
    let git = git_bin()
        .await
        .ok_or_else(|| cmd_err("GIT_MISSING", "未找到 git，无法删除 worktree".into(), None))?;
    let proj_path = {
        let ov = state.overlay.lock().await;
        ov.projects.iter().find(|p| p.id == project_id).map(|p| p.path.clone())
    }
    .ok_or_else(|| cmd_err("NOT_FOUND", "项目不存在".into(), None))?;
    {
        let tasks = state.commit_tasks.lock().unwrap_or_else(|e| e.into_inner());
        if tasks.contains_key(&path) {
            return Err(cmd_err(
                "WORKTREE_BUSY",
                "该 worktree 还有提交任务在跑，先等它结束".into(),
                None,
            ));
        }
    }
    remove_worktree_core(&git, &proj_path, &path, force).await
}

/// 删除动作的核心（与命令分开，便于用真实仓库测）：
/// 主目录拒绝、脏目录需 force、目录已缺失则只 prune。
pub(crate) async fn remove_worktree_core(
    git: &str,
    proj_path: &str,
    path: &str,
    force: bool,
) -> Result<(), CmdError> {
    let worktrees = list_worktrees(git, proj_path).await;
    let Some(entry) = worktrees.iter().find(|w| same_path(&w.path, path)) else {
        // 登记里没有它（可能刚被手工删掉）：跑一次 prune 让两侧都干净
        run_git(git, proj_path, &["worktree", "prune"])
            .await
            .map_err(|e| cmd_err("WORKTREE_PRUNE", e, None))?;
        return Ok(());
    };
    if entry.main {
        return Err(cmd_err("WORKTREE_MAIN", "主目录不能被删除".into(), None));
    }
    if !dir_exists(path) {
        run_git(git, proj_path, &["worktree", "prune"])
            .await
            .map_err(|e| cmd_err("WORKTREE_PRUNE", e, None))?;
        return Ok(());
    }
    if !force {
        let status = run_git_timeout(git, path, &["status", "--porcelain", "-uall"], SLOW)
            .await
            .map_err(|e| cmd_err("STATUS_FAILED", e, None))?;
        let changed = count_status_entries(&status);
        if changed > 0 {
            return Err(cmd_err(
                "WORKTREE_DIRTY",
                format!("worktree 里有未提交改动（{changed} 个文件），删除会永久丢失"),
                Some("确认后再次调用并带上 force".into()),
            ));
        }
    }
    let mut args: Vec<String> = vec!["worktree".into(), "remove".into()];
    if force {
        args.push("--force".into());
    }
    args.push(path.to_string());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_git_timeout(git, proj_path, &refs, SLOW)
        .await
        .map_err(|e| cmd_err("WORKTREE_REMOVE", format!("删除 worktree 失败：{e}"), None))?;
    // 顺带清掉残留登记（目录已删，git 的 admin 文件可能还没回收）
    run_git(git, proj_path, &["worktree", "prune"]).await.ok();
    Ok(())
}

/// 清理失效登记（`git worktree prune -v`）：目录已被手工删掉、git 还记着的那些。
/// 返回被清掉的条目（原文行），供界面显示条数。
#[tauri::command]
pub async fn prune_worktrees(state: State<'_, AppState>, project_id: String) -> Result<Vec<String>, CmdError> {
    let git = git_bin().await.ok_or_else(|| cmd_err("GIT_MISSING", "未找到 git".into(), None))?;
    let proj_path = {
        let ov = state.overlay.lock().await;
        ov.projects.iter().find(|p| p.id == project_id).map(|p| p.path.clone())
    }
    .ok_or_else(|| cmd_err("NOT_FOUND", "项目不存在".into(), None))?;
    let out = run_git(&git, &proj_path, &["worktree", "prune", "-v"])
        .await
        .map_err(|e| cmd_err("WORKTREE_PRUNE", e, None))?;
    Ok(parse_prune_verbose(&out))
}

/// 列孤儿 worktree（`omp worktree list --json` 里带 `orphanReason` 的条目）。
/// 注意：这是 **agentDir 全域**的清单（`~/.omp/wt` 下所有仓库），不限于某个项目。
#[tauri::command]
pub async fn list_orphan_worktrees(state: State<'_, AppState>) -> Result<Vec<OrphanWorktree>, CmdError> {
    let bin = crate::commands::discover_omp_path(&state)
        .ok_or_else(|| cmd_err("OMP_MISSING", "未找到 omp".into(), None))?;
    let out = crate::providers::run_omp(&bin, &["worktree", "list", "--json"])
        .await
        .map_err(|e| cmd_err("WORKTREE_LIST", e, None))?;
    Ok(parse_orphan_worktrees(&out))
}

/// 清理孤儿 worktree（`omp worktree clear --json`；**不带** `--all`——上游语义 = 只清孤儿）。
#[tauri::command]
pub async fn clear_orphan_worktrees(state: State<'_, AppState>) -> Result<OrphanClearResult, CmdError> {
    let bin = crate::commands::discover_omp_path(&state)
        .ok_or_else(|| cmd_err("OMP_MISSING", "未找到 omp".into(), None))?;
    let out = crate::providers::run_omp(&bin, &["worktree", "clear", "--json"])
        .await
        .map_err(|e| cmd_err("WORKTREE_CLEAR", e, None))?;
    Ok(parse_clear_result(&out))
}

/// 解析 `omp worktree list --json` 的形状（实测：数组，条目含 `path` / `kind` /
/// `parentRepo` / `orphanReason`）。只保留有 `orphanReason` 的。
pub fn parse_orphan_worktrees(out: &str) -> Vec<OrphanWorktree> {
    let Ok(serde_json::Value::Array(items)) = serde_json::from_str::<serde_json::Value>(out.trim()) else {
        return vec![];
    };
    items
        .into_iter()
        .filter_map(|it| {
            let path = it.get("path")?.as_str()?.to_string();
            let reason = it.get("orphanReason").and_then(|v| v.as_str())?.to_string();
            Some(OrphanWorktree {
                path,
                kind: it.get("kind").and_then(|v| v.as_str()).map(str::to_string),
                parent_repo: it.get("parentRepo").and_then(|v| v.as_str()).map(str::to_string),
                orphan_reason: reason,
            })
        })
        .collect()
}

/// 解析 `omp worktree clear --json`（实测：`{removed, failed, results}`；
/// 没有可清的条目时是 `{removed: 0, kept: N}`）。
pub fn parse_clear_result(out: &str) -> OrphanClearResult {
    let v: serde_json::Value = serde_json::from_str(out.trim()).unwrap_or(serde_json::Value::Null);
    let num = |key: &str| v.get(key).and_then(|x| x.as_u64()).unwrap_or(0) as u32;
    OrphanClearResult { removed: num("removed"), failed: num("failed") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn numstat_parses_plain_and_rename_entries() {
        let out = "3\t3\tAGENTS.md\099\t0\0src/new.rs\0src/old.rs\0-\t-\tbin.dat\0";
        let map = parse_numstat_z(out);
        assert_eq!(map.get("AGENTS.md"), Some(&(3, 3)));
        // 改名：两段都登记（顺序不做假设），任一段都能查到
        assert_eq!(map.get("src/new.rs"), Some(&(99, 0)));
        assert_eq!(map.get("src/old.rs"), Some(&(99, 0)));
        // 二进制（`-`）按 0 处理
        assert_eq!(map.get("bin.dat"), Some(&(0, 0)));
    }

    #[test]
    fn status_z_parses_entries_with_counts() {
        let status = " M AGENTS.md\0?? 新文件.md\0A  src/a.rs\0";
        let numstat = "3\t3\tAGENTS.md\01\t0\tsrc/a.rs\0";
        let files = parse_status_porcelain_z(status, numstat);
        assert_eq!(files.len(), 3);
        assert_eq!(files[0].path, "AGENTS.md");
        assert_eq!((files[0].index.as_str(), files[0].worktree.as_str()), (" ", "M"));
        assert_eq!((files[0].add, files[0].del), (3, 3));
        // 中文未跟踪文件：路径原样，不计数
        assert_eq!(files[1].path, "新文件.md");
        assert!(files[1].untracked);
        assert_eq!((files[1].add, files[1].del), (0, 0));
        assert_eq!(files[2].index, "A");
    }

    #[test]
    fn status_z_rename_takes_next_token_as_orig() {
        // `-z` 下 git 把顺序反了过来：第一段是当前路径，第二段是原名
        let status = "R  src/new.rs\0src/old.rs\0";
        let files = parse_status_porcelain_z(status, "1\t0\tsrc/new.rs\0src/old.rs\0");
        assert_eq!(files.len(), 1, "改名只占一行，第二段是原名不是新条目");
        assert_eq!(files[0].path, "src/new.rs");
        assert_eq!(files[0].orig_path.as_deref(), Some("src/old.rs"));
        assert_eq!((files[0].add, files[0].del), (1, 0));
    }

    #[test]
    fn status_header_split_off_body() {
        let (head, body) = split_status_header_z("## main...origin/main [ahead 1]\0 M a.txt\0");
        assert_eq!(head, "## main...origin/main [ahead 1]");
        assert_eq!(parse_status_porcelain_z(body, "").len(), 1);
        // 没有头段（异常输入）时整段当正文
        let (head, body) = split_status_header_z(" M a.txt\0");
        assert_eq!(head, "");
        assert_eq!(body, " M a.txt\0");
    }

    #[test]
    fn stage_plan_keeps_selection_and_unstages_the_rest() {
        let selected = vec!["a.txt".to_string(), "b.txt".to_string()];
        let staged = vec!["b.txt".to_string(), "c.txt".to_string()];
        let (add, unstage) = stage_plan(&selected, &staged);
        assert_eq!(add, vec!["a.txt", "b.txt"]);
        assert_eq!(unstage, vec!["c.txt"]);
        // 空勾选只 unstage
        let (add, unstage) = stage_plan(&[], &["x".to_string()]);
        assert!(add.is_empty());
        assert_eq!(unstage, vec!["x"]);
    }

    #[test]
    fn unstage_args_switch_on_head() {
        let paths = vec!["a.txt".to_string()];
        assert_eq!(unstage_args(true, &paths), ["restore", "--staged", "--", "a.txt"]);
        // 空仓库没有 HEAD，`restore --staged` 会失败 → 改用 rm --cached
        assert_eq!(unstage_args(false, &paths), ["rm", "--cached", "--force", "--", "a.txt"]);
    }

    #[test]
    fn add_args_are_force_all_with_pathspec() {
        assert_eq!(add_args(&["a.txt".into(), "b/c.txt".into()]), ["add", "-A", "--", "a.txt", "b/c.txt"]);
    }

    #[test]
    fn commit_model_args_splits_level() {
        assert_eq!(
            commit_model_args(Some("commandcode/deepseek/deepseek-v4.1-flash:low")),
            (Some("commandcode/deepseek/deepseek-v4.1-flash".into()), Some("low".into()))
        );
        // 没有层级 / 层级不合法 → 整串当选择器（模型 id 里带冒号的情况也走这里）
        assert_eq!(commit_model_args(Some("openai/gpt-5.2")), (Some("openai/gpt-5.2".into()), None));
        assert_eq!(
            commit_model_args(Some("provider/model:weird")),
            (Some("provider/model:weird".into()), None)
        );
        assert_eq!(commit_model_args(None), (None, None));
        assert_eq!(commit_model_args(Some("  ")), (None, None));
    }

    #[test]
    fn push_args_prefers_origin_then_single_remote() {
        assert_eq!(push_args("main", true, &[]).unwrap(), ["push"]);
        assert_eq!(
            push_args("feature/x", false, &["upstream".into(), "origin".into()]).unwrap(),
            ["push", "-u", "origin", "feature/x"]
        );
        assert_eq!(
            push_args("main", false, &["backup".into()]).unwrap(),
            ["push", "-u", "backup", "main"]
        );
        // 多个 remote 且没有 origin：不猜，交给用户
        assert!(push_args("main", false, &["a".into(), "b".into()]).is_err());
        assert!(push_args("main", false, &[]).is_err());
    }

    #[test]
    fn worktree_add_args_cover_three_shapes() {
        assert_eq!(
            worktree_add_args(true, "feat/x", "/wt/repo-feat-x", None),
            ["worktree", "add", "-q", "-b", "feat/x", "/wt/repo-feat-x"]
        );
        assert_eq!(
            worktree_add_args(true, "feat/x", "/wt/repo-feat-x", Some("origin/main")),
            ["worktree", "add", "-q", "-b", "feat/x", "/wt/repo-feat-x", "origin/main"]
        );
        assert_eq!(
            worktree_add_args(false, "feat/x", "/wt/repo-feat-x", Some("origin/main")),
            ["worktree", "add", "-q", "/wt/repo-feat-x", "feat/x"]
        );
    }

    #[test]
    fn prune_and_status_helpers() {
        assert_eq!(parse_prune_verbose("Removing worktrees/x: gone\n\n  \n"), ["Removing worktrees/x: gone"]);
        assert_eq!(parse_prune_verbose(""), Vec::<String>::new());
        assert_eq!(count_status_entries(" M a.txt\n?? b.txt\n"), 2);
        assert_eq!(count_status_entries(""), 0);
    }

    #[test]
    fn remote_pick_and_default_branch() {
        assert_eq!(pick_remote(&["backup".into(), "origin".into()]).as_deref(), Some("origin"));
        assert_eq!(pick_remote(&["solo".into()]).as_deref(), Some("solo"));
        assert_eq!(pick_remote(&["a".into(), "b".into()]), None);
        assert_eq!(pick_remote(&[]), None);

        // 符号引用优先（`origin/develop` → develop）
        assert_eq!(
            remote_default_branch("origin", Some("origin/develop\n"), &[]).as_deref(),
            Some("develop")
        );
        // 没有符号引用时回退本地已有的 origin/main、origin/master
        assert_eq!(
            remote_default_branch("origin", None, &["origin/main".into(), "origin/topic".into()]).as_deref(),
            Some("main")
        );
        assert_eq!(
            remote_default_branch("origin", None, &["origin/master".into()]).as_deref(),
            Some("master")
        );
        // 符号引用属于别的 remote（或为空）：不认，继续走回退
        assert_eq!(remote_default_branch("origin", Some("upstream/main"), &["origin/main".into()]).as_deref(), Some("main"));
        assert_eq!(remote_default_branch("origin", Some("origin/"), &[]), None);
        assert_eq!(remote_default_branch("origin", None, &["origin/topic".into()]), None);
    }

    #[tokio::test]
    async fn real_repo_resolve_remote_base_fetches() {
        let Some(git) = git_bin().await else { panic!("未找到 git") };
        let root = std::env::temp_dir().join(format!("omp-mini-v19-remote-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let src = root.join("src");
        let bare = root.join("bare");
        let clone = root.join("clone");
        std::fs::create_dir_all(&src).unwrap();
        let run = |dir: &std::path::Path, args: &[&str]| {
            let out = std::process::Command::new(&git).arg("-C").arg(dir).args(args).output().unwrap();
            assert!(out.status.success(), "git {args:?} 失败：{}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };
        run(&src, &["init", "--initial-branch=main", "."]);
        run(&src, &["config", "user.email", "x@y.z"]);
        run(&src, &["config", "user.name", "x"]);
        run(&src, &["commit", "--allow-empty", "-m", "chore: init"]);
        std::process::Command::new(&git).args(["init", "--bare"]).arg(&bare).output().unwrap();
        run(&src, &["remote", "add", "origin", bare.to_str().unwrap()]);
        run(&src, &["push", "-u", "origin", "main"]);
        // clone 会自动写 refs/remotes/origin/HEAD（符号引用那条主路径）
        std::process::Command::new(&git).args(["clone", "-q"]).arg(&bare).arg(&clone).output().unwrap();
        let clone_s = clone.to_string_lossy().to_string();
        assert_eq!(resolve_remote_base(&git, &clone_s).await.unwrap(), "origin/main");

        // 删掉符号引用：回退到「本地已有 origin/main」
        run(&clone, &["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
        assert_eq!(resolve_remote_base(&git, &clone_s).await.unwrap(), "origin/main");

        // 没有远端 → 明确报错（不猜分支）
        let err = resolve_remote_base(&git, &src.to_string_lossy()).await.is_ok();
        assert!(err, "src 有 origin，应当能解析");
        let lonely = root.join("lonely");
        std::fs::create_dir_all(&lonely).unwrap();
        run(&lonely, &["init", "--initial-branch=main", "."]);
        let e = resolve_remote_base(&git, &lonely.to_string_lossy()).await.unwrap_err();
        assert_eq!(e.code, "NO_REMOTE");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn orphan_parsing_filters_live_entries() {
        let out = r#"[
          {"path":"/wt/a","kind":"pr-checkout","parentRepo":"/repo","orphanReason":"parent repo missing"},
          {"path":"/wt/b","kind":"pr-checkout","parentRepo":"/repo","branch":"main"},
          {"path":"/wt/c","kind":"empty","orphanReason":"empty directory"}
        ]"#;
        let orphans = parse_orphan_worktrees(out);
        assert_eq!(orphans.len(), 2);
        assert_eq!(orphans[0].path, "/wt/a");
        assert_eq!(orphans[0].parent_repo.as_deref(), Some("/repo"));
        assert_eq!(orphans[1].path, "/wt/c");
        assert_eq!(orphans[1].parent_repo, None);
        assert_eq!(parse_orphan_worktrees("not json"), Vec::<OrphanWorktree>::new());
    }

    #[test]
    fn clear_result_parses_both_shapes() {
        let r = parse_clear_result(r#"{"removed":2,"failed":1,"results":[]}"#);
        assert_eq!((r.removed, r.failed), (2, 1));
        let r = parse_clear_result(r#"{"removed":0,"kept":3}"#);
        assert_eq!((r.removed, r.failed), (0, 0));
        let r = parse_clear_result("");
        assert_eq!((r.removed, r.failed), (0, 0));
    }
}
