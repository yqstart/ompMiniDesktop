//! 供应商（Provider）管理：把 omp 的 `login` / `logout` / `model roles` 映射到设置页。
//!
//! **为什么登录/登出走 `omp auth-broker` 子进程而不是 RPC 的 `login` 命令**：
//! RPC 模式启动时就要解析出一个可用模型，实测在「一个供应商都没登录」的 agentDir 下
//! `omp --mode rpc` 直接退出（`createAgentSession > resolveModelDiscoveryFallback` 报
//! "No models available"）——而「一个都没登录」恰恰是用户第一次点开供应商页的状态。
//! `omp auth-broker login|logout` 是纯凭证库操作（`SqliteAuthCredentialStore` +
//! `AuthStorage.login`），不建会话、不需要模型，任何状态都能跑。代价是输出走文本，
//! 解析口径钉在上游 `packages/coding-agent/src/cli/auth-broker-cli.ts` 的打印顺序上：
//!   - `Open this URL in your browser:` 之后的第一行是完整授权 URL（上游明说这一行
//!     先打全量 URL，供 headless 抓取）；
//!   - 其余行（进度、`Local shortcut …`、需要用户回答的提问）原样透传给界面；
//!   - 退出码 0 = 成功，非 0 = 失败（stderr 尾部作为原因）。
//!
//! **为什么角色写入走 `omp config set modelRoles <JSON>`**：settings schema 里
//! `modelRoles` 是 record，`omp config set` 只接受整表 JSON（点路径 `modelRoles.smol`
//! 实测报 "Unknown setting"）。所以这里是「读 → 改一个键 → 写回」，用 `roles_edit`
//! 互斥锁串行化，避免两次并发编辑互相覆盖。
//!
//! 纯逻辑（解析、合并、校验）都在文末单测里锁着，进程调用只负责喂字符串。

use serde::Serialize;
use std::collections::HashSet;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin};
use tokio::sync::{oneshot, Mutex};

use crate::commands::{cmd_err, AppState, CmdError};

/// 登录进度事件的通道名（payload = 完整 [`LoginStatus`] 快照）。
pub const PROVIDER_LOGIN_EVENT: &str = "omp-provider://login";
/// `auth-broker` 命令的超时（列清单 / 登出这类短命令；登录不走这里，由用户随时取消）。
const CLI_TIMEOUT: Duration = Duration::from_secs(30);
/// 登录输出窗口：只保留尾部若干行，界面是「最近发生了什么」，不是完整日志。
const LOGIN_LINES_MAX: usize = 40;

// ---------- 供应商清单 ----------

/// 供应商行：omp 能 OAuth 登录的清单 + 当前是否已有可用凭证。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: String,
    pub name: String,
    /// 该供应商出现在当前模型目录里 = omp 认为它「有凭证 / 免钥」。
    /// 这是壳侧能拿到的最接近「已登录」的真值（不直读 omp 的凭证库）。
    pub configured: bool,
}

/// 解析 `omp auth-broker list --json`：`[{"id","name"}, …]`。
/// 坏 JSON / 非数组一律当空清单（界面据此显示"没有可登录的供应商"，不假装有）。
pub fn parse_providers(out: &str) -> Vec<(String, String)> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(out.trim()) else {
        return vec![];
    };
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|p| {
                    let id = p.get("id").and_then(|x| x.as_str())?.trim().to_string();
                    if id.is_empty() {
                        return None;
                    }
                    let name = p.get("name").and_then(|x| x.as_str()).unwrap_or(&id).to_string();
                    Some((id, name))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// 模型目录（`omp models --json`）里出现过的供应商集合。
/// omp 只列「有凭证或免钥」的供应商的模型，所以这份集合就是「已配置」的判定依据。
pub fn configured_set(catalog: &serde_json::Value) -> HashSet<String> {
    catalog
        .get("models")
        .and_then(|m| m.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|m| m.get("provider").and_then(|p| p.as_str()))
                .filter(|p| !p.is_empty())
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

// ---------- 登录 ----------

/// 登录流程的进度快照（推给前端的事件 payload 就是它，全量覆盖式更新）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginStatus {
    /// 正在登录的供应商 id；从未登录过为空串。
    pub provider: String,
    pub running: bool,
    /// 授权 URL（上游 "Open this URL in your browser:" 后的第一行）。
    pub url: Option<String>,
    /// 原始输出尾部（进度 / 提示 / 需要用户回答的提问）——上游文案原样透传。
    pub lines: Vec<String>,
    /// 结束信息；`None` = 仍在进行或从未开始。
    pub done: Option<LoginDone>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginDone {
    pub ok: bool,
    pub cancelled: bool,
    pub message: Option<String>,
}

/// 登录子进程句柄（同一时刻只允许一个登录在跑）。
pub struct LoginSession {
    pub provider: String,
    /// 需要用户回答上游提问时（如「选端点 / 粘贴 API key」）写这里。
    pub stdin: Arc<Mutex<ChildStdin>>,
    /// 取消信号（`send(())` = 杀掉子进程）。
    pub cancel: Option<oneshot::Sender<()>>,
}

/// 从 `auth-broker login` 输出行里挑出结构化信号（纯函数，单测覆盖）。
///
/// 上游打印顺序（`auth-broker-cli.ts` 的 `runLocalLogin`）：
/// `\nOpen this URL in your browser:\n<url>\n[Local shortcut (this machine only): <launchUrl>\n]<instructions>\n\n`
/// 之后是进度行 / readline 提问行。这里只把 **URL** 提出来做结构化展示，
/// 其余行原样透传——提问文案随 provider 变化（未登录态的菜单、API key 提示…），
/// 硬编码匹配会漂，透传给用户看才是稳的。
#[derive(Default)]
pub struct LoginParser {
    expect_url: bool,
}

impl LoginParser {
    pub fn feed(&mut self, line: &str) -> Option<LoginEvent> {
        let text = line.trim();
        if self.expect_url {
            // URL 前可能还有空行：保持等待，直到拿到第一行非空内容
            if text.is_empty() {
                return None;
            }
            self.expect_url = false;
            return Some(LoginEvent::Url { url: text.to_string() });
        }
        if text == "Open this URL in your browser:" {
            self.expect_url = true;
            return None;
        }
        if text.is_empty() {
            return None;
        }
        Some(LoginEvent::Line { text: text.to_string() })
    }
}

/// 解析结果（只用于把 stdout 行分流；见 [`LoginParser`]）。
pub enum LoginEvent {
    Url { url: String },
    Line { text: String },
}

async fn push_status(app: &tauri::AppHandle, status: &Arc<Mutex<LoginStatus>>, f: impl FnOnce(&mut LoginStatus)) {
    let payload = {
        let mut s = status.lock().await;
        f(&mut s);
        s.clone()
    };
    let _ = app.emit(PROVIDER_LOGIN_EVENT, payload);
}

fn push_line(status: &mut LoginStatus, text: String) {
    status.lines.push(text);
    if status.lines.len() > LOGIN_LINES_MAX {
        let drop = status.lines.len() - LOGIN_LINES_MAX;
        status.lines.drain(0..drop);
    }
}

/// 登录子进程的读循环：stdout 行 → 状态快照；stderr 行 → 失败原因尾部；
/// 退出（正常 / 被杀）→ 落 `done` 并释放会话槽位。
fn start_login_pump(
    app: tauri::AppHandle,
    mut child: Child,
    provider: String,
    session_slot: Arc<Mutex<Option<LoginSession>>>,
    status: Arc<Mutex<LoginStatus>>,
    cancel_rx: oneshot::Receiver<()>,
) {
    let mut stdout = BufReader::new(child.stdout.take().expect("stdout piped")).lines();
    let mut stderr = BufReader::new(child.stderr.take().expect("stderr piped")).lines();
    tokio::spawn(async move {
        let mut cancel_rx = cancel_rx;
        let mut parser = LoginParser::default();
        let mut err_tail: Vec<String> = vec![];
        let mut cancelled = false;
        let mut stderr_open = true;
        loop {
            tokio::select! {
                // 取消：杀掉子进程，等它退出后走统一的收尾
                _ = &mut cancel_rx, if !cancelled => {
                    cancelled = true;
                    let _ = child.kill().await;
                }
                line = stdout.next_line() => match line {
                    Ok(Some(l)) => match parser.feed(&l) {
                        Some(LoginEvent::Url { url }) => {
                            push_status(&app, &status, |s| { s.url = Some(url); }).await;
                        }
                        Some(LoginEvent::Line { text }) => {
                            push_status(&app, &status, |s| push_line(s, text)).await;
                        }
                        None => {}
                    },
                    // stdout EOF：进程正在收尾
                    _ => break,
                },
                line = stderr.next_line(), if stderr_open => match line {
                    Ok(Some(l)) => {
                        let t = l.trim();
                        if !t.is_empty() {
                            err_tail.push(t.to_string());
                            if err_tail.len() > 8 { err_tail.remove(0); }
                        }
                    }
                    _ => stderr_open = false,
                },
            }
        }
        let code = child.wait().await.ok().and_then(|s| s.code());
        let ok = !cancelled && code == Some(0);
        let message = if ok || cancelled {
            None
        } else if err_tail.is_empty() {
            Some(match code {
                Some(c) => format!("登录命令以退出码 {c} 结束"),
                None => "登录命令异常结束".to_string(),
            })
        } else {
            Some(err_tail.join("\n"))
        };
        push_status(&app, &status, |s| {
            s.running = false;
            s.done = Some(LoginDone { ok, cancelled, message });
        })
        .await;
        // 释放槽位（只有仍指向本次登录时才清，避免误杀后来者）
        let mut slot = session_slot.lock().await;
        if slot.as_ref().map(|s| s.provider.as_str()) == Some(provider.as_str()) {
            *slot = None;
        }
        drop(slot);
        // 成功了：模型目录变了（多了一个供应商的模型），清缓存让下次拉新鲜的
        if ok {
            let st = app.state::<AppState>();
            *st.models_cache.lock().await = None;
        }
    });
}

// ---------- 角色（modelRoles） ----------

/// 角色表 + 保存位置（`modelRoleStorage`）。角色值是模型 selector
/// （`provider/modelId`，可带 `:思考档` 后缀），与 config.yml 原样一致。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelRolesInfo {
    pub roles: serde_json::Map<String, serde_json::Value>,
    /// `global`（写 config.yml，本页的写入目标）或 `project`（写项目 .omp/config.yml）。
    pub storage: String,
    /// omp 内置角色 id 顺序，供界面按固定次序展示（自定义角色排在后面）。
    pub builtin: Vec<String>,
}

/// 内置角色（上游 `config/model-roles.ts` 的 `MODEL_ROLE_IDS`）。
pub const BUILTIN_ROLES: [&str; 9] =
    ["default", "smol", "slow", "vision", "plan", "commit", "tiny", "task", "advisor"];

/// 角色名合法性：非空、无空白与控制字符（写回 JSON 时会被转义，但脏名字进 config.yml 没意义）。
pub fn validate_role_name(role: &str) -> Result<(), String> {
    let t = role.trim();
    if t.is_empty() {
        return Err("角色名不能为空".into());
    }
    if t != role || role.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("角色名不能包含空白或控制字符".into());
    }
    Ok(())
}

/// 在角色表上应用一次编辑（纯函数，单测覆盖）：
/// `Some(非空)` = 设置 / 覆盖；`None` 或纯空白 = 删除该角色（未配置 = 按 omp 的回退规则解析）。
pub fn apply_role_edit(
    roles: &mut serde_json::Map<String, serde_json::Value>,
    role: &str,
    selector: Option<&str>,
) -> Result<(), String> {
    validate_role_name(role)?;
    match selector.map(str::trim).filter(|s| !s.is_empty()) {
        Some(sel) => {
            if sel.chars().any(|c| c.is_control()) {
                return Err("模型 selector 不能包含控制字符".into());
            }
            roles.insert(role.to_string(), serde_json::Value::String(sel.to_string()));
        }
        None => {
            roles.remove(role);
        }
    }
    Ok(())
}

// ---------- 进程调用 ----------

/// 跑一次 omp CLI 并回 stdout（非零退出把 stderr 尾部当原因）。
/// `pub(crate)`：`quota.rs` 的 `omp usage --json` 走同一套超时与错误口径。
pub(crate) async fn run_omp(bin: &str, args: &[&str]) -> Result<String, String> {
    let fut = tokio::process::Command::new(bin)
        .args(args)
        .stdin(Stdio::null())
        .output();
    match tokio::time::timeout(CLI_TIMEOUT, fut).await {
        Ok(Ok(o)) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(Ok(o)) => {
            let err = String::from_utf8_lossy(&o.stderr);
            let lines: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
            let tail = lines[lines.len().saturating_sub(4)..].join("\n");
            Err(if tail.trim().is_empty() { format!("omp 退出码 {}", o.status) } else { tail })
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("omp 命令超时".into()),
    }
}

fn omp_bin(state: &tauri::State<'_, AppState>) -> Result<String, CmdError> {
    crate::commands::discover_omp_path(state).ok_or_else(|| {
        cmd_err("OMP_MISSING", "未找到 omp，无法管理供应商".into(), Some("请先在设置 › 通用里指定 omp 路径".into()))
    })
}

/// 读 `omp config get <key> --json` 的 `value` 字段。
async fn config_get(bin: &str, key: &str) -> Result<serde_json::Value, String> {
    let out = run_omp(bin, &["config", "get", key, "--json"]).await?;
    let v: serde_json::Value = serde_json::from_str(out.trim()).map_err(|e| format!("配置解析失败：{e}"))?;
    Ok(v.get("value").cloned().unwrap_or(serde_json::Value::Null))
}

// ---------- Tauri 命令 ----------

/// 供应商清单：`omp auth-broker list --json` 的全量 OAuth 供应商 + 当前已配置标记。
#[tauri::command]
pub async fn list_providers(state: tauri::State<'_, AppState>) -> Result<Vec<ProviderView>, CmdError> {
    let bin = omp_bin(&state)?;
    let out = run_omp(&bin, &["auth-broker", "list", "--json"])
        .await
        .map_err(|e| cmd_err("PROVIDER_LIST_FAILED", format!("读取供应商清单失败：{e}"), None))?;
    let base = parse_providers(&out);
    if base.is_empty() {
        return Err(cmd_err(
            "PROVIDER_LIST_EMPTY",
            "omp 没有返回可登录的供应商".into(),
            Some("omp 版本可能过旧，升级后再试".into()),
        ));
    }
    // 已配置标记：直接跑一次模型目录拿真值（不依赖诊断状态里缓存的 omp 路径，
    // 也不吃 `get_models` 的 5 分钟缓存——供应商页看到的状态必须是当下的）。
    // 顺带把缓存刷新成这次的结果，`ModelPicker` 下一次读取也就拿到同一份。
    let configured = match run_omp(&bin, &["models", "--json"]).await {
        Ok(out) => match serde_json::from_str::<serde_json::Value>(out.trim()) {
            Ok(v) => {
                let catalog = serde_json::json!({
                    "models": v.get("models").cloned().unwrap_or(serde_json::Value::Array(vec![])),
                    "fetchedAt": chrono::Utc::now().timestamp_millis(),
                });
                *state.models_cache.lock().await = Some((chrono::Utc::now().timestamp_millis(), catalog));
                configured_set(&v)
            }
            Err(_) => HashSet::new(),
        },
        Err(_) => HashSet::new(),
    };
    Ok(base
        .into_iter()
        .map(|(id, name)| ProviderView { configured: configured.contains(&id), id, name })
        .collect())
}

/// 当前（或最近一次）登录的进度快照——切走设置页再回来时用它补齐中间的输出。
#[tauri::command]
pub async fn get_provider_login(state: tauri::State<'_, AppState>) -> Result<LoginStatus, CmdError> {
    Ok(state.login_status.lock().await.clone())
}

/// 发起 OAuth 登录：`omp auth-broker login <providerId>`，输出经
/// `omp-provider://login` 全量推送（URL / 原始行 / 结束）。
#[tauri::command]
pub async fn start_provider_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    provider_id: String,
) -> Result<(), CmdError> {
    let bin = omp_bin(&state)?;
    let provider = provider_id.trim().to_string();
    if provider.is_empty() {
        return Err(cmd_err("PROVIDER_ID_EMPTY", "供应商 id 不能为空".into(), None));
    }
    // 同一时刻只允许一个登录：先取消旧的（旧流程的收尾逻辑不会误清新槽位，见 pump 里比对 provider）
    if let Some(old) = state.login.lock().await.take() {
        if let Some(tx) = old.cancel {
            let _ = tx.send(());
        }
    }
    let mut child = tokio::process::Command::new(&bin)
        .args(["auth-broker", "login", &provider])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| cmd_err("LOGIN_SPAWN_FAILED", format!("启动登录失败：{e}"), None))?;
    let stdin = child.stdin.take().expect("stdin piped");
    let (cancel_tx, cancel_rx) = oneshot::channel();
    *state.login.lock().await = Some(LoginSession {
        provider: provider.clone(),
        stdin: Arc::new(Mutex::new(stdin)),
        cancel: Some(cancel_tx),
    });
    // 状态先复位再交给 pump：界面从"开始登录"的空白态起
    {
        let mut s = state.login_status.lock().await;
        *s = LoginStatus { provider: provider.clone(), running: true, url: None, lines: vec![], done: None };
    }
    push_status(&app, &state.login_status, |_| {}).await;
    start_login_pump(
        app,
        child,
        provider,
        state.login.clone(),
        state.login_status.clone(),
        cancel_rx,
    );
    Ok(())
}

/// 回答上游提问（如「选端点 / 粘贴 API key」）：把一行文本写进登录子进程的 stdin。
#[tauri::command]
pub async fn provider_login_input(state: tauri::State<'_, AppState>, text: String) -> Result<(), CmdError> {
    let session = state.login.lock().await;
    let Some(s) = session.as_ref() else {
        return Err(cmd_err("LOGIN_NOT_RUNNING", "当前没有进行中的登录".into(), None));
    };
    let mut stdin = s.stdin.lock().await;
    stdin
        .write_all(format!("{text}\n").as_bytes())
        .await
        .map_err(|e| cmd_err("LOGIN_INPUT_FAILED", format!("写入登录输入失败：{e}"), None))?;
    stdin
        .flush()
        .await
        .map_err(|e| cmd_err("LOGIN_INPUT_FAILED", format!("写入登录输入失败：{e}"), None))?;
    // 输入内容不回显：它可能是 API key（上游部分供应商的登录就是粘贴 key），
    // 不该出现在界面文本里（会被截图 / 导出带走）。上游自己的提问行已经说明了在等什么。
    Ok(())
}

/// 取消进行中的登录（杀掉子进程；已输入的凭证不会被写入）。
#[tauri::command]
pub async fn cancel_provider_login(state: tauri::State<'_, AppState>) -> Result<(), CmdError> {
    let mut slot = state.login.lock().await;
    match slot.take() {
        Some(s) => {
            if let Some(tx) = s.cancel {
                let _ = tx.send(());
            }
            Ok(())
        }
        None => Err(cmd_err("LOGIN_NOT_RUNNING", "当前没有进行中的登录".into(), None)),
    }
}

/// 登出：`omp auth-broker logout <providerId>`（删除该供应商在 omp 凭证库里的全部凭证）。
#[tauri::command]
pub async fn logout_provider(state: tauri::State<'_, AppState>, provider_id: String) -> Result<(), CmdError> {
    let bin = omp_bin(&state)?;
    let provider = provider_id.trim().to_string();
    if provider.is_empty() {
        return Err(cmd_err("PROVIDER_ID_EMPTY", "供应商 id 不能为空".into(), None));
    }
    run_omp(&bin, &["auth-broker", "logout", &provider])
        .await
        .map_err(|e| cmd_err("LOGOUT_FAILED", format!("登出失败：{e}"), None))?;
    // 凭证没了：模型目录缓存立即作废，下一次读取就是登出后的真相
    *state.models_cache.lock().await = None;
    Ok(())
}

/// 模型角色表（`modelRoles`）+ 保存位置（`modelRoleStorage`）。
#[tauri::command]
pub async fn get_model_roles(state: tauri::State<'_, AppState>) -> Result<ModelRolesInfo, CmdError> {
    let bin = omp_bin(&state)?;
    let roles = config_get(&bin, "modelRoles")
        .await
        .map_err(|e| cmd_err("ROLES_READ_FAILED", e, None))?;
    let storage = config_get(&bin, "modelRoleStorage").await.unwrap_or(serde_json::Value::Null);
    let roles = roles.as_object().cloned().unwrap_or_default();
    Ok(ModelRolesInfo {
        roles,
        storage: storage.as_str().unwrap_or("global").to_string(),
        builtin: BUILTIN_ROLES.iter().map(|s| s.to_string()).collect(),
    })
}

/// 改一个角色：`selector = Some(模型)` 设置 / 覆盖，`None`（或空白）删除该角色。
/// 读 → 改 → 写整表（record 只能整表写），用 `roles_edit` 串行化；写完回读一次确认。
#[tauri::command]
pub async fn set_model_role(
    state: tauri::State<'_, AppState>,
    role: String,
    selector: Option<String>,
) -> Result<ModelRolesInfo, CmdError> {
    let bin = omp_bin(&state)?;
    let _guard = state.roles_edit.lock().await;
    let current = config_get(&bin, "modelRoles")
        .await
        .map_err(|e| cmd_err("ROLES_READ_FAILED", e, None))?;
    let mut roles = current.as_object().cloned().unwrap_or_default();
    apply_role_edit(&mut roles, &role, selector.as_deref())
        .map_err(|e| cmd_err("ROLE_INVALID", e, None))?;
    let json = serde_json::to_string(&serde_json::Value::Object(roles))
        .map_err(|e| cmd_err("ROLES_WRITE_FAILED", format!("角色序列化失败：{e}"), None))?;
    run_omp(&bin, &["config", "set", "modelRoles", &json])
        .await
        .map_err(|e| cmd_err("ROLES_WRITE_FAILED", format!("写入角色失败：{e}"), None))?;
    // 回读：写入被 omp 静默丢弃时，界面不该显示一个其实没生效的值
    let roles = config_get(&bin, "modelRoles")
        .await
        .map_err(|e| cmd_err("ROLES_READ_FAILED", e, None))?
        .as_object()
        .cloned()
        .unwrap_or_default();
    let storage = config_get(&bin, "modelRoleStorage").await.unwrap_or(serde_json::Value::Null);
    Ok(ModelRolesInfo {
        roles,
        storage: storage.as_str().unwrap_or("global").to_string(),
        builtin: BUILTIN_ROLES.iter().map(|s| s.to_string()).collect(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn providers_parsed_from_json_array() {
        let out = r#"[{"id":"anthropic","name":"Anthropic (Claude Pro/Max)"},{"id":"zai","name":"Z.AI"}]"#;
        assert_eq!(
            parse_providers(out),
            vec![
                ("anthropic".to_string(), "Anthropic (Claude Pro/Max)".to_string()),
                ("zai".to_string(), "Z.AI".to_string()),
            ]
        );
        // 缺 name 用 id 兜底；缺 id 的条目丢弃
        assert_eq!(parse_providers(r#"[{"id":"kimi"}]"#), vec![("kimi".to_string(), "kimi".to_string())]);
        assert_eq!(parse_providers(r#"[{"name":"x"},{"id":"a"}]"#), vec![("a".to_string(), "a".to_string())]);
    }

    #[test]
    fn providers_parse_failures_are_empty_not_panic() {
        assert!(parse_providers("").is_empty());
        assert!(parse_providers("not json").is_empty());
        assert!(parse_providers(r#"{"providers":[]}"#).is_empty());
    }

    #[test]
    fn configured_set_reads_model_providers() {
        let cat = serde_json::json!({
            "models": [
                {"selector": "a/one", "provider": "a"},
                {"selector": "b/two", "provider": "b"},
                {"selector": "a/three", "provider": "a"},
                {"selector": "broken"},
            ]
        });
        let set = configured_set(&cat);
        assert!(set.contains("a") && set.contains("b"));
        assert_eq!(set.len(), 2);
        assert!(configured_set(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn login_parser_extracts_url_after_prompt() {
        let mut p = LoginParser::default();
        // 上游先打一个空行，再打提示行，再打 URL
        assert!(p.feed("").is_none());
        assert!(p.feed("Open this URL in your browser:").is_none());
        match p.feed("https://claude.ai/oauth/authorize?code=1") {
            Some(LoginEvent::Url { url }) => assert_eq!(url, "https://claude.ai/oauth/authorize?code=1"),
            _ => panic!("URL 行应识别为 Url 事件"),
        }
        // 之后的普通行透传
        match p.feed("Local shortcut (this machine only): http://127.0.0.1:54545/launch") {
            Some(LoginEvent::Line { text }) => assert!(text.starts_with("Local shortcut")),
            _ => panic!("非 URL 行应透传"),
        }
    }

    #[test]
    fn login_parser_waits_through_blank_lines() {
        let mut p = LoginParser::default();
        p.feed("Open this URL in your browser:");
        assert!(p.feed("   ").is_none());
        match p.feed("  https://example.com/oauth  ") {
            Some(LoginEvent::Url { url }) => assert_eq!(url, "https://example.com/oauth"),
            _ => panic!("裁剪空白后应是 URL"),
        }
    }

    #[test]
    fn login_parser_passes_plain_lines_and_skips_blanks() {
        let mut p = LoginParser::default();
        assert!(p.feed("").is_none());
        assert!(p.feed("   ").is_none());
        match p.feed("Select Alibaba Coding Plan endpoint: 1=International …") {
            Some(LoginEvent::Line { text }) => assert!(text.starts_with("Select Alibaba")),
            _ => panic!("提问行应透传"),
        }
        // 未见过提示行时，普通 URL 也不会被吞成 Url 事件
        let mut q = LoginParser::default();
        match q.feed("see https://example.com for details") {
            Some(LoginEvent::Line { text }) => assert!(text.contains("https://example.com")),
            _ => panic!("未在提示后出现的 URL 不做结构化"),
        }
    }

    #[test]
    fn role_edit_sets_overrides_and_deletes() {
        let mut roles = serde_json::Map::new();
        roles.insert("default".into(), serde_json::json!("a/one"));
        apply_role_edit(&mut roles, "smol", Some("b/two:high")).unwrap();
        assert_eq!(roles["smol"], serde_json::json!("b/two:high"));
        // 覆盖同一个键
        apply_role_edit(&mut roles, "smol", Some("c/three")).unwrap();
        assert_eq!(roles["smol"], serde_json::json!("c/three"));
        // 删除：None / 空串 / 纯空白等价，且不影响其他键
        apply_role_edit(&mut roles, "smol", None).unwrap();
        assert!(!roles.contains_key("smol"));
        apply_role_edit(&mut roles, "default", Some("   ")).unwrap();
        assert!(!roles.contains_key("default"));
        assert!(roles.is_empty());
    }

    #[test]
    fn role_edit_rejects_bad_names_and_control_chars() {
        let mut roles = serde_json::Map::new();
        assert!(apply_role_edit(&mut roles, "", Some("a/b")).is_err());
        assert!(apply_role_edit(&mut roles, "  smol", Some("a/b")).is_err());
        assert!(apply_role_edit(&mut roles, "smol x", Some("a/b")).is_err());
        assert!(apply_role_edit(&mut roles, "smol", Some("a/b\nc")).is_err());
        // 合法自定义角色名允许（omp 支持自定义 role）
        apply_role_edit(&mut roles, "my-role_2", Some("a/b")).unwrap();
        assert_eq!(roles["my-role_2"], serde_json::json!("a/b"));
    }

    #[test]
    fn role_edit_serializes_to_record_json() {
        let mut roles = serde_json::Map::new();
        apply_role_edit(&mut roles, "default", Some("commandcode/meta/muse-spark-1.3-contributor:xhigh")).unwrap();
        let json = serde_json::to_string(&serde_json::Value::Object(roles)).unwrap();
        // selector 里的 `/` 与 `:` 必须原样保留（provider/modelId:level 的既有形态）
        assert_eq!(json, r#"{"default":"commandcode/meta/muse-spark-1.3-contributor:xhigh"}"#);
    }

    #[test]
    fn push_line_keeps_tail_window() {
        let mut s = LoginStatus::default();
        for i in 0..(LOGIN_LINES_MAX + 5) {
            push_line(&mut s, format!("line {i}"));
        }
        assert_eq!(s.lines.len(), LOGIN_LINES_MAX);
        assert_eq!(s.lines.first().unwrap(), "line 5");
        assert_eq!(s.lines.last().unwrap(), &format!("line {}", LOGIN_LINES_MAX + 4));
    }
}
