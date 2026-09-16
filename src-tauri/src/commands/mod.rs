use serde::Serialize;
use std::{collections::HashMap, path::PathBuf};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{overlay::*, session_scan::*};

/// 图片附件（V2 M6）：只用得上 base64 与 mime，`name`/`bytes` 供前端展示。
/// 前端传 camelCase（`dataBase64` / `mimeType`），omp 侧 image 内容块用 `data` / `mimeType`。
#[derive(Debug, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageAttachment {
    pub data_base64: String,
    pub mime_type: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub bytes: Option<usize>,
}

/// 单张图片上限：与前端 `ATTACH_MAX_BYTES` 对齐，后端再兜一道（RPC 帧别被几十 MB 撑爆）。
const IMAGE_MAX_BYTES: usize = 10 * 1024 * 1024;

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
pub async fn remove_project(app: AppHandle, state: State<'_, AppState>, id: String) -> Result<(), CmdError> {
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
    // 流式中的先停（逐个通知 idle + kill_runtime，不阻塞落盘）
    for sid in &sids {
        let _ = app.emit(format!("omp-status://{sid}").as_str(), serde_json::json!({"state":"idle"}));
        kill_runtime(&state, sid);
    }
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
    let running = state.running.lock().await.clone();
    let paths: Vec<(String, String)> = ov.projects.iter().map(|p| (p.id.clone(), p.path.clone())).collect();
    let only: Option<String> = project_id.and_then(|pid| ov.projects.iter().find(|p| p.id == pid).map(|p| p.path.clone()));
    drop(ov);
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
    let running = state.running.lock().await.clone();
    Ok(list_archived_in(&agent.join("sessions"), &archived, &projects, &running, &notes))
}

/// 归档清单核心（不碰 tauri，可在临时目录上做真实行为测试）。
/// `archived` 里 value 为 true 的 id 才算归档；覆盖层里残留的失效 id（文件已被删）自然落空。
pub fn list_archived_in(
    root: &std::path::Path,
    archived: &HashMap<String, bool>,
    projects: &[(String, String)],
    running: &HashMap<String, bool>,
    notes: &HashMap<String, String>,
) -> Vec<SessionView> {
    let wanted: Vec<&String> = archived.iter().filter(|(_, v)| **v).map(|(id, _)| id).collect();
    if wanted.is_empty() {
        return vec![];
    }
    let Ok(rd) = std::fs::read_dir(root) else { return vec![] };
    let paths: Vec<String> = projects.iter().map(|p| p.1.clone()).collect();
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
            let owner = project_of(&head.cwd, &paths);
            let pid = owner.and_then(|o| {
                projects.iter().find(|p| normalize_path(&p.1) == normalize_path(&o)).map(|p| p.0.clone())
            });
            let note = notes.get(&head.id).cloned();
            out.push(SessionView {
                title: display_title(note.as_ref(), &head.title, head.timestamp),
                project_id: pid,
                cwd: head.cwd.clone(),
                timestamp: head.timestamp,
                archived: true,
                corrupt: false,
                note,
                running: running.get(&head.id).copied().unwrap_or(false),
                id: head.id.clone(),
            });
        }
    }
    out.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    out
}

/// 会话内容搜索的一条命中（V2 M7b）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionHit {
    pub id: String,
    pub title: String,
    pub timestamp: i64,
    pub snippet: String,
    pub hits: usize,
    pub archived: bool,
}

/// 搜索结果：`truncated` = 因预算（文件数 / 字节 / 时间 / 命中上限）提前收手，
/// 前端据此提示「结果可能不全」，而不是假装搜完了。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSearchResult {
    pub hits: Vec<SessionHit>,
    pub scanned_files: usize,
    pub truncated: bool,
}

/// 搜索预算（纯函数，可测）：命中条数 / 扫描文件数 / 总读取字节 / 墙钟时间。
pub fn search_budget(limit: Option<usize>) -> (usize, usize, u64, u64) {
    let hits = limit.unwrap_or(30).clamp(1, 200);
    (hits, 1000, 96 * 1024 * 1024, 1500)
}

/// 会话内容搜索：只扫 user / assistant 的正文（工具输出与 thinking 不进搜索面）。
///
/// 保护：按 mtime 取最近 `MAX_FILES` 个文件；单文件读取上限 8MB；全局字节 / 时间预算到点即停；
/// 命中数达上限即停。任何预算触发都把 `truncated` 置 true —— **宁可说"可能不全"，也不假装搜完了**。
#[tauri::command]
pub async fn search_sessions(state: State<'_, AppState>, query: String) -> Result<SessionSearchResult, CmdError> {
    let agent = state.agent_dir.lock().await.clone();
    let archived_map = state.overlay.lock().await.archived.clone();
    Ok(search_sessions_in(&agent.join("sessions"), &archived_map, &query, None))
}

/// 搜索核心（不碰 tauri，可在临时目录上做真实行为测试）。
pub fn search_sessions_in(
    root: &std::path::Path,
    archived_map: &HashMap<String, bool>,
    query: &str,
    limit: Option<usize>,
) -> SessionSearchResult {
    let q = query.trim().to_lowercase();
    let (max_hits, max_files, max_bytes, max_ms) = search_budget(limit);
    if q.chars().count() < 2 {
        return SessionSearchResult { hits: vec![], scanned_files: 0, truncated: false };
    }
    let mut candidates: Vec<(std::time::SystemTime, PathBuf)> = vec![];
    let Ok(rd) = std::fs::read_dir(root) else {
        return SessionSearchResult { hits: vec![], scanned_files: 0, truncated: false };
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
    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    let started = std::time::Instant::now();
    let mut hits: Vec<SessionHit> = vec![];
    let mut scanned_files = 0usize;
    let mut bytes_read = 0u64;
    let mut truncated = candidates.len() > max_files;
    for (_mtime, path) in candidates.into_iter().take(max_files) {
        if hits.len() >= max_hits || bytes_read >= max_bytes || started.elapsed().as_millis() as u64 >= max_ms {
            truncated = true;
            break;
        }
        scanned_files += 1;
        let remaining = max_bytes.saturating_sub(bytes_read);
        let (snippet, count, read) = search_one_file(&path, &q, remaining);
        bytes_read += read;
        if !truncated && bytes_read >= max_bytes {
            truncated = true;
        }
        if let Some(snippet) = snippet {
            let head = parse_session_head(&path);
            let archived = archived_map.get(&head.id).copied().unwrap_or(false);
            hits.push(SessionHit {
                title: display_title(None, &head.title, head.timestamp),
                timestamp: head.timestamp,
                snippet,
                hits: count,
                archived,
                id: head.id,
            });
        }
    }
    if started.elapsed().as_millis() as u64 >= max_ms {
        truncated = true;
    }
    SessionSearchResult { hits, scanned_files, truncated }
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

/// 记住会话所属项目的「上次使用」模型与思考档（覆盖层 `lastModel` / `lastThinking`）。
///
/// 数据源只认真值：切模型 / 切档后 runtime 会紧跟一次 `get_state` 回读，
/// 这里把回读结果落到项目上；`create_session` 再把它作为 spawn 参数带上，
/// 于是「新建会话沿用该项目上次的模型」才真正成立（此前这两个字段只写不读）。
/// 找不到归属项目（未归属会话）时静默跳过，不报错。
pub(crate) async fn remember_project_pref(
    state: &State<'_, AppState>,
    session_id: &str,
    model: Option<String>,
    thinking: Option<String>,
) {
    if model.is_none() && thinking.is_none() {
        return;
    }
    let agent = state.agent_dir.lock().await.clone();
    let prefix: String = session_id.chars().take(8).collect();
    let Some(path) = session_file_for(&agent, &prefix) else {
        return;
    };
    let head = parse_session_head(&path);
    if head.cwd.is_empty() {
        return;
    }
    let cwd = normalize_path(&head.cwd);
    let changed = {
        let mut ov = state.overlay.lock().await;
        match ov.projects.iter_mut().find(|p| normalize_path(&p.path) == cwd) {
            Some(p) => {
                let mut changed = false;
                if let Some(m) = model {
                    if p.last_model.as_deref() != Some(m.as_str()) {
                        p.last_model = Some(m);
                        changed = true;
                    }
                }
                if let Some(t) = thinking {
                    if p.last_thinking.as_deref() != Some(t.as_str()) {
                        p.last_thinking = Some(t);
                        changed = true;
                    }
                }
                changed
            }
            None => false,
        }
    };
    if changed {
        let _ = save_overlay(state);
    }
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
    let (sid, sfile, _meta) = crate::runtime::spawn_long_lived(
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
    let (sid, _, _meta) = crate::runtime::spawn_long_lived(
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
    delete_session_inner(&state, &id).await?;
    save_overlay(&state).map_err(|e| cmd_err("OVERLAY_WRITE", e, None))?;
    Ok(())
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
    // 流式中的先停（逐个 kill_runtime，不阻塞落盘）
    for id in &ids {
        kill_runtime(&state, id);
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
    kill_runtime(state, id);
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
pub async fn send_message(app: AppHandle, state: State<'_, AppState>, id: String, message: String, images: Option<Vec<ImageAttachment>>) -> Result<(), CmdError> {
    send_prompt(&app, &state, &id, "prompt", message, images, None).await
}

/// 流式中转向（`steer`）：在下一个工具调用边界生效，不砍掉进行中的工作。
#[tauri::command]
pub async fn steer_message(app: AppHandle, state: State<'_, AppState>, id: String, message: String, images: Option<Vec<ImageAttachment>>) -> Result<(), CmdError> {
    send_prompt(&app, &state, &id, "steer", message, images, None).await
}

/// 流式中排队（`follow_up`）：本轮结束后按序执行。
#[tauri::command]
pub async fn follow_up_message(app: AppHandle, state: State<'_, AppState>, id: String, message: String, images: Option<Vec<ImageAttachment>>) -> Result<(), CmdError> {
    send_prompt(&app, &state, &id, "follow_up", message, images, None).await
}

/// `/` 命令：经 prompt 直发（`/` 开头即可，omp 侧按本地命令处理）。
#[tauri::command]
pub async fn run_slash(app: AppHandle, state: State<'_, AppState>, id: String, command: String) -> Result<(), CmdError> {
    send_prompt(&app, &state, &id, "prompt", command, None, None).await
}

/// 上下文压缩：历史压缩成摘要后继续本会话（满上下文时的接续手段）。
#[tauri::command]
pub async fn compact_session(app: AppHandle, state: State<'_, AppState>, id: String, custom_instructions: Option<String>) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未启动，请先打开会话".into(), None));
    };
    let mut req = serde_json::json!({"id": format!("c-{}", chrono::Utc::now().timestamp_millis()), "type": "compact"});
    if let Some(ins) = custom_instructions.filter(|s| !s.trim().is_empty()) {
        req["customInstructions"] = serde_json::Value::String(ins);
    }
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "压缩失败，进程可能已退出".into(), None))?;
    let _ = app;
    Ok(())
}

/// 从某条消息另起分支：下发 `branch{entryId}` 后返回原会话视图，
/// 新会话身份随后续事件流推出（分支落盘后可 resume）。
#[tauri::command]
pub async fn branch_session(app: AppHandle, state: State<'_, AppState>, id: String, entry_id: String) -> Result<SessionView, CmdError> {
    let tx = {
        let map = state.runtime.lock().await;
        let Some(r) = map.get(&id) else {
            return Err(cmd_err("NOT_RUNNING", "会话未运行，无法分支".into(), None));
        };
        r.tx.clone()
    };
    let req = serde_json::json!({"id": format!("b-{}", chrono::Utc::now().timestamp_millis()), "type": "branch", "entryId": entry_id});
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "分支失败，进程可能已退出".into(), None))?;
    open_session(app, state, id).await
}

/// prompt 系列的统一发送：`prompt / steer / follow_up` 共用图片组装。
async fn send_prompt(
    app: &AppHandle,
    state: &State<'_, AppState>,
    id: &str,
    kind: &str,
    message: String,
    images: Option<Vec<ImageAttachment>>,
    streaming_behavior: Option<&str>,
) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未启动，请先打开会话".into(), None));
    };
    // 图片随 prompt 一起发（实测 omp `prompt{message, images}`）；字段名按 omp 的 image 内容块：
    // `{type:"image", data:<base64>, mimeType}`。
    let imgs: Vec<serde_json::Value> = images
        .unwrap_or_default()
        .into_iter()
        .filter(|i| !i.data_base64.is_empty() && i.data_base64.len() <= IMAGE_MAX_BYTES * 2)
        .map(|i| serde_json::json!({"type":"image","data":i.data_base64,"mimeType":i.mime_type}))
        .collect();
    let prefix = match kind {
        "steer" => "s",
        "follow_up" => "f",
        _ => "p",
    };
    let mut req = serde_json::json!({"id": format!("{prefix}-{}", chrono::Utc::now().timestamp_millis()), "type": kind, "message": message});
    if !imgs.is_empty() {
        req["images"] = serde_json::Value::Array(imgs);
    }
    if let Some(sb) = streaming_behavior {
        req["streamingBehavior"] = serde_json::Value::String(sb.into());
    }
    tx.send(format!("{}\n", serde_json::to_string(&req).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "发送失败，进程可能已退出".into(), None))?;
    let _ = app;
    Ok(())
}

/// 读本地图片为附件（V2 M6）：WebView 拿不到任意本地路径的内容，
/// 所以「点回形针选文件」这条入口走后端读 → base64 回前端（粘贴 / 拖拽仍在 WebView 内直接读 File）。
#[tauri::command]
pub async fn read_image_file(path: String) -> Result<ImageAttachment, CmdError> {
    let p = PathBuf::from(&path);
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());
    let mime = match p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        _ => {
            return Err(cmd_err(
                "BAD_TYPE",
                format!("{name}：只支持 PNG / JPEG / WebP / GIF"),
                Some("换一张图片，或先用图片工具转成 PNG".into()),
            ))
        }
    };
    let meta = std::fs::metadata(&p)
        .map_err(|e| cmd_err("NOT_FOUND", format!("读取 {name} 失败：{e}"), Some("确认文件仍然存在".into())))?;
    if meta.len() as usize > IMAGE_MAX_BYTES {
        return Err(cmd_err(
            "TOO_LARGE",
            format!("{name}：超过 10MB，请先压缩再发"),
            Some("压缩到 10MB 以内（建议长边 ≤ 2048）".into()),
        ));
    }
    let bytes = std::fs::read(&p)
        .map_err(|e| cmd_err("IO", format!("读取 {name} 失败：{e}"), None))?;
    Ok(ImageAttachment {
        data_base64: crate::runtime::b64encode(&bytes),
        mime_type: mime.to_string(),
        name: Some(name),
        bytes: Some(bytes.len()),
    })
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
    if let Ok(mut m) = map.try_lock() {
        if let Some(r) = m.remove(id) {
            let _ = r.tx.send(String::new());
            // child kill 需要 async；此处发哨兵让 pump 退出，进程随 stdin 关闭退出（code 0）
        }
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

/// 通用 UI 请求回包（V2 M5）：omp `extension_ui_request` 里非审批的交互方法。
/// 回包语义按方法区分（实测 omp 18.1.22 内嵌源码）：
/// `confirm` → `{confirmed:bool}`；`input`/`editor`/非审批 `select` → `{value:string}`；
/// 取消/跳过 → `{cancelled:true}`。审批仍走 `approve`（多一步会话级 yolo 意向）。
#[tauri::command]
pub async fn respond_ui(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
    ui_id: String,
    kind: String,
    value: Option<String>,
    confirmed: Option<bool>,
) -> Result<(), CmdError> {
    let map = state.runtime.clone();
    let tx = map.lock().await.get(&id).map(|r| r.tx.clone());
    let Some(tx) = tx else {
        return Err(cmd_err("NOT_RUNNING", "会话未运行，该请求已失效".into(), None));
    };
    let resp = match kind.as_str() {
        "value" => serde_json::json!({"type":"extension_ui_response","id":ui_id,"value":value.unwrap_or_default()}),
        "confirm" => serde_json::json!({"type":"extension_ui_response","id":ui_id,"confirmed":confirmed.unwrap_or(false)}),
        "cancel" => serde_json::json!({"type":"extension_ui_response","id":ui_id,"cancelled":true}),
        _ => return Err(cmd_err("BAD_ARG", "UI 回包类型非法".into(), None)),
    };
    tx.send(format!("{}\n", serde_json::to_string(&resp).unwrap()))
        .map_err(|_| cmd_err("RPC_IO", "回包发送失败，进程可能已退出".into(), None))?;
    // 回包即视为「等待结束」，与 approve 一致把状态推回 running（omp 会继续跑）
    let _ = app.emit(format!("omp-status://{id}").as_str(), serde_json::json!({"state":"running"}));
    Ok(())
}

/// `check_paths` 的单条结果。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCheck {
    pub path: String,
    pub exists: bool,
    pub is_dir: bool,
}

/// 相对路径按 base 解析并做**词法归一**（不触碰文件系统）：`.` 丢弃、`..` 回退一层。
/// 绝对路径原样使用。
pub fn resolve_path(base: &str, p: &str) -> PathBuf {
    let raw = if p.starts_with('/') { PathBuf::from(p) } else { PathBuf::from(base).join(p) };
    let mut out = PathBuf::new();
    for c in raw.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// `@` 路径补全的单条候选（只读目录列举，不读文件内容）。
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathCandidate {
    pub path: String,
    pub is_dir: bool,
}

/// 输入框 `@` 补全：按当前 token 列举 base 下的匹配项（前缀匹配，最多 20 条）。
/// 只读目录名、不跟符号链接、不递归——补全够用即可，不做文件搜索。
#[tauri::command]
pub async fn complete_path(base: String, prefix: String) -> Vec<PathCandidate> {
    if base.is_empty() || prefix.contains('\0') {
        return vec![];
    }
    // token 含目录分隔符时按最后一段做前缀，搜索目录为前面部分
    let (dir_rel, file_prefix) = match prefix.rsplit_once('/') {
        Some((d, f)) => (d.to_string(), f.to_string()),
        None => (String::new(), prefix.clone()),
    };
    if file_prefix.contains("..") || dir_rel.contains("..") {
        return vec![];
    }
    let dir = if dir_rel.is_empty() {
        PathBuf::from(&base)
    } else {
        resolve_path(&base, &dir_rel)
    };
    let entries = std::fs::read_dir(&dir)
        .map(|rd| rd.filter_map(|e| e.ok()).take(200).collect::<Vec<_>>())
        .unwrap_or_default();
    let mut out: Vec<PathCandidate> = entries
        .into_iter()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            if name.starts_with('.') || !name.starts_with(file_prefix.as_str()) {
                return None;
            }
            let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let path = if dir_rel.is_empty() { name } else { format!("{dir_rel}/{name}") };
            Some(PathCandidate { path, is_dir })
        })
        .collect();
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.path.cmp(&b.path),
    });
    out.truncate(20);
    out
}

/// 输入框 `@提及` 的存在性提示（V2 M6b）：只 stat，不读内容、不写任何东西。
/// 展开动作是 omp 做的，这里只回答「这个路径在会话 cwd 下存在吗」。
#[tauri::command]
pub async fn check_paths(base: String, paths: Vec<String>) -> Vec<PathCheck> {
    paths
        .into_iter()
        .take(50)
        .map(|p| {
            let full = resolve_path(&base, &p);
            match std::fs::metadata(&full) {
                Ok(m) => PathCheck { path: p, exists: true, is_dir: m.is_dir() },
                Err(_) => PathCheck { path: p, exists: false, is_dir: false },
            }
        })
        .collect()
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

/// 会话运行时真值（模型 / 可用思考档 / 当前档）。会话未运行返回 `None`。
/// 前端打开会话后拉一次做回填；其后的变化经 `omp-state://<id>` 推送。
#[tauri::command]
pub async fn get_session_runtime(
    state: State<'_, AppState>,
    id: String,
) -> Result<Option<crate::runtime::SessionMeta>, CmdError> {
    let map = state.runtime.lock().await;
    Ok(map.get(&id).map(|r| r.meta.clone()))
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
        running: Mutex::new(HashMap::new()),
        runtime: std::sync::Arc::new(Mutex::new(HashMap::new())),
    }
}

#[cfg(test)]
mod tests {
    use super::{list_archived_in, resolve_path, scan_window, search_budget, search_sessions_in};
    use std::collections::HashMap;

    /// 在临时目录里造一个 sessions/<slug>/*.jsonl 结构，跑真实搜索路径。
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
    fn search_sessions_finds_body_hits_and_reports_archived() {
        let root = tmp_sessions_root("hit");
        write_session(
            &root,
            "a.jsonl",
            "s-a",
            "缓存优化",
            &[
                r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"缓存怎么调"}]}}"#,
                r#"{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"先看缓存命中率"}]}}"#,
            ],
        );
        write_session(
            &root,
            "b.jsonl",
            "s-b",
            "无关会话",
            &[r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"讲讲别的事"}]}}"#],
        );
        let archived = HashMap::from([("s-a".to_string(), true)]);
        let res = search_sessions_in(&root, &archived, "缓存", None);
        assert_eq!(res.hits.len(), 1, "只有正文命中的会话进结果");
        let hit = &res.hits[0];
        assert_eq!(hit.id, "s-a");
        assert_eq!(hit.title, "缓存优化");
        assert_eq!(hit.hits, 2, "两个正文块各命中一次");
        assert!(hit.archived, "归档标记跟着命中一起回来（结果行要标「已归档」）");
        assert!(!res.truncated && res.scanned_files == 2);
    }

    #[test]
    fn search_sessions_ignores_short_query_and_missing_dir() {
        let root = tmp_sessions_root("short");
        write_session(&root, "a.jsonl", "s-a", "缓存", &[]);
        // 单字不搜：命中面太大且没信息量
        let one = search_sessions_in(&root, &HashMap::new(), "缓", None);
        assert!(one.hits.is_empty() && one.scanned_files == 0);
        // 目录不存在时安全返回空结果，不 panic
        let missing = search_sessions_in(&root.join("nope"), &HashMap::new(), "缓存", None);
        assert!(missing.hits.is_empty());
    }

    #[test]
    fn search_sessions_respects_hit_limit() {
        let root = tmp_sessions_root("limit");
        for i in 0..5 {
            write_session(
                &root,
                &format!("s{i}.jsonl"),
                &format!("s-{i}"),
                "缓存",
                &[r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"缓存问题"}]}}"#],
            );
        }
        let res = search_sessions_in(&root, &HashMap::new(), "缓存", Some(2));
        assert_eq!(res.hits.len(), 2, "命中上限生效");
        assert!(res.truncated, "被上限截断必须如实标记，前端才能提示「结果可能不全」");
        assert_eq!(search_budget(Some(2)).0, 2);
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
        let out = list_archived_in(&root, &archived, &projects, &HashMap::new(), &notes);
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
        let out = list_archived_in(&root, &archived, &[], &HashMap::new(), &HashMap::new());
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

    #[test]
    fn resolve_path_joins_and_normalizes() {
        assert_eq!(resolve_path("/a/b", "x/y"), std::path::PathBuf::from("/a/b/x/y"));
        assert_eq!(resolve_path("/a/b", "../c"), std::path::PathBuf::from("/a/c"));
        assert_eq!(resolve_path("/a/b", "./c/./d"), std::path::PathBuf::from("/a/b/c/d"));
        // 绝对路径无视 base
        assert_eq!(resolve_path("/a/b", "/x/y"), std::path::PathBuf::from("/x/y"));
        // 回退超过根目录不 panic，停在根
        assert_eq!(resolve_path("/a", "../../../x"), std::path::PathBuf::from("/x"));
    }
}
