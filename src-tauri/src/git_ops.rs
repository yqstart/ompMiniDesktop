//! 壳侧 git 写操作（V19）：变更集读取、勾选 → 暂存区同步。
//!
//! 分工（V19 起）：**git 的写操作由壳侧用 git CLI 直接做**——快、可预期、错误就是 git
//! 原文；`omp` 只负责「用哪个模型、怎么出提交信息」（见 `commit_msg.rs`）。这替代了
//! V14「壳只做编排、不碰 git index 语义」的口径，理由就是速度与可控性（V14 每次提交
//! 要跑完整条 `omp commit` agent 流水线，实测 16–35s）。
//!
//! 本模块只放「读状态 / 建参数 / 解析输出」的纯函数（全部带单测）与少量 git 调用；
//! 提交 / 推送的**任务编排**在 `git_commit.rs`。

use std::collections::HashMap;
use std::time::Duration;

use serde::Serialize;

use crate::commands::{cmd_err, CmdError};
use crate::git_info::{dir_exists, git_bin, run_git, run_git_timeout};

/// 变更集里一个文件的上限保护：超大仓库不把整表塞给前端（够用且不卡界面）。
const MAX_CHANGE_FILES: usize = 2000;
/// 大仓库里可能偏慢的 git 操作（status / add）：给 30s，超时才报失败。
/// 只读的行徽章那条链路仍用 `git_info::GIT_TIMEOUT`（4s）——那是背景刷新，慢就降级。
const SLOW: Duration = Duration::from_secs(30);
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
}
