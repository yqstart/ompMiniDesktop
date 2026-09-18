//! V11 终端工作区：per-终端 `omp` 交互进程（PTY）。
//!
//! 与 V1–V10 的 `runtime.rs`（`omp --mode rpc-ui` 长驻会话 + 协议解析）的根本差别：
//! 这里跑的是 omp 的**交互式 TUI**（无 `--mode` 参数），壳侧不理解、也不解析协议——
//! PTY 字节流原样转发给 xterm.js；审批 / 切换模型 / 压缩等全部由 TUI 自己处理。
//! 每个终端就是一个 omp 会话（TUI 落盘 jsonl，壳侧的会话弹窗仍读同一份真相）。
//!
//! 数据流：
//! ```text
//! master 读线程 → 增量 UTF-8 解码 → Channel<PtyEvent>{data} → 前端 xterm.write
//! 键盘 pty_write / 尺寸 pty_resize / 关闭 pty_kill ← 前端
//! ```
//!
//! 为什么是增量 UTF-8 解码（而不是 `from_utf8_lossy`，也不是 base64 全量转发）：
//! TUI 输出里的中文 / emoji 多字节序列会跨读块边界，lossy 会把撕裂处变成「�」；
//! base64 则让每一帧都要背上 33% 膨胀与一次前端解码。增量解码两头都不吃。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

use crate::commands::{cmd_err, AppState, CmdError};

/// 单个 UTF-8 字符最多 4 字节；残留超过它就是坏数据，不用再等。
const UTF8_MAX_SEQ: usize = 4;

/// spawn 序号：读线程收尾时用它确认「map 里的 handle 还是我这一次 spawn 的」，
/// 防止「杀掉后立刻以同一 id 重启」时旧读线程把新 handle 误删。
static SPAWN_SEQ: AtomicU64 = AtomicU64::new(1);

/// 一个终端的存活句柄。读线程独立持有 `Child`（wait 需要所有权），
/// 这里保留 writer / master / killer / pid 供写、resize、kill 三路使用。
///
/// `pid` 是子进程的进程号；PTY 里它就是**进程组长**（portable-pty spawn 时建了新会话），
/// 所以强杀可以打 `-pid` 覆盖它 fork 出来的工具子进程。
pub struct PtyHandle {
    seq: u64,
    pid: Option<u32>,
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    killer: Box<dyn ChildKiller + Send + Sync>,
}

/// 优雅终止 + 强制兜底：先发 portable-pty 的 kill（Unix 上是 SIGHUP），
/// 1 秒后仍在则 SIGKILL 整个进程组。
///
/// 为什么需要兜底：**omp 收到 SIGHUP 不一定退出**（实测 TUI 进程挂住，
/// `wait()` 永不返回）——只发 SIGHUP 会让「关闭终端」在后台留下僵尸进程、读线程永不收尾。
fn terminate(pid: Option<u32>, killer: &mut dyn ChildKiller) {
    let _ = killer.kill();
    let Some(pid) = pid else { return };
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(1000));
        force_kill_group(pid);
    });
}

/// SIGKILL 进程组（负 pid）；组不存在（不是组长）时退回单进程。
pub(crate) fn force_kill_group(pid: u32) {
    #[cfg(unix)]
    unsafe {
        if libc::kill(-(pid as i32), libc::SIGKILL) != 0 {
            libc::kill(pid as i32, libc::SIGKILL);
        }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
    }
}

/// 读线程收尾用：等子进程退出（最多 `grace`），超时则强杀进程组。
fn wait_with_grace(child: &mut Box<dyn Child + Send + Sync>, pid: Option<u32>, grace: Duration) -> Option<i32> {
    let deadline = std::time::Instant::now() + grace;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status.exit_code() as i32),
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => break,
        }
    }
    if let Some(pid) = pid {
        force_kill_group(pid);
    }
    child.wait().ok().map(|s| s.exit_code() as i32)
}

pub type PtyMap = Arc<Mutex<HashMap<String, PtyHandle>>>;

/// 发往前端的 PTY 事件（Channel 序列化，tag 区分）。
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum PtyEvent {
    Data { data: String },
    Exit { code: Option<i32> },
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PtySpawnOpts {
    /// 前端生成的终端 id（关闭 / 写入 / resize 都用它寻址）。
    pub id: String,
    /// 终端工作目录（工作区目录：项目主目录或 worktree）。
    pub cwd: String,
    pub cols: u16,
    pub rows: u16,
    /// 恢复历史会话（`omp --resume <id prefix>`）；None = 新会话。
    #[serde(default)]
    pub resume: Option<String>,
}

/// 从缓冲里取出「完整的 UTF-8 前缀」，不完整的尾部留在缓冲里等下一个读块。
///
/// 边界行为：
/// - 多字节字符被读块切开：前半留待拼接，不产出「�」（这是 TUI 输出最常见的情况）；
/// - 真的出现非法字节（或残留超过一个字符的最大长度仍拼不成）：按 lossy 摄入并清出，
///   否则坏数据会把后续所有输出永久卡在 pending 里。
pub fn drain_utf8(pending: &mut Vec<u8>) -> String {
    match std::str::from_utf8(pending) {
        Ok(s) => {
            let out = s.to_string();
            pending.clear();
            out
        }
        Err(e) => {
            let valid = e.valid_up_to();
            // valid_up_to 保证前缀合法；用 get 而不是 unwrap，防御性写法不该有 panic 面。
            let mut out = std::str::from_utf8(&pending[..valid]).unwrap_or_default().to_string();
            pending.drain(..valid);
            if e.error_len().is_some() || pending.len() > UTF8_MAX_SEQ {
                out.push_str(&String::from_utf8_lossy(pending));
                pending.clear();
            }
            out
        }
    }
}

/// 登录 shell 的 PATH（一次性探测 + 缓存）。
///
/// GUI 启动的 .app 只继承 launchd 的贫瘠 PATH（没有 /opt/homebrew/bin），
/// 终端里的 omp 连 git / node 都可能找不到——TUI 里 `bash` 工具跑用户项目命令必踩。
/// 让 PTY 进程继承登录 shell 的 PATH，与用户在真实终端里跑 omp 的环境对齐；
/// 探测失败（无 SHELL / 超时）就退回继承 env，不阻断启动。
static LOGIN_PATH: LazyLock<Option<String>> = LazyLock::new(|| {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut child = std::process::Command::new(&shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .ok()?;
    // 登录 shell 要跑一遍 rc，给 5s；超时直接放弃并杀掉探测进程。
    let deadline = std::time::Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if std::time::Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(50))
            }
            _ => {
                let _ = child.kill();
                return None;
            }
        }
    }
    let mut out = String::new();
    child.stdout.take()?.read_to_string(&mut out).ok()?;
    let path = out.trim().to_string();
    (!path.is_empty()).then_some(path)
});

pub(crate) fn login_path() -> Option<&'static str> {
    LOGIN_PATH.as_deref()
}

/// PTY 已建立、子进程已启动的原始句柄组（尚未登记进进程表）。
pub struct SpawnedPty {
    pub reader: Box<dyn Read + Send>,
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub killer: Box<dyn ChildKiller + Send + Sync>,
    pub child: Box<dyn Child + Send + Sync>,
}

/// 建 PTY 并启动一个子进程。抽成纯函数以便在真实 PTY 上做单测
/// （用 `/bin/sh` 验证读写回环与退出码，见文末）。
pub fn spawn_pty(bin: &str, args: &[String], cwd: &str, size: PtySize) -> Result<SpawnedPty, String> {
    let mut cmd = CommandBuilder::new(bin);
    for a in args {
        cmd.arg(a);
    }
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    if let Some(path) = login_path() {
        cmd.env("PATH", path);
    }

    let pty_system = native_pty_system();
    let pair = pty_system.openpty(size).map_err(|e| format!("创建 PTY 失败：{e}"))?;
    let child = pair.slave.spawn_command(cmd).map_err(|e| format!("启动进程失败：{e}"))?;
    // slave 在本进程里不再使用：必须尽早 drop，否则子进程退出后 master 读不到 EOF。
    drop(pair.slave);
    let reader = pair.master.try_clone_reader().map_err(|e| format!("PTY 读取端创建失败：{e}"))?;
    let writer = pair.master.take_writer().map_err(|e| format!("PTY 写入端创建失败：{e}"))?;
    let killer = child.clone_killer();
    Ok(SpawnedPty { reader, writer, master: pair.master, killer, child })
}

#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    opts: PtySpawnOpts,
    on_event: Channel<PtyEvent>,
) -> Result<(), CmdError> {
    let bin = {
        let cached = state.omp_path.lock().await.clone();
        cached.or_else(|| crate::commands::discover_omp_path(&state))
    };
    let Some(bin) = bin else {
        return Err(cmd_err(
            "OMP_MISSING",
            "未找到 omp，无法打开终端".into(),
            Some("请先安装 oh-my-pi 或在设置中指定路径".into()),
        ));
    };
    if !std::path::Path::new(&opts.cwd).is_dir() {
        return Err(cmd_err("DIR_MISSING", "工作目录不存在".into(), None));
    }
    {
        let map = state.pty.lock().unwrap_or_else(|e| e.into_inner());
        if map.contains_key(&opts.id) {
            return Err(cmd_err("ALREADY_EXISTS", "终端 id 已存在".into(), None));
        }
    }

    let mut args: Vec<String> = vec!["--cwd".into(), opts.cwd.clone()];
    if let Some(r) = &opts.resume {
        args.push("--resume".into());
        args.push(r.clone());
    }
    let size = PtySize { rows: opts.rows.max(2), cols: opts.cols.max(2), pixel_width: 0, pixel_height: 0 };
    let spawned = spawn_pty(&bin, &args, &opts.cwd, size)
        .map_err(|e| cmd_err("PTY_SPAWN", e, None))?;
    let SpawnedPty { reader, writer, master, killer, mut child } = spawned;
    let pid = child.process_id();

    let seq = SPAWN_SEQ.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = state.pty.lock().unwrap_or_else(|e| e.into_inner());
        map.insert(opts.id.clone(), PtyHandle { seq, pid, writer, master, killer });
    }

    // 读线程：阻塞读 → 增量解码 → 推 Channel；EOF（子进程退出）或前端断开后收尾。
    let id = opts.id.clone();
    let map_handle = state.pty.clone();
    std::thread::spawn(move || {
        let mut reader = reader;
        let mut buf = [0u8; 65536];
        let mut pending: Vec<u8> = Vec::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    pending.extend_from_slice(&buf[..n]);
                    let text = drain_utf8(&mut pending);
                    if !text.is_empty() && on_event.send(PtyEvent::Data { data: text }).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        // 收尾：EOF（进程自己退了）或前端断开。先 SIGHUP，给 1 秒优雅窗口；
        // 仍活着（omm TUI 不理会 SIGHUP 的场景）则强杀进程组——否则 wait 永久挂住。
        let _ = child.kill();
        let code = wait_with_grace(&mut child, pid, Duration::from_millis(1000));
        let _ = on_event.send(PtyEvent::Exit { code });
        // 只摘除「还是我这一次 spawn」的 handle：同 id 快速重启时不许误删新句柄。
        let mut map = map_handle.lock().unwrap_or_else(|e| e.into_inner());
        if map.get(&id).map(|h| h.seq) == Some(seq) {
            map.remove(&id);
        }
    });

    Ok(())
}

#[tauri::command]
pub fn pty_write(state: State<'_, AppState>, id: String, data: String) -> Result<(), CmdError> {
    let mut map = state.pty.lock().unwrap_or_else(|e| e.into_inner());
    let Some(h) = map.get_mut(&id) else {
        return Err(cmd_err("NOT_FOUND", "终端不存在".into(), None));
    };
    h.writer.write_all(data.as_bytes()).map_err(|e| cmd_err("PTY_WRITE", e.to_string(), None))?;
    h.writer.flush().map_err(|e| cmd_err("PTY_WRITE", e.to_string(), None))
}

#[tauri::command]
pub fn pty_resize(state: State<'_, AppState>, id: String, cols: u16, rows: u16) -> Result<(), CmdError> {
    let map = state.pty.lock().unwrap_or_else(|e| e.into_inner());
    let Some(h) = map.get(&id) else {
        return Err(cmd_err("NOT_FOUND", "终端不存在".into(), None));
    };
    h.master
        .resize(PtySize { rows: rows.max(2), cols: cols.max(2), pixel_width: 0, pixel_height: 0 })
        .map_err(|e| cmd_err("PTY_RESIZE", e.to_string(), None))
}

#[tauri::command]
pub fn pty_kill(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let mut map = state.pty.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(mut h) = map.remove(&id) {
        terminate(h.pid, h.killer.as_mut());
    }
    Ok(())
}

/// 应用退出前的收尾：杀掉全部终端进程（正常退出路径；崩溃残留接受为已知边界）。
/// 退出路径不等优雅窗口（进程马上没了，延迟补刀跑不到）——SIGHUP 之后直接 SIGKILL。
pub fn kill_all(map: &PtyMap) {
    let mut guard = map.lock().unwrap_or_else(|e| e.into_inner());
    for (_, mut h) in guard.drain() {
        let _ = h.killer.kill();
        if let Some(pid) = h.pid {
            force_kill_group(pid);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(chunks: &[&[u8]]) -> String {
        let mut pending = Vec::new();
        let mut out = String::new();
        for c in chunks {
            pending.extend_from_slice(c);
            out.push_str(&drain_utf8(&mut pending));
        }
        out
    }

    #[test]
    fn drain_pure_ascii() {
        assert_eq!(drain(&[b"hello world"]), "hello world");
    }

    #[test]
    fn drain_whole_multibyte() {
        assert_eq!(drain(&["你好".as_bytes()]), "你好");
    }

    #[test]
    fn drain_multibyte_split_across_chunks() {
        let s = "中文测试";
        let bytes = s.as_bytes();
        // 每个块切 1 字节：最严苛的撕裂场景，拼完必须还原
        let chunks: Vec<&[u8]> = bytes.chunks(1).collect();
        assert_eq!(drain(&chunks), s);
    }

    #[test]
    fn drain_emoji_split() {
        let s = "🚀 rocket";
        let bytes = s.as_bytes();
        let (a, b) = bytes.split_at(2); // emoji 是 4 字节，从中间切
        assert_eq!(drain(&[a, b]), s);
    }

    #[test]
    fn drain_ansi_sequence_split() {
        let bytes = b"\x1b[38;5;200mcolor\x1b[0m";
        let (a, b) = bytes.split_at(7);
        assert_eq!(drain(&[a, b]), String::from_utf8(bytes.to_vec()).unwrap());
    }

    #[test]
    fn drain_invalid_byte_is_lossy_but_progresses() {
        let out = drain(&[&[b'a', b'b', 0xff, b'c', b'd']]);
        assert!(out.starts_with("ab"));
        assert!(out.ends_with("cd"));
        assert!(out.contains('\u{fffd}'), "非法字节按替换字符摄入：{out:?}");
    }

    #[test]
    fn drain_oversized_pending_flushes() {
        // 5 个「都是续接字节」的坏数据（不可能是合法前缀），必须被清出而不是永久卡住
        let mut pending = vec![0x80u8; 5];
        let out = drain_utf8(&mut pending);
        assert!(!out.is_empty());
        assert!(pending.is_empty(), "坏数据必须清出，否则后续输出永久卡死");
    }

    #[test]
    fn drain_incomplete_tail_waits() {
        let mut pending = Vec::new();
        pending.extend_from_slice(&"中".as_bytes()[..2]);
        let out = drain_utf8(&mut pending);
        assert_eq!(out, "");
        assert_eq!(pending.len(), 2, "不完整字符要留到下一块");
    }

    /// 真实 PTY 回环：spawn `/bin/sh` 读一行再回显，写进去、读回来、退出码 0。
    /// 这条链路正是 xterm.js ← Channel ← 读线程 ← PTY master 的骨架（去掉 webview 段）。
    #[cfg(unix)]
    #[test]
    fn pty_write_then_read_roundtrip() {
        let mut p = spawn_pty(
            "/bin/sh",
            &["-c".into(), "read line && echo \"got:$line\"".into()],
            "/tmp",
            PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 },
        )
        .expect("PTY 启动失败");
        p.writer.write_all(b"ping\n").expect("写入 PTY 失败");
        p.writer.flush().expect("flush 失败");

        let mut reader = p.reader;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut out = String::new();
            let mut pending = Vec::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        pending.extend_from_slice(&buf[..n]);
                        out.push_str(&drain_utf8(&mut pending));
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(out);
        });
        let out = rx.recv_timeout(Duration::from_secs(10)).expect("PTY 输出超时（进程没收尾？）");
        assert!(out.contains("got:ping"), "PTY 读写回环失败：{out:?}");
        let status = p.child.wait().expect("wait 失败");
        assert_eq!(status.exit_code(), 0);
    }

    /// kill 路径：**忽略 SIGHUP 的进程**（omp TUI 的真实行为——只发 SIGHUP 会挂住）也必须被
    /// 收掉：`wait_with_grace` 的宽限期过后强杀进程组，wait 在秒级返回而不是永久阻塞。
    #[cfg(unix)]
    #[test]
    fn pty_kill_terminates_child_that_ignores_sighup() {
        let mut p = spawn_pty(
            "/bin/sh",
            &["-c".into(), "trap '' HUP; sleep 30".into()],
            "/tmp",
            PtySize { rows: 24, cols: 80, pixel_width: 0, pixel_height: 0 },
        )
        .expect("PTY 启动失败");
        let pid = p.child.process_id();
        let killer = &mut p.killer;
        let child = &mut p.child;
        let _ = killer.kill(); // SIGHUP 被 trap 忽略
        let code = wait_with_grace(child, pid, Duration::from_millis(300));
        assert!(code.is_some(), "宽限超时后强杀必须让 wait 返回：{code:?}");
    }

    /// 真实 omp TUI 走 portable-pty 的端到端：spawn `omp`（交互模式）→ 读到 TUI 画面 →
    /// kill → wait 返回。需要本机已装 omp；`cargo test -- --ignored` 手动跑。
    #[cfg(unix)]
    #[test]
    #[ignore]
    fn pty_spawns_real_omp_tui() {
        let bin = std::env::var("OMP_BIN").unwrap_or_else(|_| "/opt/homebrew/bin/omp".into());
        if !std::path::Path::new(&bin).is_file() {
            eprintln!("跳过：未找到 {bin}（设 OMP_BIN 指定路径）");
            return;
        }
        let dir = std::env::temp_dir().join(format!("omp-pty-it-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let mut p = spawn_pty(
            &bin,
            &["--cwd".into(), dir.to_string_lossy().to_string()],
            &dir.to_string_lossy(),
            PtySize { rows: 30, cols: 100, pixel_width: 0, pixel_height: 0 },
        )
        .expect("PTY 启动失败");

        let mut reader = p.reader;
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let mut buf = [0u8; 65536];
            let mut out = String::new();
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        out.push_str(&String::from_utf8_lossy(&buf[..n]));
                        // TUI 启动后一直在刷帧；收到足够样本即可收工
                        if out.len() > 20_000 {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            let _ = tx.send(out);
        });
        // 自己主动收手：omp TUI 不会退出，读满样本数后 kill（SIGHUP + 宽限 + 强杀兜底）
        let out = rx.recv_timeout(Duration::from_secs(20)).expect("20 秒内没读到 omp TUI 输出");
        let pid = p.child.process_id();
        let _ = p.killer.kill();
        let code = wait_with_grace(&mut p.child, pid, Duration::from_millis(1000));
        assert!(code.is_some(), "omp 必须在强杀兜底后退出");
        assert!(out.contains("Welcome") || out.contains('π'), "omp TUI 画面特征未出现（前 200 字节：{:?}）", &out[..out.len().min(200)]);
        assert!(out.contains('\u{1b}'), "TUI 应输出 ANSI 控制序列");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
