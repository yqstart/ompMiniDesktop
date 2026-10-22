//! 设置 ›「系统授权」：检测 macOS TCC 授权并跳到对应系统设置面板。
//!
//! 为什么需要它：computer use（omp 的截图 / AX 操作）走的是**本进程**的 TCC 归因——
//! omp 是壳 spawn 的子进程，责任进程（responsible process）就是 ompMiniDesktop 自己。
//! 用户在系统设置里「给了权限」不等于真的生效：ad-hoc 签名或证书轮换会让库里的旧记录
//! 与当前签名身份对不上（tccd 日志 `Failed to match existing code requirement`），
//! 界面上的开关却仍是开的。这里把四项授权做成可读的读数，并提供一键跳转。
//!
//! 四项与各自的可观测判据：
//! - 完全磁盘访问（Full Disk Access）：没有公开 API，用「能否读 TCC 库」探测（社区通行做法）；
//! - 辅助功能（Accessibility）：`AXIsProcessTrusted()`；
//! - 屏幕录制（Screen Capture）：`CGPreflightScreenCaptureAccess()`（macOS 10.15+）；
//! - 自动化（AppleEvents）：`AEDeterminePermissionToAutomateTarget` 以 System Events 为
//!   目标、`askUserIfNeeded = false`（**不会弹窗**；-1744 = 尚未决定，按未授权显示）。
//!
//! 非 macOS（Windows）返回 `supported: false`，界面据此只显示一句「仅 macOS 可用」。

use serde::Serialize;

/// 四项授权的快照（wire 上 camelCase，与前端类型一致）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPermissions {
    /// 平台是否支持这组检测（当前只有 macOS）。
    pub supported: bool,
    pub disk_access: bool,
    pub accessibility: bool,
    pub screen_capture: bool,
    pub automation: bool,
}

/// 读四项授权。纯本地查询（无子进程、无网络），可随面板高频轮询。
#[tauri::command]
pub fn get_system_permissions() -> SystemPermissions {
    platform::detect()
}

/// 打开系统设置里对应的授权面板（`kind` = `disk` / `accessibility` / `screenCapture` / `automation`）。
#[tauri::command]
pub fn open_system_permission(kind: String) -> Result<(), String> {
    platform::open(&kind)
}

/// 授权类型 → 系统设置锚点（纯映射，单测覆盖；未知类型不猜）。
fn settings_anchor(kind: &str) -> Option<&'static str> {
    match kind {
        "disk" => Some("Privacy_AllFiles"),
        "accessibility" => Some("Privacy_Accessibility"),
        "screenCapture" => Some("Privacy_ScreenCapture"),
        "automation" => Some("Privacy_Automation"),
        _ => None,
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use super::{settings_anchor, SystemPermissions};
    use std::ffi::c_void;
    use std::path::PathBuf;

    // ApplicationServices: Boolean AXIsProcessTrusted(void)
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> u8;
    }

    // CoreGraphics: bool CGPreflightScreenCaptureAccess(void)（10.15+，显式查询不弹窗）
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGPreflightScreenCaptureAccess() -> bool;
    }

    // Carbon / AE：自动化授权查询（只读，不触发系统确认框）
    #[repr(C)]
    struct AEDesc {
        descriptor_type: u32,
        data_handle: *mut c_void,
    }

    const TYPE_APPLICATION_BUNDLE_ID: u32 = 0x6275_6E64; // 'bund'
    const CORE_SUITE: u32 = 0x636F_7265; // 'core'
    const GET_DATA: u32 = 0x6765_7464; // 'getd'

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn AECreateDesc(
            type_code: u32,
            data_ptr: *const c_void,
            data_size: isize,
            result: *mut AEDesc,
        ) -> i32;
        fn AEDisposeDesc(desc: *mut AEDesc) -> i32;
        fn AEDeterminePermissionToAutomateTarget(
            target: *const AEDesc,
            the_ae_event_class: u32,
            the_ae_event_id: u32,
            ask_user_if_needed: u8,
        ) -> i32;
    }

    pub fn detect() -> SystemPermissions {
        SystemPermissions {
            supported: true,
            disk_access: has_full_disk_access(),
            // SAFETY: 两个函数只读 TCC 状态，无参数、无所有权转移。
            accessibility: unsafe { AXIsProcessTrusted() != 0 },
            screen_capture: unsafe { CGPreflightScreenCaptureAccess() },
            automation: automation_allowed(),
        }
    }

    pub fn open(kind: &str) -> Result<(), String> {
        let anchor = settings_anchor(kind).ok_or_else(|| format!("未知的授权类型：{kind}"))?;
        let url = format!("x-apple.systempreferences:com.apple.preference.security?{anchor}");
        // 不等待：`open` 只把 URL 交给 LaunchServices，系统设置窗口的启动与本命令无关。
        std::process::Command::new("open")
            .arg(&url)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("打开系统设置失败：{e}"))
    }

    /// 完全磁盘访问没有公开 API：受 TCC 保护的文件能读 = 已授权。
    ///
    /// TCC 库是最直接的判据；再兜一个 Safari 历史库（TCC 库不存在或被系统额外限制时）。
    /// 两个都读不到就是未授权——宁可显示「未授权」让用户去确认，也不假装已授权。
    fn has_full_disk_access() -> bool {
        let Some(home) = std::env::var_os("HOME").map(PathBuf::from) else {
            return false;
        };
        [
            "Library/Application Support/com.apple.TCC/TCC.db",
            "Library/Safari/History.db",
        ]
        .iter()
        .any(|rel| std::fs::File::open(home.join(rel)).is_ok())
    }

    /// 自动化（AppleEvents）以 System Events 为探针：omp 的 osascript 路径第一个碰的就是它。
    /// `AEDeterminePermissionToAutomateTarget(.., false)` 只查不弹；返回值 0 = 已允许。
    fn automation_allowed() -> bool {
        const BUNDLE: &[u8] = b"com.apple.systemevents";
        let mut target = AEDesc { descriptor_type: 0, data_handle: std::ptr::null_mut() };
        // SAFETY: 只读传入 bundle id 字节，desc 由 AECreateDesc 填充、随后由本函数释放。
        let created = unsafe {
            AECreateDesc(
                TYPE_APPLICATION_BUNDLE_ID,
                BUNDLE.as_ptr() as *const c_void,
                BUNDLE.len() as isize,
                &mut target,
            )
        };
        if created != 0 {
            return false;
        }
        // SAFETY: target 是上面创建的有效 AEDesc。
        let allowed = unsafe {
            AEDeterminePermissionToAutomateTarget(&target, CORE_SUITE, GET_DATA, 0) == 0
        };
        // SAFETY: 与 AECreateDesc 配对释放；失败也必须在同一条路径上释放。
        unsafe {
            AEDisposeDesc(&mut target);
        }
        allowed
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use super::{settings_anchor, SystemPermissions};

    pub fn detect() -> SystemPermissions {
        SystemPermissions {
            supported: false,
            disk_access: true,
            accessibility: true,
            screen_capture: true,
            automation: true,
        }
    }

    pub fn open(kind: &str) -> Result<(), String> {
        let _ = settings_anchor(kind).ok_or_else(|| format!("未知的授权类型：{kind}"))?;
        Err("系统授权只在 macOS 上可用".into())
    }
}

#[cfg(test)]
mod tests {
    use super::settings_anchor;

    #[test]
    fn anchors_cover_all_supported_kinds() {
        assert_eq!(settings_anchor("disk"), Some("Privacy_AllFiles"));
        assert_eq!(settings_anchor("accessibility"), Some("Privacy_Accessibility"));
        assert_eq!(settings_anchor("screenCapture"), Some("Privacy_ScreenCapture"));
        assert_eq!(settings_anchor("automation"), Some("Privacy_Automation"));
    }

    #[test]
    fn unknown_kind_is_rejected() {
        assert_eq!(settings_anchor("camera"), None);
        assert_eq!(settings_anchor(""), None);
    }

    /// FFI 边界冒烟：真实调用四项查询（无授权环境返回 false 是正常结果，**不许 panic**）。
    #[test]
    fn detect_reads_without_panicking() {
        let state = super::platform::detect();
        #[cfg(target_os = "macos")]
        assert!(state.supported);
        #[cfg(not(target_os = "macos"))]
        assert!(!state.supported);
    }
}
