//! 进程与环境工具（登录 shell PATH 探测、进程组强杀），复用方 = git_commit / commit_msg / omp_update。

use std::io::Read;
use std::sync::LazyLock;
use std::time::Duration;

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

/// 登录 shell 的 PATH（一次性探测 + 缓存）。
///
/// GUI 启动的 .app 只继承 launchd 的贫瘠 PATH（没有 /opt/homebrew/bin），
/// 壳内子进程（omp 会话 / git / 提交与更新任务）连 git / node 都可能找不到。
/// 让它们继承登录 shell 的 PATH，与用户在真实终端里跑 omp 的环境对齐；
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
