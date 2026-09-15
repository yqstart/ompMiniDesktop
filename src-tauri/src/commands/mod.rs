use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::PathBuf};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{overlay::*, session_scan::*};

pub struct AppState {
    pub overlay_path: PathBuf,
    pub overlay: Mutex<Overlay>,
    pub agent_dir: Mutex<PathBuf>,
    pub omp_path: Mutex<Option<String>>,
    pub omp_version: Mutex<Option<String>>,
    pub models_cache: Mutex<Option<(i64, serde_json::Value)>>,
    pub running: Mutex<HashMap<String, bool>>,
    pub runtime: crate::runtime::RuntimeMap,
}

#[derive(Debug, Serialize)]
pub struct CmdError {
    pub ok: bool,
    pub code: String,
    pub message: String,
    pub hint: Option<String>,
}

impl CmdError {
    pub fn new(code: &str, message: &str) -> Self {
        Self { ok: false, code: code.into(), message: message.into(), hint: None }
    }
}

pub fn cmd_err(code: &str, message: String, hint: Option<String>) -> CmdError {
    CmdError { ok: false, code: code.into(), message, hint }
}

fn save_overlay(state: &State<AppState>) -> Result<(), String> {
    let ov = state.overlay.blocking_lock();
    let text = serde_json::to_string_pretty(&*ov).map_err(|e| e.to_string())?;
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OmpInfo {
    pub omp_path: Option<String>,
    pub omp_version: Option<String>,
    pub agent_dir: String,
    pub errors: Vec<String>,
}

#[tauri::command]
pub async fn locate_omp(state: State<'_, AppState>) -> Result<OmpInfo, CmdError> {
    let mut errors = vec![];
    let resolved = discover_omp_path(&state);
    let mut version = None;
    let mut agent_dir = resolve_agent_dir(None);
    if let Some(ref p) = resolved {
        match run_cmd(p, &["--version"]) {
            Ok(out) => {
                let text = out.trim().to_string();
                // 形如 "omp/18.1.22"
                version = text.split_whitespace().next().map(|s| s.trim_start_matches("omp/").to_string()).or(Some(text));
            }
            Err(e) => errors.push(format!("omp --version 失败：{e}")),
        }
        match run_cmd(p, &["config", "path"]) {
            Ok(out) => {
                agent_dir = resolve_agent_dir(Some(out));
            }
            Err(e) => errors.push(format!("omp config path 失败：{e}")),
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
    let omp = state.omp_path.lock().await.clone();
    let Some(p) = omp else {
        return Err(cmd_err("OMP_MISSING", "未找到 omp，无法加载模型目录".into(), Some("请先安装 oh-my-pi".into())));
    };
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
    let ov = state.overlay.blocking_lock();
    let agent = state.agent_dir.blocking_lock().clone();
    let sessions_root = agent.join("sessions");
    ov.projects
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
    {
        let ov = state.overlay.lock().await;
        let Some(proj) = ov.projects.iter().find(|p| p.id == id) else {
            return Err(cmd_err("NOT_FOUND", "项目不存在".into(), None));
        };
        // 级联清该项目会话键：以后端扫描为准
        let agent = state.agent_dir.lock().await.clone();
        let sids = session_ids_for(&agent.join("sessions"), &proj.path);
        drop(ov);
        let mut ov = state.overlay.lock().await;
        ov.projects.retain(|p| p.id != id);
        for sid in sids {
            ov.archived.remove(&sid);
            ov.notes.remove(&sid);
            ov.session_approval.remove(&sid);
        }
    }
    // 先停该项目运行中的会话（M1 无运行时：标记即可；M2 接 kill）
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
    pub running: bool,
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

#[tauri::command]
pub async fn list_sessions(state: State<'_, AppState>, project_id: Option<String>) -> Result<Vec<SessionView>, CmdError> {
    let ov = state.overlay.lock().await;
    let agent = state.agent_dir.lock().await.clone();
    let running = state.running.lock().await.clone();
    let paths: Vec<(String, String)> = ov.projects.iter().map(|p| (p.id.clone(), p.path.clone())).collect();
    let only: Option<String> = project_id.and_then(|pid| ov.projects.iter().find(|p| p.id == pid).map(|p| p.path.clone()));
    drop(ov);
    let mut out: Vec<SessionView> = vec![];
    // 损坏文件也列出（M1-1 要求可删）：按文件兜底一行
    let root = agent.join("sessions");
    let Ok(rd) = std::fs::read_dir(&root) else { return Ok(out) };
    for entry in rd.flatten() {
        let Ok(files) = std::fs::read_dir(entry.path()) else { continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                continue;
            }
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
                    running: false,
                });
                continue;
            }
            let all_paths: Vec<String> = paths.iter().map(|x| x.1.clone()).collect();
            let owner = project_of(&head.cwd, &all_paths);
            if let Some(ref want) = only {
                let hit = owner.as_ref().map(|o| normalize_path(o) == normalize_path(want)).unwrap_or(false);
                if !hit {
                    continue;
                }
            }
            let pid = owner.and_then(|o| paths.iter().find(|x| normalize_path(&x.1) == normalize_path(&o)).map(|x| x.0.clone()));
            let archived = ov.archived.get(&head.id).copied().unwrap_or(false);
            let note = ov.notes.get(&head.id).cloned();
            out.push(SessionView {
                title: display_title(note.as_ref(), &head.title, head.timestamp),
                project_id: pid,
                cwd: head.cwd.clone(),
                timestamp: head.timestamp,
                archived,
                corrupt: false,
                note,
                running: running.get(&head.id).copied().unwrap_or(false),
                id: head.id.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(out)
}

fn session_file_for(agent: &std::path::Path, id_prefix: &str) -> Option<PathBuf> {
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

#[tauri::command]
pub async fn create_session(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
) -> Result<SessionView, CmdError> {
    let (cwd, model, thinking, approval) = {
        let ov = state.overlay.lock().await;
        let Some(p) = ov.projects.iter().find(|p| p.id == project_id) else {
            return Err(cmd_err("NOT_FOUND", "项目不存在".into(), None));
        };
        if !std::path::Path::new(&p.path).is_dir() {
            return Err(cmd_err("DIR_MISSING", "目录不存在，只能移除或重定位".into(), None));
        }
        (p.path.clone(), p.last_model.clone(), p.last_thinking.clone(), None::<String>)
    };
    let bin = state.omp_path.lock().await.clone();
    let Some(bin) = bin else {
        return Err(cmd_err("OMP_MISSING", "未找到 omp，无法新建会话".into(), Some("请先安装 oh-my-pi".into())));
    };
    // 会话级覆盖优先于全局（spawn 时传入）
    let key_hint = format!("new-{}", chrono::Utc::now().timestamp_millis());
    let (sid, sfile) = crate::runtime::spawn_long_lived(
        &app,
        state.runtime.clone(),
        key_hint.clone(),
        crate::runtime::SpawnOpts { bin, cwd: cwd.clone(), resume: None, model, thinking, approval },
    )
    .await?;
    // key 换成真实 session id
    {
        let mut m = state.runtime.lock().await;
        if let Some(r) = m.remove(&key_hint) {
            m.insert(sid.clone(), r);
        }
    }
    if let Ok(mut run) = state.running.try_lock() {
        run.insert(sid.clone(), true);
    }
    let head = parse_session_head(std::path::Path::new(&sfile));
    let ov = state.overlay.lock().await;
    let pid = ov.projects.iter().find(|p| normalize_path(&p.path) == normalize_path(&head.cwd)).map(|p| p.id.clone());
    let note = ov.notes.get(&sid).cloned();
    let title = if head.title.is_empty() { "未命名会话".into() } else { head.title.clone() };
    Ok(SessionView {
        title: display_title(note.as_ref(), &title, head.timestamp),
        project_id: pid,
        cwd: head.cwd.clone(),
        timestamp: head.timestamp,
        archived: false,
        corrupt: false,
        note,
        running: true,
        id: sid,
    })
}

#[tauri::command]
pub async fn open_session(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<SessionView, CmdError> {
    // 已有长驻进程直接聚焦
    if state.runtime.lock().await.contains_key(&id) {
        let ov = state.overlay.lock().await;
        let agent = state.agent_dir.lock().await.clone();
        let prefix = id.chars().take(8).collect::<String>();
        let head = session_file_for(&agent, &prefix)
            .map(|p| parse_session_head(&p))
            .unwrap_or(SessionHead { id: id.clone(), cwd: String::new(), timestamp: 0, title: String::new(), file: String::new(), corrupt: false });
        let pid = ov.projects.iter().find(|p| normalize_path(&p.path) == normalize_path(&head.cwd)).map(|p| p.id.clone());
        let archived = ov.archived.get(&id).copied().unwrap_or(false);
        let note = ov.notes.get(&id).cloned();
        return Ok(SessionView {
            title: display_title(note.as_ref(), &head.title, head.timestamp),
            project_id: pid,
            cwd: head.cwd.clone(),
            timestamp: head.timestamp,
            archived,
            corrupt: false,
            note,
            running: true,
            id: id.clone(),
        });
    }
    // 否则 resume 长驻
    let agent = state.agent_dir.lock().await.clone();
    let prefix = id.chars().take(8).collect::<String>();
    let Some(path) = session_file_for(&agent, &prefix) else {
        return Err(cmd_err("NOT_FOUND", "会话文件不存在，可能已被删除".into(), None));
    };
    let head = parse_session_head(&path);
    if head.corrupt {
        return Err(cmd_err("CORRUPT", "会话文件已损坏，可删除".into(), None));
    }
    let bin = state.omp_path.lock().await.clone();
    let Some(bin) = bin else {
        return Err(cmd_err("OMP_MISSING", "未找到 omp".into(), None));
    };
    let cwd = if head.cwd.is_empty() { "/tmp".into() } else { head.cwd.clone() };
    let approval = state.overlay.lock().await.session_approval.get(&id).cloned();
    let (sid, _) = crate::runtime::spawn_long_lived(
        &app,
        state.runtime.clone(),
        id.clone(),
        crate::runtime::SpawnOpts { bin, cwd, resume: Some(prefix), model: None, thinking: None, approval },
    )
    .await?;
    if let Ok(mut run) = state.running.try_lock() {
        run.insert(sid.clone(), true);
    }
    // 历史回放：switch_session + get_messages_page 由前端 get_history 补（M2-3 经事件 pump 增量）
    let ov = state.overlay.lock().await;
    let pid = ov.projects.iter().find(|p| normalize_path(&p.path) == normalize_path(&head.cwd)).map(|p| p.id.clone());
    let archived = ov.archived.get(&head.id).copied().unwrap_or(false);
    let note = ov.notes.get(&head.id).cloned();
    Ok(SessionView {
        title: display_title(note.as_ref(), &head.title, head.timestamp),
        project_id: pid,
        cwd: head.cwd.clone(),
        timestamp: head.timestamp,
        archived,
        corrupt: false,
        note,
        running: true,
        id: head.id.clone(),
    })
}

#[tauri::command]
pub async fn archive_session(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    // 流式中先停
    let _ = app.emit(format!("omp-status://{id}").as_str(), serde_json::json!({"state":"idle"}));
    kill_runtime(&state, &id);
    {
        let mut ov = state.overlay.lock().await;
        ov.archived.insert(id, true);
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
}

#[tauri::command]
pub async fn unarchive_session(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    {
        let mut ov = state.overlay.lock().await;
        ov.archived.remove(&id);
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
}

#[tauri::command]
pub async fn delete_session(state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    kill_runtime(&state, &id);
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
        ov.archived.remove(&id);
        ov.notes.remove(&id);
        ov.session_approval.remove(&id);
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
}

#[tauri::command]
pub async fn rename_session_note(state: State<'_, AppState>, id: String, note: String) -> Result<(), CmdError> {
    {
        let mut ov = state.overlay.lock().await;
        if note.trim().is_empty() {
            ov.notes.remove(&id);
        } else {
            ov.notes.insert(id, note);
        }
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
}

// ---------- M2/M3 占位：命令先注册，逻辑在各自里程碑实现 ----------

#[tauri::command]
pub async fn get_history(state: State<'_, AppState>, id: String) -> Result<Vec<serde_json::Value>, CmdError> {
    // M1 可用：读 jsonl 全量转 ViewMsg 载荷（本期先返回原始块，前端经 viewmsg 归一）
    let agent = state.agent_dir.lock().await.clone();
    let prefix = id.chars().take(8).collect::<String>();
    let Some(path) = session_file_for(&agent, &prefix) else {
        return Err(cmd_err("NOT_FOUND", "会话文件不存在，可能已被删除".into(), None));
    };
    let text = std::fs::read_to_string(&path).map_err(|_| cmd_err("CORRUPT", "会话文件已损坏，可删除".into(), None))?;
    let mut out = vec![];
    for line in text.lines().take(5000) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            // 只回放 message/custom/title_change 系
            if matches!(v.get("type").and_then(|t| t.as_str()), Some("message" | "custom" | "title_change" | "model_change" | "thinking_level_change")) {
                out.push(v);
            }
        }
        if out.len() >= 2000 {
            break;
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn send_message(app: AppHandle, state: State<'_, AppState>, id: String, message: String) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未启动，请先打开会话".into(), None));
    };
    let req = serde_json::json!({"id": format!("p-{}", chrono::Utc::now().timestamp_millis()), "type": "prompt", "message": message});
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "发送失败，进程可能已退出".into(), None))?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn stop_session(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未运行".into(), None));
    };
    let req = serde_json::json!({"id": format!("a-{}", chrono::Utc::now().timestamp_millis()), "type": "abort"});
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "停止失败，进程可能已退出".into(), None))?;
    let _ = app;
    Ok(())
}

pub fn kill_runtime(state: &State<AppState>, id: &str) {
    let map = state.runtime.clone();
    let mut m = map.blocking_lock();
    if let Some(r) = m.remove(id) {
        let _ = r.tx.send(String::new());
        // child kill 需要 async；此处发哨兵让 pump 退出，进程随 stdin 关闭退出（code 0）
    }
    if let Ok(mut run) = state.running.try_lock() {
        run.remove(id);
    }
}

#[tauri::command]
pub async fn approve(app: AppHandle, state: State<'_, AppState>, id: String, ui_id: String, decision: String) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未运行，审批已失效".into(), None));
    };
    let resp = match decision.as_str() {
        "once" | "always" => serde_json::json!({"type":"extension_ui_response","id":ui_id,"value":"Approve"}),
        "deny" => serde_json::json!({"type":"extension_ui_response","id":ui_id,"cancelled":true}),
        _ => return Err(cmd_err("BAD_ARG", "审批 decision 非法".into(), None)),
    };
    if decision == "always" {
        // 会话级 yolo 意向（V1 不伪装逐工具 API）
        if let Ok(mut ov) = state.overlay.try_lock() {
            ov.session_approval.insert(id.clone(), "yolo".into());
        }
        let _ = save_overlay(&state);
    }
    tx.send(format!("{}\n", serde_json::to_string(&resp).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "审批发送失败，进程可能已退出".into(), None))?;
    let _ = app.emit(format!("omp-status://{id}").as_str(), serde_json::json!({"state":"running"}));
    Ok(())
}

#[tauri::command]
pub async fn set_model(app: AppHandle, state: State<'_, AppState>, id: String, provider: String, model_id: String) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未运行，无法切换模型".into(), None));
    };
    let req = serde_json::json!({"id": format!("m-{}", chrono::Utc::now().timestamp_millis()), "type": "set_model", "provider": provider, "modelId": model_id});
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "切换模型失败，进程可能已退出".into(), None))?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn set_thinking(app: AppHandle, state: State<'_, AppState>, id: String, level: String) -> Result<(), CmdError> {
    if !["off","minimal","low","medium","high","xhigh","max","auto"].contains(&level.as_str()) {
        return Err(cmd_err("BAD_ARG", "思考档非法".into(), None));
    }
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未运行，无法切换思考档".into(), None));
    };
    let req = serde_json::json!({"id": format!("t-{}", chrono::Utc::now().timestamp_millis()), "type": "set_thinking_level", "level": level});
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "切换思考档失败，进程可能已退出".into(), None))?;
    let _ = app;
    Ok(())
}

#[tauri::command]
pub async fn get_global_approval(state: State<'_, AppState>) -> Result<String, CmdError> {
    let omp = state.omp_path.lock().await.clone();
    let Some(p) = omp else {
        return Err(cmd_err("OMP_MISSING", "未找到 omp".into(), None));
    };
    let out = run_cmd(&p, &["config", "list", "--json"])
        .map_err(|e| cmd_err("CONFIG_READ", format!("读取权限失败：{e}"), None))?;
    let v: serde_json::Value = serde_json::from_str(&out).map_err(|e| cmd_err("CONFIG_PARSE", format!("解析失败：{e}"), None))?;
    Ok(v.get("tools.approvalMode").and_then(|x| x.get("value")).and_then(|x| x.as_str()).unwrap_or("write").to_string())
}

#[tauri::command]
pub async fn set_global_approval(state: State<'_, AppState>, mode: String) -> Result<(), CmdError> {
    if !["always-ask", "write", "yolo"].contains(&mode.as_str()) {
        return Err(cmd_err("BAD_ARG", "权限档必须是 always-ask/write/yolo".into(), None));
    }
    let omp = state.omp_path.lock().await.clone();
    let Some(p) = omp else {
        return Err(cmd_err("OMP_MISSING", "未找到 omp".into(), None));
    };
    run_cmd(&p, &["config", "set", "tools.approvalMode", &mode])
        .map(|_| ())
        .map_err(|e| cmd_err("CONFIG_WRITE", format!("写入权限失败：{e}"), None))
}

#[tauri::command]
pub async fn set_session_approval(state: State<'_, AppState>, id: String, mode: Option<String>) -> Result<(), CmdError> {
    if let Some(ref m) = mode {
        if !["always-ask", "write", "yolo"].contains(&m.as_str()) {
            return Err(cmd_err("BAD_ARG", "权限档必须是 always-ask/write/yolo".into(), None));
        }
    }
    {
        let mut ov = state.overlay.lock().await;
        match mode {
            Some(m) => {
                ov.session_approval.insert(id, m);
            }
            None => {
                ov.session_approval.remove(&id);
            }
        }
    }
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
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
        running: Mutex::new(HashMap::new()),
        runtime: std::sync::Arc::new(Mutex::new(HashMap::new())),
    }
}

pub fn emit_health(app: &AppHandle) {
    let _ = app;
}
