use serde::Serialize;
use std::{collections::HashMap, path::PathBuf};
use tokio::sync::Mutex;
use tauri::{AppHandle, Manager, State};

use crate::{overlay::*, session_scan::*};

pub struct AppState {
    pub overlay_path: PathBuf,
    pub overlay: Mutex<Overlay>,
    pub agent_dir: Mutex<PathBuf>,
    pub omp_path: Mutex<Option<String>>,
    pub omp_version: Mutex<Option<String>>,
    pub models_cache: Mutex<Option<(i64, serde_json::Value)>>,
    /// 进行中的供应商登录（同一时刻只允许一个）。
    pub login: std::sync::Arc<Mutex<Option<crate::providers::LoginSession>>>,
    /// 最近一次登录的进度快照（切走设置页再回来时用它补齐，见 `providers.rs`）。
    pub login_status: std::sync::Arc<Mutex<crate::providers::LoginStatus>>,
    /// 模型角色「读 → 改 → 写」的串行锁：`modelRoles` 是 record，只能整表写回，
    /// 两次并发编辑不加锁会互相覆盖（丢键）。
    pub roles_edit: Mutex<()>,
    /// 失败转移链（`retry.fallbackChains`）的同类锁：record 也只能整表写回。
    pub retry_edit: Mutex<()>,
    /// 自定义模型配置（`models.yml`）的读写锁：写入含「预校验 + 备份 + 替换」多步，
    /// 并发保存会互相覆盖（见 `models_config.rs`）。
    pub models_edit: Mutex<()>,
    /// V11 终端工作区：per-终端 `omp` TUI 进程表（PTY，见 `pty.rs`）。
    pub pty: crate::pty::PtyMap,
}

#[derive(Debug, Serialize)]
pub struct CmdError {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
}

pub fn cmd_err(code: &str, message: String, hint: Option<String>) -> CmdError {
    CmdError { ok: false, code: code.into(), message, hint }
}

pub(crate) fn save_overlay(state: &State<AppState>) -> Result<(), String> {
    let text = {
        let ov = state.overlay.try_lock().map_err(|_| "overlay 忙，请重试".to_string())?;
        serde_json::to_string_pretty(&*ov).map_err(|e| e.to_string())?
    };
    if let Some(parent) = state.overlay_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = state.overlay_path.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &state.overlay_path).map_err(|e| e.to_string())?;
    Ok(())
}

fn load_overlay(path: &std::path::Path) -> (Overlay, bool) {
    let Ok(text) = std::fs::read_to_string(path) else { return (Overlay::default(), false) };
    let Ok(v) = serde_json::from_str::<Overlay>(&text) else {
        let bak = path.with_extension("bak");
        let _ = std::fs::copy(path, &bak);
        return (Overlay::default(), true);
    };
    v.normalize()
}

// ---------- omp 定位 ----------

fn run_cmd(file: &str, args: &[&str]) -> Result<String, String> {
    let out = std::process::Command::new(file)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

pub fn discover_omp_path(state: &State<AppState>) -> Option<String> {
    if let Ok(ov) = state.overlay.try_lock() {
        if let Some(p) = ov.omp_path.as_ref() {
            if std::path::Path::new(p).is_file() {
                return Some(p.clone());
            }
        }
    }
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    if let Ok(out) = run_cmd(&shell, &["-ilc", "command -v omp"]) {
        if let Some(found) = out.lines().map(str::trim).filter(|l| l.starts_with('/')).last() {
            if std::path::Path::new(found).is_file() {
                return Some(found.to_string());
            }
        }
    }
    for c in ["/opt/homebrew/bin/omp", "/usr/local/bin/omp"] {
        if std::path::Path::new(c).is_file() {
            return Some(c.to_string());
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = format!("{home}/.local/bin/omp");
        if std::path::Path::new(&p).is_file() {
            return Some(p);
        }
    }
    None
}

#[derive(Debug, Clone, Serialize)]
pub struct OmpInfo {
    #[serde(rename = "ompPath")]
    pub omp_path: Option<String>,
    #[serde(rename = "ompVersion")]
    pub omp_version: Option<String>,
    #[serde(rename = "agentDir")]
    pub agent_dir: String,
    pub errors: Vec<String>,
}

/// 后端工具函数：解析一次 omp 定位与版本（不触碰 State，供 Tauri commands 与内部调用共用）。
/// 必须 anyhow 化：任何失败都返回 Err(String)，调用方自行决定降级。
fn probe_omp(bin: &str) -> Result<(Option<String>, std::path::PathBuf, Vec<String>), String> {
    let mut errors = vec![];
    let mut version = None;
    match run_cmd(bin, &["--version"]) {
        Ok(out) => {
            let text = out.trim().to_string();
            version = text.split_whitespace().next().map(|s| s.trim_start_matches("omp/").to_string()).or(Some(text));
        }
        Err(e) => errors.push(format!("omp --version 失败：{e}")),
    }
    let mut agent_dir = resolve_agent_dir(None);
    match run_cmd(bin, &["config", "path"]) {
        Ok(out) => {
            agent_dir = resolve_agent_dir(Some(out));
        }
        Err(e) => errors.push(format!("omp config path 失败：{e}")),
    }
    Ok((version, agent_dir, errors))
}

#[tauri::command]
pub async fn locate_omp(state: State<'_, AppState>) -> Result<OmpInfo, CmdError> {
    let resolved = discover_omp_path(&state);
    let (mut version, mut agent_dir, mut errors) = (None, resolve_agent_dir(None), vec![]);
    if let Some(ref p) = resolved {
        match probe_omp(p) {
            Ok((v, dir, errs)) => {
                version = v;
                agent_dir = dir;
                errors = errs;
            }
            Err(e) => errors.push(e),
        }
    } else {
        errors.push("未找到 omp 可执行文件，请安装 oh-my-pi 或手动指定路径".into());
    }
    *state.omp_path.lock().await = resolved.clone();
    *state.omp_version.lock().await = version.clone();
    *state.agent_dir.lock().await = agent_dir.clone();
    Ok(OmpInfo {
        omp_path: resolved,
        omp_version: version,
        agent_dir: agent_dir.to_string_lossy().to_string(),
        errors,
    })
}

#[tauri::command]
pub async fn set_omp_path(state: State<'_, AppState>, path: Option<String>) -> Result<OmpInfo, CmdError> {
    if let Ok(mut ov) = state.overlay.try_lock() {
        ov.omp_path = path;
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    locate_omp(state).await
}

#[derive(Debug, Clone, Serialize)]
pub struct HealthInfo {
    pub omp: OmpInfo,
    #[serde(rename = "modelsError")]
    pub models_error: Option<String>,
    pub ok: bool,
}

#[tauri::command]
pub async fn get_health(state: State<'_, AppState>) -> Result<HealthInfo, CmdError> {
    let omp = locate_omp(state.clone()).await?;
    let mut models_error = None;
    if let Some(ref p) = omp.omp_path {
        if let Err(e) = run_cmd(p, &["models", "--json"]) {
            models_error = Some(format!("模型目录加载失败：{e}"));
        }
    } else {
        models_error = Some("未找到 omp，无法加载模型目录".into());
    }
    let ok = omp.omp_path.is_some() && models_error.is_none();
    Ok(HealthInfo { omp, models_error, ok })
}

// ---------- overlay ----------

#[tauri::command]
pub async fn get_overlay(state: State<'_, AppState>) -> Result<Overlay, CmdError> {
    Ok(state.overlay.lock().await.clone())
}

// ---------- 模型 ----------

#[tauri::command]
pub async fn get_models(state: State<'_, AppState>) -> Result<serde_json::Value, CmdError> {
    if let Some((at, v)) = state.models_cache.lock().await.clone() {
        if chrono::Utc::now().timestamp_millis() - at < 5 * 60_000 {
            return Ok(v);
        }
    }
    refresh_models(state).await
}

#[tauri::command]
pub async fn refresh_models(state: State<'_, AppState>) -> Result<serde_json::Value, CmdError> {
    // omp 定位走 `discover_omp_path`（唯一入口：覆盖层 → 登录 shell → 常见路径），
    // 而不是诊断状态里的 `state.omp_path`——那个只在 `locate_omp` 成功后才非空，
    // 用它会让「诊断还没跑完 / 探测失败」连模型目录一起拖垮（供应商页与 ModelPicker 都会中招）。
    let Some(p) = discover_omp_path(&state) else {
        return Err(cmd_err("OMP_MISSING", "未找到 omp，无法加载模型目录".into(), Some("请先安装 oh-my-pi".into())));
    };
    *state.omp_path.lock().await = Some(p.clone());
    let out = run_cmd(&p, &["models", "--json"])
        .map_err(|e| cmd_err("MODELS_FAILED", format!("模型目录加载失败：{e}"), Some("重试或检查网络".into())))?;
    let v: serde_json::Value =
        serde_json::from_str(&out).map_err(|e| cmd_err("MODELS_PARSE", format!("模型目录解析失败：{e}"), None))?;
    let catalog = serde_json::json!({
        "models": v.get("models").cloned().unwrap_or(serde_json::Value::Array(vec![])),
        "fetchedAt": chrono::Utc::now().timestamp_millis(),
    });
    *state.models_cache.lock().await = Some((chrono::Utc::now().timestamp_millis(), catalog.clone()));
    Ok(catalog)
}

// ---------- 项目 ----------

#[derive(Debug, Clone, Serialize)]
pub struct ProjectView {
    pub id: String,
    pub path: String,
    pub name: String,
    pub missing: bool,
    #[serde(rename = "sessionCount")]
    pub session_count: usize,
}

fn project_views(state: &State<AppState>) -> Vec<ProjectView> {
    let (projects, sessions_root) = match (state.overlay.try_lock(), state.agent_dir.try_lock()) {
        (Ok(ov), Ok(agent)) => (ov.projects.clone(), agent.join("sessions")),
        _ => return vec![],
    };
    projects
        .iter()
        .map(|p| {
            let name = std::path::Path::new(&p.path)
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or(&p.path)
                .to_string();
            let missing = !std::path::Path::new(&p.path).exists();
            let count = count_sessions_for(&sessions_root, &p.path);
            ProjectView { id: p.id.clone(), path: p.path.clone(), name, missing, session_count: count }
        })
        .collect()
}

fn count_sessions_for(root: &std::path::Path, project_path: &str) -> usize {
    let mut n = 0;
    let Ok(rd) = std::fs::read_dir(root) else { return 0 };
    for entry in rd.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let Ok(files) = std::fs::read_dir(&dir) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            // 只读前 64KB 找 session.cwd
            let Ok(text) = read_head_text(&p, 65536) else { continue };
            for line in text.lines().take(40) {
                let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
                if v.get("type").and_then(|t| t.as_str()) == Some("session") {
                    let cwd = v.get("cwd").and_then(|c| c.as_str()).unwrap_or("");
                    if project_of(cwd, &[project_path.to_string()]).is_some() {
                        n += 1;
                    }
                    break;
                }
            }
        }
    }
    n
}

fn read_head_text(p: &std::path::Path, limit: usize) -> std::io::Result<String> {
    use std::io::Read;
    let mut f = std::fs::File::open(p)?;
    let mut buf = vec![0u8; limit];
    let n = f.read(&mut buf)?;
    Ok(String::from_utf8_lossy(&buf[..n]).to_string())
}

#[tauri::command]
pub async fn list_projects(state: State<'_, AppState>) -> Result<Vec<ProjectView>, CmdError> {
    Ok(project_views(&state))
}

#[tauri::command]
pub async fn add_project(state: State<'_, AppState>, path: String) -> Result<ProjectView, CmdError> {
    let norm = normalize_path(&path);
    let md = std::fs::metadata(&norm).map_err(|_| cmd_err("DIR_MISSING", "目录不存在，只能移除或重定位".into(), None))?;
    if !md.is_dir() {
        return Err(cmd_err("NOT_DIR", "所选路径不是目录".into(), None));
    }
    if let Ok(home) = std::env::var("HOME") {
        if normalize_path(&home) == norm {
            return Err(cmd_err("HOME_ROOT", "不能把 $HOME 根目录作为项目".into(), None));
        }
    }
    {
        let mut ov = state.overlay.lock().await;
        if let Some(exist) = ov.projects.iter().find(|p| normalize_path(&p.path) == norm) {
            let id = exist.id.clone();
            drop(ov);
            return project_views(&state).into_iter().find(|v| v.id == id).ok_or(cmd_err("INTERNAL", "项目状态不一致".into(), None));
        }
        let id = format!("p{}", chrono::Utc::now().timestamp_millis());
        ov.projects.push(Project { id: id.clone(), path: norm.clone(), added_at: chrono::Utc::now().timestamp_millis(), last_model: None, last_thinking: None });
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    project_views(&state).into_iter().find(|v| v.path == norm).ok_or(cmd_err("INTERNAL", "项目状态不一致".into(), None))
}

#[tauri::command]
pub async fn remove_project(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    // 语义（对齐“删除工作区”）：仅解绑项目，不删任何会话文件；
    // 该项目下全部会话标记归档保留（删后进“未归属会话”），备注/权限覆盖一并保留。
    let proj_path = {
        let ov = state.overlay.lock().await;
        let Some(proj) = ov.projects.iter().find(|p| p.id == id) else {
            return Err(cmd_err("NOT_FOUND", "项目不存在".into(), None));
        };
        proj.path.clone()
    };
    // 以后端扫描为准找该项目会话（读 jsonl 头 cwd 前缀匹配，不猜 slug）
    let agent = state.agent_dir.lock().await.clone();
    let sids = session_ids_for(&agent.join("sessions"), &proj_path);
    {
        let mut ov = state.overlay.lock().await;
        ov.projects.retain(|p| p.id != id);
        for sid in sids {
            ov.archived.insert(sid, true);
        }
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
}

fn session_ids_for(root: &std::path::Path, project_path: &str) -> Vec<String> {
    let mut out = vec![];
    let Ok(rd) = std::fs::read_dir(root) else { return out };
    for entry in rd.flatten() {
        let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let head = parse_session_head(&p);
            if !head.corrupt && project_of(&head.cwd, &[project_path.to_string()]).is_some() {
                out.push(head.id);
            }
        }
    }
    out
}

#[tauri::command]
pub async fn relocate_project(state: State<'_, AppState>, id: String, path: String) -> Result<ProjectView, CmdError> {
    let norm = normalize_path(&path);
    if !std::path::Path::new(&norm).is_dir() {
        return Err(cmd_err("DIR_MISSING", "目录不存在，只能移除或重定位".into(), None));
    }
    {
        let mut ov = state.overlay.lock().await;
        let Some(p) = ov.projects.iter_mut().find(|p| p.id == id) else {
            return Err(cmd_err("NOT_FOUND", "项目不存在".into(), None));
        };
        p.path = norm;
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    project_views(&state).into_iter().find(|v| v.id == id).ok_or(cmd_err("INTERNAL", "项目状态不一致".into(), None))
}

// ---------- 工作区（V11 左栏树：项目 → 主目录 + git worktree） ----------

/// 左栏工作区行：项目主目录或它的一个 git worktree。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    #[serde(rename = "projectId")]
    pub project_id: String,
    #[serde(rename = "projectName")]
    pub project_name: String,
    /// 工作目录：主目录 = 项目路径；worktree = worktree 路径。
    pub path: String,
    /// 检出的分支；detached / 非 git 仓库为 null。
    pub branch: Option<String>,
    /// detached 时的短 sha（用于展示「游离」）。
    pub head: Option<String>,
    /// 主目录（项目本体）还是 worktree。
    #[serde(rename = "isMain")]
    pub is_main: bool,
    /// 目录不存在（worktree 被手工删掉 / 项目目录被移走）。
    pub missing: bool,
}

fn project_display_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(path)
        .to_string()
}

/// 左栏树数据源：每个项目 = 主目录行 + 该仓库的全部 worktree 行。
///
/// worktree 真相 = `git worktree list --porcelain`（手工 `git worktree add` 的也在），
/// 而不是 `omp worktree list`（只登记 `~/.omp/wt` 下的）；创建路径才走 omp 的约定。
#[tauri::command]
pub async fn list_workspaces(state: State<'_, AppState>) -> Result<Vec<WorkspaceView>, CmdError> {
    let projects: Vec<(String, String, String)> = {
        let ov = state.overlay.lock().await;
        ov.projects.iter().map(|p| (p.id.clone(), p.path.clone(), project_display_name(&p.path))).collect()
    };
    let git = crate::git_info::git_bin().await;
    let mut out: Vec<WorkspaceView> = vec![];
    for (id, path, name) in projects {
        let missing = !std::path::Path::new(&path).is_dir();
        let wts = match (&git, missing) {
            (Some(g), false) => crate::git_info::list_worktrees(g, &path).await,
            _ => vec![],
        };
        // 主目录行的分支取 porcelain 第一块（git 约定第一块是主 worktree）；
        // 路径仍用项目自己的写法（git 回读的可能是 /private 归一后的形式）。
        let main = wts.first();
        out.push(WorkspaceView {
            project_id: id.clone(),
            project_name: name.clone(),
            path: path.clone(),
            branch: main.and_then(|w| w.branch.clone()),
            head: main.and_then(|w| w.head.clone()),
            is_main: true,
            missing,
        });
        for w in wts.iter().skip(1) {
            if w.path == path || !std::path::Path::new(&w.path).is_dir() {
                continue;
            }
            out.push(WorkspaceView {
                project_id: id.clone(),
                project_name: name.clone(),
                path: w.path.clone(),
                branch: w.branch.clone(),
                head: w.head.clone(),
                is_main: false,
                missing: false,
            });
        }
    }
    Ok(out)
}

/// 「确保某分支有一个可工作的目录」：
/// - 该分支已检出（主目录或任一 worktree）→ 直接返回那个工作区，不重复创建；
/// - 否则 `omp worktree add` 到 `~/.omp/wt/<repo>-<branch-slug>`（clone-first 与
///   管理目录都是 omp 的既有约定，壳侧不自造）。
///
/// `new_branch=true` 表示分支尚不存在、要新建（`-b`）；false = 检出已有分支。
#[tauri::command]
pub async fn create_worktree(
    state: State<'_, AppState>,
    project_id: String,
    branch: String,
    new_branch: bool,
) -> Result<WorkspaceView, CmdError> {
    let branch = branch.trim().to_string();
    // git 分支名的保守子集校验（真正的合法性由 git 判定，这里只挡明显坏输入：
    // 空、空白、`..`、以 `-` 开头、路径分隔符——它们要么会让 git 报难懂的错，要么是注入面）。
    if branch.is_empty()
        || branch.contains(char::is_whitespace)
        || branch.contains("..")
        || branch.starts_with('-')
        || branch.starts_with('/')
        || branch.ends_with('/')
        || branch.ends_with(".lock")
        || branch.contains("@{")
        || branch.contains('\\')
    {
        return Err(cmd_err("BAD_BRANCH", "分支名不合法".into(), None));
    }
    let (proj_path, proj_name) = {
        let ov = state.overlay.lock().await;
        let Some(p) = ov.projects.iter().find(|p| p.id == project_id) else {
            return Err(cmd_err("NOT_FOUND", "项目不存在".into(), None));
        };
        (p.path.clone(), project_display_name(&p.path))
    };
    if !std::path::Path::new(&proj_path).is_dir() {
        return Err(cmd_err("DIR_MISSING", "项目目录不存在".into(), None));
    }
    let git = crate::git_info::git_bin().await;
    // 已检出 → 幂等返回（含主目录：分支就在那里）
    if let Some(g) = &git {
        for (i, w) in crate::git_info::list_worktrees(g, &proj_path).await.iter().enumerate() {
            if w.branch.as_deref() == Some(branch.as_str()) {
                return Ok(WorkspaceView {
                    project_id,
                    project_name: proj_name,
                    path: if i == 0 { proj_path.clone() } else { w.path.clone() },
                    branch: w.branch.clone(),
                    head: w.head.clone(),
                    is_main: i == 0,
                    missing: false,
                });
            }
        }
    }
    let bin = discover_omp_path(&state)
        .ok_or_else(|| cmd_err("OMP_MISSING", "未找到 omp，无法创建 worktree".into(), None))?;
    *state.omp_path.lock().await = Some(bin.clone());
    let home = std::env::var("HOME").map_err(|_| cmd_err("NO_HOME", "无法确定 HOME 目录".into(), None))?;
    let slug = branch.replace('/', "-");
    let wt_path = format!("{home}/.omp/wt/{proj_name}-{slug}");
    let mut args: Vec<String> = vec!["worktree".into(), "add".into(), "-q".into()];
    if new_branch {
        args.push("-b".into());
        args.push(branch.clone());
    }
    args.push(wt_path.clone());
    if !new_branch {
        args.push(branch.clone());
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    crate::providers::run_omp_in(Some(std::path::Path::new(&proj_path)), &bin, &arg_refs)
        .await
        .map_err(|e| cmd_err("WORKTREE_ADD", format!("创建 worktree 失败：{e}"), None))?;
    Ok(WorkspaceView {
        project_id,
        project_name: proj_name,
        path: wt_path,
        branch: Some(branch),
        head: None,
        is_main: false,
        missing: false,
    })
}

/// 归属匹配集：项目路径 ∪ 其全部 worktree 路径（同 project id）。
/// V11：终端工作区在 worktree 里开的会话（jsonl cwd = worktree 目录）必须归到所属项目——
/// 否则会话弹窗与归档清单都看不见它们（掉进「未归属」）。
pub async fn ownership_scope(projects: &[(String, String)]) -> Vec<(String, String)> {
    let mut out = projects.to_vec();
    let Some(git) = crate::git_info::git_bin().await else { return out };
    for (id, path) in projects {
        if !std::path::Path::new(path).is_dir() {
            continue;
        }
        for wt in crate::git_info::list_worktrees(&git, path).await {
            if !wt.main && !wt.path.is_empty() {
                out.push((id.clone(), wt.path));
            }
        }
    }
    out
}

// ---------- 会话 ----------

#[derive(Debug, Clone, Serialize)]
pub struct SessionView {
    pub id: String,
    #[serde(rename = "projectId")]
    pub project_id: Option<String>,
    pub title: String,
    pub cwd: String,
    pub timestamp: i64,
    pub archived: bool,
    pub corrupt: bool,
    pub note: Option<String>,
}

fn display_title(note: Option<&String>, head_title: &str, ts: i64) -> String {
    if let Some(n) = note {
        if !n.trim().is_empty() {
            return n.clone();
        }
    }
    if !head_title.trim().is_empty() {
        return head_title.to_string();
    }
    format!("未命名会话 {}", chrono::DateTime::from_timestamp_millis(ts).map(|d| d.format("%m-%d").to_string()).unwrap_or_default())
}

/// 会话列表分页（V2 M7a）：`totalFiles` = sessions 目录下的 jsonl 总数，
/// `scannedFiles` = 本次真正解析头部的文件数（默认最近 500 个）。
/// 前端据此显示「已扫描最近 N 个（共 M 个）」并允许继续加载更老的会话。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionPage {
    pub sessions: Vec<SessionView>,
    pub total_files: usize,
    pub scanned_files: usize,
}

/// 扫描窗口：`limit` 默认 500、夹在 1..=5000；`offset` 无上限（超出即空窗口）。
pub fn scan_window(limit: Option<usize>, offset: Option<usize>) -> (usize, usize) {
    let limit = limit.unwrap_or(500).clamp(1, 5000);
    (limit, offset.unwrap_or(0))
}

#[tauri::command]
pub async fn list_sessions(
    state: State<'_, AppState>,
    project_id: Option<String>,
    limit: Option<usize>,
    offset: Option<usize>,
) -> Result<SessionPage, CmdError> {
    let ov = state.overlay.lock().await;
    let agent = state.agent_dir.lock().await.clone();
    let paths: Vec<(String, String)> = ov.projects.iter().map(|p| (p.id.clone(), p.path.clone())).collect();
    // 只列某个项目的会话：按 id 过滤（归属已算成 id，不必再拿路径比一遍）
    let only: Option<String> = project_id.filter(|pid| ov.projects.iter().any(|p| p.id == *pid));
    drop(ov);
    // 归属匹配集含工作区 worktree：在 worktree 里跑的会话也归到项目（V11）
    let scope = ownership_scope(&paths).await;
    let mut out: Vec<SessionView> = vec![];
    // 损坏文件也列出（M1-1 要求可删）：按文件兜底一行
    let root = agent.join("sessions");
    // 规模保护（V2 M7a 起可分页）：sessions 目录按修改时间倒序取「窗口」再解析。
    // 共享 agentDir / 长期使用后动辄上千个会话文件，逐个读头尾也会拖慢列表；
    // 列表本来就按时间倒序展示，窗口外都是更老的会话——前端用 `scannedFiles/totalFiles`
    // 告诉用户还有多少没扫，并按 500 递增重扫。
    let (limit, offset) = scan_window(limit, offset);
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = vec![];
    let Ok(rd) = std::fs::read_dir(&root) else {
        return Ok(SessionPage { sessions: out, total_files: 0, scanned_files: 0 });
    };
    for entry in rd.flatten() {
        let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            let mtime = f.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
            candidates.push((mtime, p));
        }
    }
    let total_files = candidates.len();
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    if total_files > limit + offset {
        eprintln!(
            "[list_sessions] 共 {} 个会话文件，本次窗口 offset={} limit={}",
            total_files, offset, limit
        );
    }
    let window: Vec<(std::time::SystemTime, PathBuf)> =
        candidates.into_iter().skip(offset).take(limit).collect();
    let scanned_files = window.len();
    for (_mtime, p) in window {
        {
            let head = parse_session_head(&p);
            let ov = state.overlay.lock().await;
            if head.corrupt {
                out.push(SessionView {
                    id: head.id.clone(),
                    project_id: None,
                    title: "已损坏，可删除".into(),
                    cwd: String::new(),
                    timestamp: 0,
                    archived: false,
                    corrupt: true,
                    note: None,
                });
                continue;
            }
            let owner = owner_project(&scope, &head.cwd);
            if let Some(want) = &only {
                if owner.as_deref() != Some(want.as_str()) {
                    continue;
                }
            }
            let archived = ov.archived.get(&head.id).copied().unwrap_or(false);
            let note = ov.notes.get(&head.id).cloned();
            out.push(SessionView {
                title: display_title(note.as_ref(), &head.title, head.timestamp),
                project_id: owner,
                cwd: head.cwd.clone(),
                timestamp: head.timestamp,
                archived,
                corrupt: false,
                note,
                id: head.id.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(SessionPage { sessions: out, total_files, scanned_files })
}

/// 已归档对话清单（设置页「已归档对话」tab）。
///
/// 与 `list_sessions` 的关键差别：**不受扫描窗口限制**。归档是管理面——归档的意义就是
/// 把老会话收起来，它们大概率落在窗口之外，被窗口截掉等于「归档即失踪」。所以这里不看
/// mtime 窗口，只按覆盖层 `archived` 标记逐个定位文件。代价可控：**只读那些文件名里带
/// 归档 id 前缀的文件**（与 `session_file_for` 同一套约定），不做全量头部解析。
#[tauri::command]
pub async fn list_archived_sessions(state: State<'_, AppState>) -> Result<Vec<SessionView>, CmdError> {
    let ov = state.overlay.lock().await;
    let archived = ov.archived.clone();
    let notes = ov.notes.clone();
    let projects: Vec<(String, String)> = ov.projects.iter().map(|p| (p.id.clone(), p.path.clone())).collect();
    drop(ov);
    let agent = state.agent_dir.lock().await.clone();
    // 归属匹配集含 worktree（与 list_sessions 同一口径）
    let scope = ownership_scope(&projects).await;
    Ok(list_archived_in(&agent.join("sessions"), &archived, &scope, &notes))
}

/// 归档清单核心（不碰 tauri，可在临时目录上做真实行为测试）。
/// `archived` 里 value 为 true 的 id 才算归档；覆盖层里残留的失效 id（文件已被删）自然落空。
pub fn list_archived_in(
    root: &std::path::Path,
    archived: &HashMap<String, bool>,
    projects: &[(String, String)],
    notes: &HashMap<String, String>,
) -> Vec<SessionView> {
    let wanted: Vec<&String> = archived.iter().filter(|(_, v)| **v).map(|(id, _)| id).collect();
    if wanted.is_empty() {
        return vec![];
    }
    let Ok(rd) = std::fs::read_dir(root) else { return vec![] };
    let prefixes: Vec<String> = wanted.iter().map(|id| id.chars().take(8).collect()).collect();
    let mut out: Vec<SessionView> = vec![];
    for entry in rd.flatten() {
        let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
        for f in files.flatten() {
            let path = f.path();
            if path.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
            // 文件名前缀里带归档 id（真实布局：`sessions/<slug>/<时间戳>_<id>.jsonl`，
            // 与 `session_file_for` 同一套约定位），用整条路径比以免漏掉 id 落在目录名上的情况
            let full = path.to_string_lossy();
            if !prefixes.iter().any(|p| !p.is_empty() && full.contains(p.as_str())) {
                continue;
            }
            let head = parse_session_head(&path);
            // 文件名前缀可能撞车，以头里的 id 为准再核一次归档标记
            if head.corrupt || !archived.get(&head.id).copied().unwrap_or(false) {
                continue;
            }
            let pid = owner_project(projects, &head.cwd);
            let note = notes.get(&head.id).cloned();
            out.push(SessionView {
                title: display_title(note.as_ref(), &head.title, head.timestamp),
                project_id: pid,
                cwd: head.cwd.clone(),
                timestamp: head.timestamp,
                archived: true,
                corrupt: false,
                note,
                id: head.id.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    out
}

pub(crate) fn session_file_for(agent: &std::path::Path, id_prefix: &str) -> Option<PathBuf> {
    let mut best: Option<(i64, PathBuf)> = None;
    let Ok(rd) = std::fs::read_dir(agent.join("sessions")) else { return None };
    for entry in rd.flatten() {
        let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string();
            if p.extension().and_then(|s| s.to_str()) == Some("jsonl") && name.contains(id_prefix) {
                let ts = p.metadata().and_then(|m| m.modified()).ok().and_then(|t| t.elapsed().ok()).map(|_| 0).unwrap_or(0);
                let _ = ts;
                // 用文件名前缀时间排序：取字典序最大（ts 前缀）
                if best.as_ref().map(|b| name > b.1.file_name().and_then(|s| s.to_str()).unwrap_or("").to_string()).unwrap_or(true) {
                    best = Some((0, p));
                }
            }
        }
    }
    best.map(|b| b.1)
}

/// 会话归属判定的**唯一入口**（新建 / 打开 / 归档清单共用）：
/// 按 `project_of` 的真实路径前缀匹配（最长优先、符号链接展开），与 `list_sessions`
/// 同一条规则。此前这三处各写一遍「路径精确相等」，规则一旦分叉，左栏按前缀归组、
/// 命令回包却给 null，刚建好的会话就会掉进「未归属」。
///
/// `projects` = `(项目 id, 项目路径)` 列表；`project_of` 回传的是原始路径串，按串取 id。
pub fn owner_project(projects: &[(String, String)], cwd: &str) -> Option<String> {
    let paths: Vec<String> = projects.iter().map(|p| p.1.clone()).collect();
    let owner = project_of(cwd, &paths)?;
    projects.iter().find(|p| p.1 == owner).map(|p| p.0.clone())
}

/// 批量归档：逐个标记 archived=true，一次落盘；返回成功数与失败明细。
#[tauri::command]
pub async fn archive_sessions(state: State<'_, AppState>, ids: Vec<String>) -> Result<serde_json::Value, CmdError> {
    if ids.is_empty() {
        return Err(cmd_err("BAD_ARG", "未选中任何会话".into(), None));
    }
    if ids.len() > 200 {
        return Err(cmd_err("BAD_ARG", "一次最多归档 200 个会话".into(), None));
    }
    let mut ok = 0usize;
    // 归档只改覆盖层键，逐个都不该失败；失败明细字段保留为空，与 delete_sessions 的返回结构对齐
    let failed: Vec<serde_json::Value> = vec![];
    {
        let mut ov = state.overlay.lock().await;
        for id in &ids {
            ov.archived.insert(id.clone(), true);
            ok += 1;
        }
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(serde_json::json!({ "ok": ok, "failed": failed }))
}

/// 批量取消归档（设置页「恢复」用）：逐个摘掉覆盖层标记，一次落盘；
/// 返回结构与 `archive_sessions` 对齐（`ok` / `failed`）。
/// 幂等：对没归档过的 id 也返回成功，不因重复点击报错。
#[tauri::command]
pub async fn unarchive_sessions(state: State<'_, AppState>, ids: Vec<String>) -> Result<serde_json::Value, CmdError> {
    if ids.is_empty() {
        return Err(cmd_err("BAD_ARG", "未选中任何会话".into(), None));
    }
    if ids.len() > 200 {
        return Err(cmd_err("BAD_ARG", "一次最多恢复 200 个会话".into(), None));
    }
    let mut ok = 0usize;
    {
        let mut ov = state.overlay.lock().await;
        for id in &ids {
            ov.archived.remove(id);
            ok += 1;
        }
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(serde_json::json!({ "ok": ok, "failed": Vec::<serde_json::Value>::new() }))
}

/// 批量删除：逐个删文件 + 清覆盖层键，一次落盘；返回成功数与失败明细。
#[tauri::command]
pub async fn delete_sessions(state: State<'_, AppState>, ids: Vec<String>) -> Result<serde_json::Value, CmdError> {
    if ids.is_empty() {
        return Err(cmd_err("BAD_ARG", "未选中任何会话".into(), None));
    }
    if ids.len() > 200 {
        return Err(cmd_err("BAD_ARG", "一次最多删除 200 个会话".into(), None));
    }
    let mut ok = 0usize;
    let mut failed: Vec<serde_json::Value> = vec![];
    for id in &ids {
        match delete_session_inner(&state, id).await {
            Ok(()) => ok += 1,
            Err(e) => failed.push(serde_json::json!({ "id": id, "message": e.message })),
        }
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(serde_json::json!({ "ok": ok, "failed": failed }))
}

async fn delete_session_inner(state: &State<'_, AppState>, id: &str) -> Result<(), CmdError> {
    let agent = state.agent_dir.lock().await.clone();
    let prefix = id.chars().take(8).collect::<String>();
    if let Some(path) = session_file_for(&agent, &prefix) {
        let _ = std::fs::remove_file(&path);
        // 同名前缀目录（去 .jsonl 后缀）
        if let Some(stem) = path.file_name().and_then(|s| s.to_str()) {
            if let Some(dir_name) = stem.strip_suffix(".jsonl") {
                let dir = path.parent().unwrap_or(&agent).join(dir_name);
                if dir.is_dir() {
                    let _ = std::fs::remove_dir_all(&dir);
                }
            }
        }
    }
    {
        let mut ov = state.overlay.lock().await;
        ov.archived.remove(id);
        ov.notes.remove(id);
        ov.session_approval.remove(id);
    }
    Ok(())
}

/// 输入框上方上下文条的 git **只读**查询：当前分支 + 本地分支清单 + 脏工作区标记。
/// 目录不存在 / 不是仓库 / 找不到 git 都返回降级值（`isRepo:false`），不算命令失败——
/// 前端据此只隐藏分支展示，绝不把「这里不是 git 仓库」变成一条错误横幅。
#[tauri::command]
pub async fn get_git_info(path: String) -> Result<crate::git_info::GitInfo, CmdError> {
    if !crate::git_info::dir_exists(&path) {
        return Ok(crate::git_info::GitInfo::not_repo(Some("目录不存在".into())));
    }
    let Some(git) = crate::git_info::git_bin().await else {
        return Ok(crate::git_info::GitInfo::not_repo(Some("未找到 git".into())));
    };
    Ok(crate::git_info::read_git_info(&git, &path).await)
}

pub fn load_state(app: &AppHandle) -> AppState {
    let dir = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("/tmp"));
    let overlay_path = dir.join("omp-mini").join("overlay.json");
    let (ov, reset) = load_overlay(&overlay_path);
    if reset {
        let _ = std::fs::create_dir_all(overlay_path.parent().unwrap());
        let _ = std::fs::write(&overlay_path, serde_json::to_string_pretty(&ov).unwrap());
    }
    AppState {
        overlay_path,
        overlay: Mutex::new(ov),
        agent_dir: Mutex::new(resolve_agent_dir(None)),
        omp_path: Mutex::new(None),
        omp_version: Mutex::new(None),
        models_cache: Mutex::new(None),
        login: std::sync::Arc::new(Mutex::new(None)),
        login_status: std::sync::Arc::new(Mutex::new(Default::default())),
        roles_edit: Mutex::new(()),
        retry_edit: Mutex::new(()),
        models_edit: Mutex::new(()),
        pty: std::sync::Arc::new(std::sync::Mutex::new(HashMap::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::{list_archived_in, owner_project, scan_window};
    use std::collections::HashMap;

    /// 会话归属：与 `list_sessions` 同一条规则（真实路径前缀匹配、最长优先）。
    #[test]
    fn owner_project_matches_by_real_prefix() {
        // 用**真实存在**的临时目录：路径归一依赖 canonicalize，纯字符串造的数据在
        // macOS（/tmp 是 /private/tmp 的符号链接）与 Linux 上行为不同——CI 的 Linux
        // runner 上翻过车（不存在的 /tmp/x 被当成 /private/tmp/x）。
        let root = std::env::temp_dir().join(format!("omp-owner-test-{}", std::process::id()));
        let demo = root.join("demo");
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(demo.join("sub")).unwrap();
        std::fs::create_dir_all(root.join("other")).unwrap();
        let p = |x: &std::path::Path| x.to_string_lossy().to_string();

        let projects = vec![
            ("p1".to_string(), p(&root)),
            ("p2".to_string(), p(&demo)),
        ];
        // 子目录归最长的那个项目，父目录归父项目
        assert_eq!(owner_project(&projects, &p(&demo.join("sub"))).as_deref(), Some("p2"));
        assert_eq!(owner_project(&projects, &p(&root.join("other"))).as_deref(), Some("p1"));
        // 符号链接写法与真实路径必须归到同一个项目（macOS 的 /tmp ↔ /private/tmp 同一机制）
        #[cfg(unix)]
        {
            let link = root.join("link");
            std::os::unix::fs::symlink(&demo, &link).unwrap();
            std::fs::create_dir_all(link.join("sub")).unwrap();
            assert_eq!(owner_project(&projects, &p(&link.join("sub"))).as_deref(), Some("p2"));
        }
        // 读不到 cwd（新会话懒写盘）不归属，由调用方决定兜底
        assert_eq!(owner_project(&projects, ""), None);
        assert_eq!(owner_project(&[], &p(&demo)), None);

        let _ = std::fs::remove_dir_all(&root);
    }

    /// 在临时目录里造一个 sessions/<slug>/*.jsonl 结构（归档清单的测试用）。
    fn tmp_sessions_root(tag: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("omp-search-test-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("--tmp-demo--")).unwrap();
        root
    }

    fn write_session(root: &std::path::Path, file: &str, id: &str, title: &str, lines: &[&str]) {
        let mut body = format!(
            "{}\n",
            serde_json::json!({"type":"session","id":id,"timestamp":"2026-09-15T10:00:00.000Z","cwd":"/tmp/demo","title":title})
        );
        for l in lines {
            body.push_str(l);
            body.push('\n');
        }
        std::fs::write(root.join("--tmp-demo--").join(file), body).unwrap();
    }

    #[test]
    fn list_archived_in_lists_only_archived_and_maps_project() {
        let root = tmp_sessions_root("arch");
        write_session(&root, "2026-09-15T10-00-00_s-keep.jsonl", "s-keep", "保住的会话", &[]);
        write_session(&root, "2026-09-15T11-00-00_s-live.jsonl", "s-live", "没归档的会话", &[]);
        let archived = HashMap::from([
            ("s-keep".to_string(), true),
            ("s-live".to_string(), false),
            // 覆盖层里的失效 id（文件已删）：定位不到就落空，不该冒出一条空壳
            ("s-gone".to_string(), true),
        ]);
        let projects = vec![("p1".to_string(), "/tmp/demo".to_string())];
        let notes = HashMap::from([("s-keep".to_string(), "备注名".to_string())]);
        let out = list_archived_in(&root, &archived, &projects, &notes);
        assert_eq!(out.len(), 1, "只列归档的：没归档与失效 id 都不进");
        assert_eq!(out[0].id, "s-keep");
        assert_eq!(out[0].title, "备注名", "备注覆盖标题，与左栏同一口径");
        assert_eq!(out[0].project_id.as_deref(), Some("p1"), "按 cwd 归属回项目 id");
        assert!(out[0].archived);
        assert!(!out[0].corrupt);
    }

    #[test]
    fn list_archived_in_sorts_newest_first_and_keeps_orphans() {
        let root = tmp_sessions_root("arch-sort");
        let head = |id: &str, title: &str, ts: &str| {
            format!(
                "{}\n",
                serde_json::json!({"type":"session","id":id,"timestamp":ts,"cwd":"/tmp/demo","title":title})
            )
        };
        let dir = root.join("--tmp-demo--");
        // 文件名按真实布局带会话 id（`<时间戳>_<id>.jsonl`）：覆盖层里的 id 靠文件名里的前缀定位
        std::fs::write(dir.join("2026-09-14T10-00-00Z_s-old.jsonl"), head("s-old", "旧的", "2026-09-14T10:00:00.000Z")).unwrap();
        std::fs::write(dir.join("2026-09-16T10-00-00Z_s-new.jsonl"), head("s-new", "新的", "2026-09-16T10:00:00.000Z")).unwrap();
        let archived = HashMap::from([("s-old".to_string(), true), ("s-new".to_string(), true)]);
        let out = list_archived_in(&root, &archived, &[], &HashMap::new());
        assert_eq!(
            out.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(),
            vec!["s-new", "s-old"],
            "最新归档排前面"
        );
        assert!(out.iter().all(|s| s.project_id.is_none()), "没有项目时全部算未归属");
    }

    #[test]
    fn scan_window_defaults_and_clamps() {
        assert_eq!(scan_window(None, None), (500, 0));
        assert_eq!(scan_window(Some(1000), Some(500)), (1000, 500));
        // 过小/过大都夹回合法区间，offset 原样透传
        assert_eq!(scan_window(Some(0), None), (1, 0));
        assert_eq!(scan_window(Some(99999), None), (5000, 0));
    }

}
