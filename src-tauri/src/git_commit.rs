//! 工作区「提交并推送」（V14）：上游 `omp commit` 的壳侧封装。
//!
//! 为什么不是壳侧自己拼提交信息：`omp commit` 是一整条流水线——AI 生成信息（按
//! `modelRoles.commit` 角色）、changelog 维护、校验器、push。壳只负责「谁、在哪个目录、
//! 什么时候」，不重造提交信息、不碰 git index 语义。
//!
//! 两段式（设计见 `docs/v14-schedule.md`）：
//! - 第一段 `omp commit`：只提交（AI，~20s）；
//! - 第二段 `omp commit --push`：推送（无改动时走 ~2s 快路径，见 `run` 的 mode 注释）。
//!
//! 上游行为（18.2.4 实测，详见设计稿 §1）：
//! - 无 staged 改动时自动 `add -A`（**含未跟踪文件**），无关改动可能拆成多个提交；
//! - 退出码 0 = 成功、1 = 失败；「commit 成功但 push 失败」只能靠运行前后 HEAD 对比判定；
//! - 非 git 仓库会吐 JS 堆栈——预检必须挡在 spawn 之前。
//!
//! 并发模型：任务按 **cwd** 建表——不同工作区可并行（Cursor 式「多个任务一起跑」），
//! 同一工作区拒绝重入（前端按钮态 + 这里的 BUSY 双保险）。取消走 oneshot → 杀进程组。

use std::collections::HashMap;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::commands::{cmd_err, AppState, CmdError};
use crate::git_info::{dir_exists, git_bin, run_git};
use crate::pty::{force_kill_group, login_path};

/// 一个工作区的提交任务句柄。
pub struct CommitTask {
    seq: u64,
    pid: Option<u32>,
    cancel: Option<tokio::sync::oneshot::Sender<()>>,
}

/// 任务表：cwd → 句柄。
pub type CommitMap = Arc<Mutex<HashMap<String, CommitTask>>>;

/// 每次 spawn 的内部序号：收尾时用它确认「表里的还是我这一次任务」，
/// 防止「失败后立刻重跑」时旧任务误删新任务的槽位（与 PTY 的 `seq` 同口径）。
static TASK_SEQ: AtomicU64 = AtomicU64::new(1);

/// 首流 EOF 后等另一流的宽限：omp 的 stdout 收尾后 stderr 可能还差几行。
const STREAM_GRACE: Duration = Duration::from_millis(400);
/// 错误摘要的尾部行数上限（stdout / stderr 各一份）。
const TAIL_MAX: usize = 8;

/// 任务模式：第一段（只提交）/ 第二段（提交并推送，quick path 也走它）。
#[derive(Clone, Copy, PartialEq, Eq)]
enum RunMode {
    Commit,
    Push,
}

// ---------- 前后端事件协议 ----------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CommitPhase {
    Checking,
    Committing,
    Pushing,
    Committed,
    Pushed,
    Noop,
    Failed,
    Canceled,
}

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum CommitEvent {
    /// 输出行（已去 ANSI；stdout / stderr 混流）。
    Line { text: String },
    /// 阶段推进（Checking 由前端本地先落，后端从 Committing / Pushing 起发）。
    Phase { phase: CommitPhase },
    /// 任务结束：终态与结果都在这条里。
    Exit { outcome: CommitOutcome },
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitEntry {
    pub sha: String,
    pub subject: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutcome {
    pub phase: CommitPhase,
    /// 本次任务新建的提交（运行前后 HEAD 对比 + `git log` 读得）。
    /// 失败时也可能非空——split 提交中途失败 / commit 成功但 push 失败（部分成功）。
    pub commits: Vec<CommitEntry>,
    pub error: Option<String>,
    pub hint: Option<String>,
}

// ---------- 工作区 git 状态（行徽章用，只读） ----------

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceGitState {
    pub path: String,
    pub is_repo: bool,
    /// 有未提交改动（含未跟踪文件——与 `omp commit` 的 `add -A` 语义对齐）。
    pub dirty: bool,
    /// 本地领先上游的提交数（无上游 / detached 时为 0）。
    pub ahead: u32,
    /// 本地落后上游的提交数（无上游 / detached 时为 0）。
    pub behind: u32,
    pub upstream: Option<String>,
    /// 上游分支已在远程被删除（`[gone]`）：upstream 名仍在，但没有可比较的远程分支。
    pub upstream_gone: bool,
}

impl WorkspaceGitState {
    fn unknown(path: String) -> Self {
        Self { path, is_repo: false, dirty: false, ahead: 0, behind: 0, upstream: None, upstream_gone: false }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct StatusSummary {
    pub dirty: bool,
    pub ahead: u32,
    pub behind: u32,
    pub upstream: Option<String>,
    pub upstream_gone: bool,
}

/// 解析 `git status --porcelain -b`：
/// - 头部 `## main...origin/main [ahead 1, behind 2]` / `## feature` / `## HEAD (no branch)` /
///   `## main...origin/main [gone]`（上游被删除）；
/// - 其余非空行 = 变更条目（含 `??` 未跟踪），有任意一条即 dirty。
pub fn parse_status_porcelain_b(out: &str) -> StatusSummary {
    let mut dirty = false;
    let mut ahead = 0u32;
    let mut behind = 0u32;
    let mut upstream = None;
    let mut upstream_gone = false;
    for (i, line) in out.lines().enumerate() {
        if i == 0 && line.starts_with("## ") {
            let head = &line[3..];
            if !head.starts_with("HEAD (no branch)") {
                if let Some((_, rest)) = head.split_once("...") {
                    let (name, bracket) = match rest.split_once(" [") {
                        Some((n, b)) => (n, Some(b)),
                        None => (rest, None),
                    };
                    if !name.trim().is_empty() {
                        upstream = Some(name.trim().to_string());
                    }
                    if let Some(b) = bracket {
                        for part in b.trim_end_matches(']').split(',') {
                            let part = part.trim();
                            if let Some(n) = part.strip_prefix("ahead ") {
                                ahead = n.trim().parse().unwrap_or(0);
                            } else if let Some(n) = part.strip_prefix("behind ") {
                                behind = n.trim().parse().unwrap_or(0);
                            } else if part == "gone" {
                                upstream_gone = true;
                            }
                        }
                    }
                }
            }
            continue;
        }
        if !line.trim().is_empty() {
            dirty = true;
        }
    }
    StatusSummary { dirty, ahead, behind, upstream, upstream_gone }
}

/// 预检结论：有改动 → 第一段；仅 ahead（或**无上游**——此时 ahead 无法计数，但提交大概率推不出去，
/// 让 push 去尝试并给出上游提示）→ 第二段；干净且同步 → 无事可做。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Decision {
    Commit,
    Push,
    Noop,
}

pub fn decide(summary: &StatusSummary) -> Decision {
    if summary.dirty {
        Decision::Commit
    } else if summary.ahead > 0 || summary.upstream.is_none() {
        Decision::Push
    } else {
        Decision::Noop
    }
}

/// 剥掉 ANSI 控制序列（CSI / OSC / 两字节转义）：omp 输出带少量颜色码，日志区只渲染纯文本。
pub fn strip_ansi(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\u{1b}' {
            out.push(c);
            continue;
        }
        match chars.peek() {
            // CSI：ESC [ … 终止字节（0x40–0x7E）
            Some('[') => {
                chars.next();
                for c2 in chars.by_ref() {
                    if ('\u{40}'..='\u{7e}').contains(&c2) {
                        break;
                    }
                }
            }
            // OSC：ESC ] … BEL 或 ST（ESC \）
            Some(']') => {
                chars.next();
                while let Some(c2) = chars.next() {
                    if c2 == '\u{7}' {
                        break;
                    }
                    if c2 == '\u{1b}' && chars.peek() == Some(&'\\') {
                        chars.next();
                        break;
                    }
                }
            }
            // 其它两字节转义（ESC c 等）：吞掉
            Some(_) => {
                chars.next();
            }
            None => {}
        }
    }
    out
}

/// 失败摘要 → 人话 hint（只认几个高频 git 报错，其余透传原文）。
pub fn failure_hint(error: &str) -> Option<&'static str> {
    let e = error.to_lowercase();
    if e.contains("no upstream branch") {
        Some("分支还没有上游：在终端里执行 git push -u <remote> <branch> 设置一次（或开启 git 的 push.autoSetupRemote）")
    } else if e.contains("could not read from remote repository")
        || e.contains("permission denied")
        || e.contains("authentication failed")
    {
        Some("远端拒绝访问：检查仓库权限与本机 git 凭证")
    } else if e.contains("non-fast-forward") || e.contains("fetch first") {
        Some("远端有新提交：先在终端里 git pull --rebase 再推送")
    } else {
        None
    }
}

// ---------- 命令 ----------

/// 批量读取工作区 git 状态（左栏行徽章）：每行一次 `status --porcelain -b`，并发跑。
/// git 不可用 / 目录不存在 / 非仓库都降级为 `isRepo:false`，不抛错。
#[tauri::command]
pub async fn get_workspace_git_state(paths: Vec<String>) -> Result<Vec<WorkspaceGitState>, CmdError> {
    let git = git_bin().await;
    let mut set = tokio::task::JoinSet::new();
    for (i, path) in paths.into_iter().enumerate() {
        let git = git.clone();
        set.spawn(async move {
            let state = match &git {
                Some(g) if dir_exists(&path) => match read_status(g, &path).await {
                    Ok(s) => WorkspaceGitState {
                        path: path.clone(),
                        is_repo: true,
                        dirty: s.dirty,
                        ahead: s.ahead,
                        behind: s.behind,
                        upstream: s.upstream,
                        upstream_gone: s.upstream_gone,
                    },
                    Err(_) => WorkspaceGitState::unknown(path.clone()),
                },
                _ => WorkspaceGitState::unknown(path.clone()),
            };
            (i, state)
        });
    }
    let mut out: Vec<(usize, WorkspaceGitState)> = Vec::new();
    while let Some(joined) = set.join_next().await {
        if let Ok((i, state)) = joined {
            out.push((i, state));
        }
    }
    out.sort_by_key(|(i, _)| *i);
    Ok(out.into_iter().map(|(_, s)| s).collect())
}

/// 第一段入口：点击「提交并推送」。
/// 预检决定跑什么——有改动 → `omp commit`；仅 ahead → `omp commit --push`（推送快路径）；
/// 都没 → 直接 noop（省掉上游 ~10s 的空跑）。
#[tauri::command]
pub async fn start_commit_push(
    state: State<'_, AppState>,
    cwd: String,
    on_event: Channel<CommitEvent>,
) -> Result<(), CmdError> {
    let _ = on_event.send(CommitEvent::Phase { phase: CommitPhase::Checking });
    let git = git_bin().await.ok_or_else(|| {
        cmd_err("GIT_MISSING", "未找到 git，无法提交".into(), Some("请安装 git 或在终端里确认 PATH".into()))
    })?;
    if !dir_exists(&cwd) {
        return Err(cmd_err("DIR_MISSING", "工作目录不存在".into(), None));
    }
    let summary = read_status(&git, &cwd).await.map_err(|e| cmd_err("PREFLIGHT", e, None))?;
    match decide(&summary) {
        Decision::Noop => {
            let _ = on_event.send(CommitEvent::Exit {
                outcome: CommitOutcome {
                    phase: CommitPhase::Noop,
                    commits: vec![],
                    error: None,
                    hint: Some("这个工作区没有可提交的改动，也没有未推送的提交".into()),
                },
            });
            Ok(())
        }
        Decision::Commit => run(state, cwd, RunMode::Commit, on_event).await,
        Decision::Push => run(state, cwd, RunMode::Push, on_event).await,
    }
}

/// 第二段入口：推送（`omp commit --push`——无改动时走 2s 快路径；若等待期间又改了文件，
/// 它会先提交再推送，语义自洽）。也用于推送失败后的重试。
#[tauri::command]
pub async fn push_commits(
    state: State<'_, AppState>,
    cwd: String,
    on_event: Channel<CommitEvent>,
) -> Result<(), CmdError> {
    let _ = on_event.send(CommitEvent::Phase { phase: CommitPhase::Checking });
    let git = git_bin().await.ok_or_else(|| {
        cmd_err("GIT_MISSING", "未找到 git，无法提交".into(), Some("请安装 git 或在终端里确认 PATH".into()))
    })?;
    if !dir_exists(&cwd) {
        return Err(cmd_err("DIR_MISSING", "工作目录不存在".into(), None));
    }
    // 推送前仍确认是仓库（挡掉上游的 JS 堆栈），但不看 dirty / ahead——用户点了推送就推。
    read_status(&git, &cwd).await.map_err(|e| cmd_err("PREFLIGHT", e, None))?;
    run(state, cwd, RunMode::Push, on_event).await
}

/// 取消运行中的任务：杀进程组（pump 收尾时落 canceled 终态）。
#[tauri::command]
pub async fn cancel_commit_push(state: State<'_, AppState>, cwd: String) -> Result<(), CmdError> {
    let mut map = state.commit_tasks.lock().unwrap_or_else(|e| e.into_inner());
    match map.get_mut(&cwd).and_then(|t| t.cancel.take()) {
        Some(tx) => {
            let _ = tx.send(());
            Ok(())
        }
        None => Err(cmd_err("NOT_RUNNING", "当前没有进行中的提交任务".into(), None)),
    }
}

// ---------- 核心：spawn + 流式 + 收尾 ----------

/// 一次任务的终局信号（进程退出码 / 是否被取消 / 两路输出的尾行摘要）。
pub(crate) struct RunSignals {
    pub canceled: bool,
    pub code: Option<i32>,
    pub out_tail: Vec<String>,
    pub err_tail: Vec<String>,
}

/// spawn `omp commit [--push]`：新进程组（取消时打 `-pid` 覆盖内部的 git 子进程）、
/// 继承登录 shell 的 PATH（GUI .app 的 PATH 缺 Homebrew）、三路管道、kill_on_drop。
/// 命令层与真实仓库慢测试共用（见文末 `#[ignore]` 测试）。
pub(crate) fn spawn_omp_commit(
    bin: &str,
    cwd: &str,
    push: bool,
) -> std::io::Result<tokio::process::Child> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.arg("commit");
    if push {
        // `--push`：有改动时 commit 后推；无改动但有未推送提交时走 ~2s 快路径直接推。
        cmd.arg("--push");
    }
    cmd.current_dir(cwd)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = login_path() {
        cmd.env("PATH", path);
    }
    // 新进程组：取消 / 退出时打 `-pid` 覆盖 omp 内部 fork 出来的 git 子进程。
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.as_std_mut().process_group(0);
    }
    cmd.spawn()
}

/// 读两路子进程输出直到收尾：每行去 ANSI 后回调；首流 EOF 后给另一流 `STREAM_GRACE` 宽限；
/// `cancel_rx` 到达时杀直接子进程并打整个进程组（`None` = 不可取消，测试用）。
pub(crate) async fn pump_omp_commit(
    mut child: tokio::process::Child,
    pid: Option<u32>,
    cancel_rx: Option<tokio::sync::oneshot::Receiver<()>>,
    mut on_line: impl FnMut(&str),
) -> RunSignals {
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout piped")).lines();
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr piped")).lines();
    let mut cancel_rx = cancel_rx;
    let mut canceled = false;
    let mut out_tail: Vec<String> = vec![];
    let mut err_tail: Vec<String> = vec![];
    let mut stdout_open = true;
    let mut stderr_open = true;
    let mut grace: Option<tokio::time::Instant> = None;
    loop {
        let grace_sleep = async {
            match grace {
                Some(t) => tokio::time::sleep_until(t).await,
                None => std::future::pending::<()>().await,
            }
        };
        let cancel_wait = async {
            match cancel_rx.as_mut() {
                Some(rx) => {
                    let _ = (&mut *rx).await;
                }
                None => std::future::pending::<()>().await,
            }
        };
        tokio::select! {
            _ = cancel_wait, if !canceled => {
                canceled = true;
                // 先杀直接子进程（SIGKILL），再打进程组擦掉 git 之类的子进程。
                let _ = child.kill().await;
                if let Some(pid) = pid {
                    force_kill_group(pid);
                }
            }
            line = stdout.next_line(), if stdout_open => match line {
                Ok(Some(l)) => {
                    let text = strip_ansi(&l);
                    push_tail(&mut out_tail, &text);
                    on_line(&text);
                }
                _ => {
                    stdout_open = false;
                    if grace.is_none() && stderr_open {
                        grace = Some(tokio::time::Instant::now() + STREAM_GRACE);
                    }
                }
            },
            line = stderr.next_line(), if stderr_open => match line {
                Ok(Some(l)) => {
                    let text = strip_ansi(&l);
                    push_tail(&mut err_tail, &text);
                    on_line(&text);
                }
                _ => {
                    stderr_open = false;
                    if grace.is_none() && stdout_open {
                        grace = Some(tokio::time::Instant::now() + STREAM_GRACE);
                    }
                }
            },
            _ = grace_sleep => break,
        }
        if !stdout_open && !stderr_open {
            break;
        }
    }
    let code = child.wait().await.ok().and_then(|s| s.code());
    RunSignals { canceled, code, out_tail, err_tail }
}

/// 终态判定（纯函数）：上游退出码分不出「commit 失败」与「push 失败」，
/// 判据 = 取消 / 退出码 / 模式 / HEAD 是否变化；错误摘要取两路输出的尾行。
pub(crate) fn classify(
    mode: RunMode,
    signals: &RunSignals,
    head_changed: bool,
) -> (CommitPhase, Option<String>, Option<String>) {
    if signals.canceled {
        return (CommitPhase::Canceled, None, None);
    }
    if signals.code == Some(0) {
        let phase = match mode {
            RunMode::Push => CommitPhase::Pushed,
            RunMode::Commit if head_changed => CommitPhase::Committed,
            RunMode::Commit => CommitPhase::Noop,
        };
        return (phase, None, None);
    }
    let mut parts: Vec<String> = vec![];
    if !signals.err_tail.is_empty() {
        parts.push(signals.err_tail.join("\n"));
    }
    if !signals.out_tail.is_empty() {
        parts.push(signals.out_tail.join("\n"));
    }
    let error = if parts.is_empty() {
        match signals.code {
            Some(c) => format!("omp commit 异常结束（退出码 {c}）"),
            None => "omp commit 被信号终止".to_string(),
        }
    } else {
        parts.join("\n\n")
    };
    let hint = failure_hint(&error).map(str::to_string);
    (CommitPhase::Failed, Some(error), hint)
}

async fn read_status(git: &str, dir: &str) -> Result<StatusSummary, String> {
    match run_git(git, dir, &["rev-parse", "--is-inside-work-tree"]).await {
        Ok(out) if out.trim() == "true" => {}
        Ok(_) => return Err("这个目录不是 git 仓库".into()),
        Err(e) => return Err(e),
    }
    let out = run_git(git, dir, &["status", "--porcelain", "-b"]).await?;
    Ok(parse_status_porcelain_b(&out))
}

async fn head_sha(git: &str, dir: &str) -> Option<String> {
    run_git(git, dir, &["rev-parse", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// 读 `before..HEAD` 的提交（短 sha + subject）；空仓库 / 无 HEAD 时返回空表。
async fn commits_in_range(git: &str, dir: &str, before: Option<&str>) -> Vec<CommitEntry> {
    let range = before.map(|b| format!("{b}..HEAD")).unwrap_or_else(|| "-n 50".to_string());
    let out = match run_git(git, dir, &["log", "--format=%h%x1f%s", &range]).await {
        Ok(o) => o,
        Err(_) => return vec![],
    };
    out.lines()
        .filter_map(|l| {
            let (sha, subject) = l.split_once('\u{1f}')?;
            Some(CommitEntry { sha: sha.trim().to_string(), subject: subject.trim().to_string() })
        })
        .collect()
}

fn push_tail(tail: &mut Vec<String>, text: &str) {
    // 保留行首缩进（omp 输出有树形缩进），只对整行空白做跳过。
    let t = text.trim_end();
    if t.trim().is_empty() {
        return;
    }
    tail.push(t.to_string());
    if tail.len() > TAIL_MAX {
        tail.remove(0);
    }
}

async fn run(
    state: State<'_, AppState>,
    cwd: String,
    mode: RunMode,
    on_event: Channel<CommitEvent>,
) -> Result<(), CmdError> {
    let bin = {
        let cached = state.omp_path.lock().await.clone();
        cached.or_else(|| crate::commands::discover_omp_path(&state))
    };
    let Some(bin) = bin else {
        return Err(cmd_err(
            "OMP_MISSING",
            "未找到 omp，无法提交".into(),
            Some("请先安装 oh-my-pi 或在设置中指定路径".into()),
        ));
    };

    let seq = TASK_SEQ.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = state.commit_tasks.lock().unwrap_or_else(|e| e.into_inner());
        if map.contains_key(&cwd) {
            return Err(cmd_err("BUSY", "这个工作区已有提交任务在进行".into(), None));
        }
        map.insert(cwd.clone(), CommitTask { seq, pid: None, cancel: None });
    }

    let git = git_bin().await;
    let before = match &git {
        Some(g) => head_sha(g, &cwd).await,
        None => None,
    };

    let phase = match mode {
        RunMode::Commit => CommitPhase::Committing,
        RunMode::Push => CommitPhase::Pushing,
    };
    let _ = on_event.send(CommitEvent::Phase { phase });

    let child = match spawn_omp_commit(&bin, &cwd, mode == RunMode::Push) {
        Ok(c) => c,
        Err(e) => {
            let mut map = state.commit_tasks.lock().unwrap_or_else(|e| e.into_inner());
            if map.get(&cwd).map(|t| t.seq) == Some(seq) {
                map.remove(&cwd);
            }
            return Err(cmd_err("SPAWN_FAILED", format!("启动 omp commit 失败：{e}"), None));
        }
    };
    let pid = child.id();
    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel();
    {
        let mut map = state.commit_tasks.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(t) = map.get_mut(&cwd) {
            if t.seq == seq {
                t.pid = pid;
                t.cancel = Some(cancel_tx);
            }
        }
    }

    let tasks = state.commit_tasks.clone();
    let cwd_key = cwd.clone();
    tokio::spawn(async move {
        let signals = pump_omp_commit(child, pid, Some(cancel_rx), |text| {
            let _ = on_event.send(CommitEvent::Line { text: text.to_string() });
        })
        .await;
        // 结果判定：HEAD 对比 + 退出码（上游退出码分不出 commit 失败与 push 失败）。
        let after = match &git {
            Some(g) => head_sha(g, &cwd_key).await,
            None => None,
        };
        let head_changed = after.is_some() && after != before;
        let commits = if head_changed {
            match &git {
                Some(g) => commits_in_range(g, &cwd_key, before.as_deref()).await,
                None => vec![],
            }
        } else {
            vec![]
        };
        let (phase, error, hint) = classify(mode, &signals, head_changed);
        let _ = on_event.send(CommitEvent::Exit {
            outcome: CommitOutcome { phase, commits, error, hint },
        });

        let mut map = tasks.lock().unwrap_or_else(|e| e.into_inner());
        if map.get(&cwd_key).map(|t| t.seq) == Some(seq) {
            map.remove(&cwd_key);
        }
    });

    Ok(())
}

/// 应用退出前的收尾：杀掉全部提交任务（正常退出路径；崩溃残留接受为已知边界）。
pub fn kill_all(tasks: &CommitMap) {
    let mut guard = tasks.lock().unwrap_or_else(|e| e.into_inner());
    for (_, mut t) in guard.drain() {
        if let Some(tx) = t.cancel.take() {
            let _ = tx.send(());
        }
        if let Some(pid) = t.pid {
            force_kill_group(pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_ansi_removes_csi_osc_and_bare_escapes() {
        assert_eq!(strip_ansi("\u{1b}[38;2;245;224;220mchore: hi\u{1b}[39m"), "chore: hi");
        assert_eq!(strip_ansi("前\u{1b}[1m中\u{1b}[0m后"), "前中后");
        assert_eq!(strip_ansi("\u{1b}]8;;https://x\u{7}link\u{1b}]8;;\u{7}"), "link");
        assert_eq!(strip_ansi("\u{1b}]8;;https://x\u{1b}\\link\u{1b}]8;;\u{1b}\\"), "link");
        assert_eq!(strip_ansi("plain 文本"), "plain 文本");
        // 未终止的 CSI：吞到结尾，不 panic
        assert_eq!(strip_ansi("abc\u{1b}[38;2"), "abc");
    }

    #[test]
    fn status_parses_dirty_ahead_and_upstream() {
        let s = parse_status_porcelain_b("## main...origin/main [ahead 2]\n M a.txt\n?? b.txt\n");
        assert!(s.dirty);
        assert_eq!(s.ahead, 2);
        assert_eq!(s.behind, 0);
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert!(!s.upstream_gone);
    }

    #[test]
    fn status_parses_clean_synced_and_behind_only() {
        let s = parse_status_porcelain_b("## main...origin/main\n");
        assert!(!s.dirty);
        assert_eq!(s.ahead, 0);
        assert_eq!(s.behind, 0);
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));

        let s = parse_status_porcelain_b("## main...origin/main [behind 3]\n");
        assert_eq!(s.ahead, 0);
        assert_eq!(s.behind, 3);

        // ahead 与 behind 同时存在（分叉）
        let s = parse_status_porcelain_b("## main...origin/main [ahead 1, behind 2]\n");
        assert_eq!((s.ahead, s.behind), (1, 2));
    }

    #[test]
    fn status_parses_no_upstream_and_detached() {
        let s = parse_status_porcelain_b("## feature\n M x\n");
        assert!(s.dirty);
        assert_eq!(s.ahead, 0);
        assert_eq!(s.upstream, None);
        assert!(!s.upstream_gone);

        let s = parse_status_porcelain_b("## HEAD (no branch)\n");
        assert!(!s.dirty);
        assert_eq!(s.upstream, None);
    }

    #[test]
    fn status_parses_gone_upstream() {
        // 上游名仍在，但远程分支已被删除：ahead / behind 都无法比较
        let s = parse_status_porcelain_b("## main...origin/main [gone]\n");
        assert!(!s.dirty);
        assert_eq!(s.upstream.as_deref(), Some("origin/main"));
        assert!(s.upstream_gone);
        assert_eq!((s.ahead, s.behind), (0, 0));
    }

    #[test]
    fn decide_covers_three_ways() {
        assert_eq!(
            decide(&StatusSummary { dirty: true, ahead: 0, behind: 0, upstream: None, upstream_gone: false }),
            Decision::Commit
        );
        assert_eq!(
            decide(&StatusSummary {
                dirty: false,
                ahead: 1,
                behind: 0,
                upstream: Some("origin/x".into()),
                upstream_gone: false,
            }),
            Decision::Push
        );
        // 无上游：ahead 无法计数，但要让 push 去尝试（失败时给「设置上游」的 hint），而不是报 noop
        assert_eq!(
            decide(&StatusSummary { dirty: false, ahead: 0, behind: 0, upstream: None, upstream_gone: false }),
            Decision::Push
        );
        assert_eq!(
            decide(&StatusSummary {
                dirty: false,
                ahead: 0,
                behind: 0,
                upstream: Some("origin/x".into()),
                upstream_gone: false,
            }),
            Decision::Noop
        );
    }

    #[test]
    fn failure_hint_recognizes_common_git_errors() {
        assert!(failure_hint("fatal: The current branch feature has no upstream branch.").is_some());
        assert!(failure_hint("fatal: Could not read from remote repository.").is_some());
        assert!(failure_hint("! [rejected] main -> main (non-fast-forward)").is_some());
        assert!(failure_hint("some other failure").is_none());
    }

    #[test]
    fn classify_covers_partial_success_and_failure() {
        let ok = RunSignals { canceled: false, code: Some(0), out_tail: vec![], err_tail: vec![] };
        assert_eq!(classify(RunMode::Commit, &ok, true).0, CommitPhase::Committed);
        assert_eq!(classify(RunMode::Commit, &ok, false).0, CommitPhase::Noop);
        assert_eq!(classify(RunMode::Push, &ok, false).0, CommitPhase::Pushed);

        let canceled = RunSignals { canceled: true, code: Some(-1), out_tail: vec![], err_tail: vec![] };
        assert_eq!(classify(RunMode::Commit, &canceled, false).0, CommitPhase::Canceled);

        // commit 成功但 push 失败（部分成功）：退出码 1 + 错误摘要 + hint
        let failed = RunSignals {
            canceled: false,
            code: Some(1),
            out_tail: vec!["● Commit created.".into()],
            err_tail: vec!["fatal: The current branch feature has no upstream branch.".into()],
        };
        let (phase, error, hint) = classify(RunMode::Push, &failed, true);
        assert_eq!(phase, CommitPhase::Failed);
        assert!(error.as_deref().unwrap_or_default().contains("no upstream"));
        assert!(hint.is_some());
    }

    /// 真实仓库端到端（慢；手动跑：`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored`）。
    ///
    /// 覆盖两段式全链路：AI 提交（第一段）→ 快路径推送（第二段）→ 无上游分支的失败与 hint。
    /// 需要本机有 git 与 omp（含可用模型凭证）；临时目录自建自清，不碰任何真实仓库。
    #[tokio::test]
    #[ignore = "会 spawn 真实 omp commit（消耗一次 AI 调用，~30-60s）"]
    async fn real_repo_two_stage_flow() {
        use std::process::Stdio as PStdio;

        let Some(git) = git_bin().await else {
            eprintln!("skip: 未找到 git");
            return;
        };
        let Some(omp) = ["omp", "/opt/homebrew/bin/omp", "/usr/local/bin/omp"]
            .into_iter()
            .find(|c| {
                std::process::Command::new(c)
                    .arg("--version")
                    .stdout(PStdio::null())
                    .stderr(PStdio::null())
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false)
            })
        else {
            eprintln!("skip: 未找到 omp");
            return;
        };

        let root = std::env::temp_dir().join(format!("omp-commit-e2e-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        let work = root.join("work");
        let remote = root.join("remote");
        let w = work.to_string_lossy().to_string();
        let r = remote.to_string_lossy().to_string();

        let g = |dir: &str, args: &[&str]| {
            let out = std::process::Command::new(&git)
                .arg("-C")
                .arg(dir)
                .args(args)
                .output()
                .expect("git 启动失败");
            assert!(out.status.success(), "git {args:?} 失败：{}", String::from_utf8_lossy(&out.stderr));
            String::from_utf8_lossy(&out.stdout).trim().to_string()
        };

        // 布置：工作仓库 + bare 远端 + 已推送的初始提交
        std::fs::create_dir_all(&work).expect("建工作目录失败");
        std::process::Command::new(&git)
            .args(["init", "--initial-branch=main", &w])
            .output()
            .expect("git init 失败");
        std::process::Command::new(&git)
            .args(["init", "--bare", "--initial-branch=main", &r])
            .output()
            .expect("git init --bare 失败");
        g(&w, &["config", "user.email", "e2e@test.local"]);
        g(&w, &["config", "user.name", "omp e2e"]);
        std::fs::write(work.join("a.txt"), "hello\n").unwrap();
        g(&w, &["add", "."]);
        g(&w, &["commit", "-m", "chore: init"]);
        g(&w, &["remote", "add", "origin", &r]);
        g(&w, &["push", "-u", "origin", "HEAD"]);

        // 第一段：有改动 → 预检指向 Commit → AI 提交
        std::fs::write(work.join("b.txt"), "world\n").unwrap();
        let status = read_status(&git, &w).await.expect("预检失败");
        assert!(status.dirty);
        assert_eq!(decide(&status), Decision::Commit);

        let before = head_sha(&git, &w).await;
        let child = spawn_omp_commit(&omp, &w, false).expect("spawn 失败");
        let pid = child.id();
        let mut lines: Vec<String> = vec![];
        let signals = pump_omp_commit(child, pid, None, |l| lines.push(l.to_string())).await;
        let after = head_sha(&git, &w).await;
        let changed = after.is_some() && after != before;
        let (phase, error, _) = classify(RunMode::Commit, &signals, changed);
        assert_eq!(
            phase,
            CommitPhase::Committed,
            "code={:?} error={:?}\n日志：\n{}",
            signals.code,
            error,
            lines.join("\n")
        );
        let commits = commits_in_range(&git, &w, before.as_deref()).await;
        assert!(!commits.is_empty(), "应至少读到一个新提交");
        assert!(commits.iter().all(|c| !c.subject.trim().is_empty()));

        // 第一段之后：无改动 + ahead → 预检指向推送
        let status = read_status(&git, &w).await.expect("复检失败");
        assert!(!status.dirty);
        assert_eq!(decide(&status), Decision::Push);

        // 第二段：快路径推送（~2s，不再调用 AI）
        let child = spawn_omp_commit(&omp, &w, true).expect("spawn 失败");
        let pid = child.id();
        let signals = pump_omp_commit(child, pid, None, |_| {}).await;
        let (phase, error, _) = classify(RunMode::Push, &signals, false);
        assert_eq!(phase, CommitPhase::Pushed, "code={:?} error={:?}", signals.code, error);
        assert_eq!(g(&r, &["rev-parse", "HEAD"]), g(&w, &["rev-parse", "HEAD"]), "远端应收到了推送");

        // 失败路径：新分支无上游 → 推送失败 + hint（不消耗 AI——无改动走推送快路径）
        g(&w, &["checkout", "-b", "feature"]);
        std::fs::write(work.join("c.txt"), "x\n").unwrap();
        g(&w, &["add", "."]);
        g(&w, &["commit", "-m", "chore: local only"]);
        let status = read_status(&git, &w).await.expect("预检失败");
        assert_eq!(decide(&status), Decision::Push, "无上游也应尝试推送而不是报 noop");

        let child = spawn_omp_commit(&omp, &w, true).expect("spawn 失败");
        let pid = child.id();
        let signals = pump_omp_commit(child, pid, None, |_| {}).await;
        let (phase, error, hint) = classify(RunMode::Push, &signals, false);
        assert_eq!(phase, CommitPhase::Failed, "无上游的推送应失败：code={:?}", signals.code);
        assert!(hint.is_some(), "应给出设上游的 hint；错误：{error:?}");

        let _ = std::fs::remove_dir_all(&root);
    }
}
