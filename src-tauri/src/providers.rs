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
//! **失败转移链（`retry.fallbackChains`）走同一套模式**：它也是 record（键 = 角色名 /
//! 模型 selector / 供应商通配，值 = 有序备用 selector 数组），整表写回、用 `retry_edit`
//! 串行化；两个配套开关（`retry.modelFallback` / `retry.fallbackRevertPolicy`）是本页
//! 顺带映射的，因为 `modelFallback = false` 时链**完全不生效**——拆开两个界面会让
//! 「链配好了却没生效」变成一个看不见的坑。读这三个键**必须钉住 agentDir**：实测
//! `omp config get` 读的是合并项目层后的有效值（`<cwd>/.omp/config.yml` 有覆盖时给项目值），
//! 而 `omp config set` 任何 cwd 下都只写全局 agentDir 的 config.yml——只有读也钉在 agentDir，
//! 显示的才是用户正在改的那一层。
//!
//! **Ctrl+P 快速切换环（`cycleOrder`）**是同页的第三个键：array 型，**整数组覆盖写**
//! （不是读-改-写）；与角色共用 `roles_edit` 锁——两次 `omp config set` 并发写在同一份
//! config.yml 上会互相覆盖。核对的键名：`cycleOrder`（读回是 `{key, value, type:"array"}`，
//! 实测空数组与中文角色名都能写）。
//!
//! 纯逻辑（解析、合并、校验）都在文末单测里锁着，进程调用只负责喂字符串。

use serde::Serialize;
use std::collections::HashSet;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
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
/// 与 PTY 的 spawn 序号同口径：同一家供应商重新登录也必须是不同会话。
static LOGIN_SEQ: AtomicU64 = AtomicU64::new(1);

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
                    let name = p
                        .get("name")
                        .and_then(|x| x.as_str())
                        .unwrap_or(&id)
                        .to_string();
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
    #[serde(skip)]
    seq: u64,
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
    seq: u64,
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
            return Some(LoginEvent::Url {
                url: text.to_string(),
            });
        }
        if text == "Open this URL in your browser:" {
            self.expect_url = true;
            return None;
        }
        if text.is_empty() {
            return None;
        }
        Some(LoginEvent::Line {
            text: text.to_string(),
        })
    }
}

/// 解析结果（只用于把 stdout 行分流；见 [`LoginParser`]）。
pub enum LoginEvent {
    Url { url: String },
    Line { text: String },
}

fn update_login_status(
    status: &mut LoginStatus,
    seq: u64,
    update: impl FnOnce(&mut LoginStatus),
) -> bool {
    if status.seq != seq {
        return false;
    }
    update(status);
    true
}

async fn push_status(
    app: &tauri::AppHandle,
    status: &Arc<Mutex<LoginStatus>>,
    seq: u64,
    update: impl FnOnce(&mut LoginStatus),
) {
    let mut status = status.lock().await;
    if update_login_status(&mut status, seq, update) {
        // 发事件也在锁内：旧快照不能在新会话的初始快照之后才发出去。
        let _ = app.emit(PROVIDER_LOGIN_EVENT, status.clone());
    }
}

fn clear_login_session(slot: &mut Option<LoginSession>, seq: u64) {
    if slot.as_ref().map(|session| session.seq) == Some(seq) {
        *slot = None;
    }
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
    seq: u64,
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
                            push_status(&app, &status, seq, |s| { s.url = Some(url); }).await;
                        }
                        Some(LoginEvent::Line { text }) => {
                            push_status(&app, &status, seq, |s| push_line(s, text)).await;
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
        push_status(&app, &status, seq, |s| {
            s.running = false;
            s.done = Some(LoginDone {
                ok,
                cancelled,
                message,
            });
        })
        .await;
        // 只释放本次 spawn 的槽位；供应商 id 相同也不代表同一次登录。
        let mut slot = session_slot.lock().await;
        clear_login_session(&mut slot, seq);
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
pub const BUILTIN_ROLES: [&str; 9] = [
    "default", "smol", "slow", "vision", "plan", "commit", "tiny", "task", "advisor",
];

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

// ---------- 快速切换环（cycleOrder） ----------

/// omp `cycleOrder`（Ctrl+P / Shift+Ctrl+P 的轮换序）：条目是**角色 id**，不是模型 selector。
///
/// 上游语义（`getRoleModelCycle`，18.2.4 二进制核对）：环里的角色逐个按 `modelRoles`
/// 解析模型，未配置模型 / 没有可用凭证的角色**直接跳过**（`default` 角色例外——回退当前
/// 模型）；环空 = Ctrl+P 不切换任何模型。匹配规则全在 omp 里，壳侧只做整数组读写。
///
/// 解析容错照 `parse_chains` 的精神：值不是数组就按空环；非字符串条目丢弃；
/// 名字合法性走 `validate_role_name`（空白 / 控制字符的名字进 config.yml 没意义）；
/// **重复保序去重**——同一个角色在环里出现两次没有语义。
pub fn parse_cycle_order(v: &serde_json::Value) -> Vec<String> {
    let items: Vec<String> = v
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default();
    normalize_cycle_order(&items)
}

/// 写前归一（读路径也走它）：丢弃非法名字、保序去重。
/// 界面只会从候选里选，这里防的是手写 / 并发产生的脏值——写进 config.yml 的必须是干净的角色名。
pub fn normalize_cycle_order(items: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for s in items {
        if validate_role_name(s).is_err() {
            continue;
        }
        if seen.insert(s.clone()) {
            out.push(s.clone());
        }
    }
    out
}

// ---------- 失败转移链（retry.fallbackChains） ----------

/// 一条转移链：键 → **有序**备用 selector。
///
/// 键的三种形态（上游 `retry.fallbackChains` 的 description，omp 18.2.1 实测）：
/// - **角色名**（`default`）：该角色在用的模型失败时转移；
/// - **模型 selector**（`provider/model-id`）：该模型活跃时生效，与角色无关；
/// - **供应商通配**（`provider/*`）：保留失败模型的 id、只换供应商；
///   另有 id 前缀通配（`openrouter/google/*`）——壳侧不做它的候选，手写过的照原样读写。
///
/// 匹配规则全在 omp 里，壳侧不复制：只负责整表读写与形态校验。
/// 条目可带思考档后缀（`provider/model:high`）；不带后缀的继承失败轮次的档位，
/// `provider/*` 条目**总是**继承。
pub type ChainMap = std::collections::BTreeMap<String, Vec<String>>;

/// 失败转移链 + 两个配套开关（`retry` 组里与「换模型」直接相关的三个键）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FallbackChainsInfo {
    /// 键 → 有序备用 selector（可带 `:档位` 后缀）。顺序即 omp 的尝试顺序。
    pub chains: ChainMap,
    /// `retry.modelFallback`：为 false 时链**完全不生效**（omp 的判据），默认 true。
    pub model_fallback: bool,
    /// `retry.fallbackRevertPolicy`：`cooldown-expiry`（默认，冷却结束回主模型）/ `never`。
    pub revert_policy: String,
}

/// `retry.fallbackRevertPolicy` 的合法值（上游 enum；实测传别的直接报
/// `Invalid value: … Valid values: cooldown-expiry, never`）。
pub const REVERT_POLICIES: [&str; 2] = ["cooldown-expiry", "never"];

/// 解析 `retry.fallbackChains` 的值（`{"<key>": ["sel", …]}`，纯函数，单测覆盖）。
///
/// **容错**：值不是数组、数组里混了非字符串、键为空、链为空的条目一律丢弃——配置可能被人
/// 手改坏，读不动就当没有，绝不 panic。
pub fn parse_chains(v: &serde_json::Value) -> ChainMap {
    let mut out = ChainMap::new();
    let Some(obj) = v.as_object() else { return out };
    for (key, val) in obj {
        if key.trim().is_empty() {
            continue;
        }
        let Some(arr) = val.as_array() else { continue };
        let items: Vec<String> = arr
            .iter()
            .filter_map(|x| x.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.chars().any(|c| c.is_control()))
            .map(str::to_string)
            .collect();
        // 空链没有语义（omp 视同没配），不往界面端一张空行
        if !items.is_empty() {
            out.insert(key.clone(), items);
        }
    }
    out
}

/// 链键的合法性：三种形态都放行——语义由 omp 判定，壳侧只拒「空 / 空白 / 控制字符」
/// 这类写进 config.yml 没意义的脏值。
pub fn validate_chain_key(key: &str) -> Result<(), String> {
    let t = key.trim();
    if t.is_empty() {
        return Err("转移链的键不能为空".into());
    }
    if t != key || key.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("转移链的键不能包含空白或控制字符".into());
    }
    Ok(())
}

/// 在链表上应用一次编辑（纯函数，单测覆盖）：
/// `Some(非空)` = 设置 / 覆盖；`None` 或过滤后为空 = 删除该键（空链没有意义）。
/// **顺序原样保留**（omp 按序尝试备用模型，排序会改变语义）。
pub fn apply_chain_edit(
    chains: &mut ChainMap,
    key: &str,
    fallbacks: Option<&[String]>,
) -> Result<(), String> {
    validate_chain_key(key)?;
    let items: Vec<String> = match fallbacks {
        Some(list) => {
            let mut out = Vec::with_capacity(list.len());
            for s in list {
                let t = s.trim();
                if t.is_empty() {
                    // 空项忽略（界面不会发；手滑不该毁掉整次编辑）
                    continue;
                }
                if t.chars().any(|c| c.is_control()) {
                    return Err("转移模型不能包含控制字符".into());
                }
                out.push(t.to_string());
            }
            out
        }
        None => Vec::new(),
    };
    if items.is_empty() {
        chains.remove(key);
    } else {
        chains.insert(key.to_string(), items);
    }
    Ok(())
}

// ---------- 进程调用 ----------

/// 跑一次 omp CLI 并回 stdout（非零退出把 stderr 尾部当原因）。
/// `pub(crate)`：`quota.rs` 的 `omp usage --json` 走同一套超时与错误口径。
pub(crate) async fn run_omp(bin: &str, args: &[&str]) -> Result<String, String> {
    run_omp_in(None, bin, args).await
}

/// 同上，但显式钉住工作目录。
///
/// **为什么需要它**：`omp config list|get` 读的是**合并了项目层之后的有效值**——实测同一个
/// key 在「有 `<cwd>/.omp/config.yml` 覆盖」与「没有」的目录下读到不同结果。设置 ›「常用设置」
/// 改的是全局层，读数也必须钉在一个没有项目层的目录上（agentDir），否则从项目目录启动 app
/// 时，界面显示的是该项目的覆盖值，用户改全局会「看起来没生效」。
pub(crate) async fn run_omp_in(
    dir: Option<&std::path::Path>,
    bin: &str,
    args: &[&str],
) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new(bin);
    cmd.args(args).stdin(Stdio::null());
    if let Some(d) = dir {
        cmd.current_dir(d);
    }
    let fut = cmd.output();
    match tokio::time::timeout(CLI_TIMEOUT, fut).await {
        Ok(Ok(o)) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).to_string()),
        Ok(Ok(o)) => {
            let err = String::from_utf8_lossy(&o.stderr);
            let lines: Vec<&str> = err.lines().filter(|l| !l.trim().is_empty()).collect();
            let tail = lines[lines.len().saturating_sub(4)..].join("\n");
            Err(if tail.trim().is_empty() {
                format!("omp 退出码 {}", o.status)
            } else {
                tail
            })
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("omp 命令超时".into()),
    }
}

/// omp 可执行文件路径（`discover_omp_path` 的唯一入口）。`pub(crate)`：`models_config.rs`
/// 的预校验也要跑 omp 子进程，错误文案与这里保持一致。
pub(crate) fn omp_bin(state: &tauri::State<'_, AppState>) -> Result<String, CmdError> {
    crate::commands::discover_omp_path(state).ok_or_else(|| {
        cmd_err(
            "OMP_MISSING",
            "未找到 omp，无法管理供应商".into(),
            Some("请先在设置 ›「关于」里指定 omp 路径".into()),
        )
    })
}

/// 一次 `omp config list --json` 读多个键（**钉住 agentDir** → 全局层，与写入同层）。
///
/// **为什么不逐键 `config get`**：每个键一次子进程（实测 ~0.17s，冷启动更久），模型页一次
/// 加载要读 6 个键（modelRoles / modelRoleStorage / cycleOrder / retry.fallbackChains /
/// retry.modelFallback / retry.fallbackRevertPolicy）——就是 6 个进程。全量 list 一次
/// 0.14s 拿回 500+ 键，每项的 `{value, type, description}` 与 `config get` 完全同构
/// （omp 18.3.0 实测），挑出需要的键即可。
async fn config_values_global(
    state: &tauri::State<'_, AppState>,
    bin: &str,
    keys: &[&str],
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let dir = state.agent_dir.lock().await.clone();
    let out = run_omp_in(Some(&dir), bin, &["config", "list", "--json"]).await?;
    let all: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(out.trim()).map_err(|e| format!("配置解析失败：{e}"))?;
    Ok(pick_values(&all, keys))
}

/// 从 `config list --json` 的全量输出里挑出请求的键（纯函数，单测覆盖）。
/// 上游没有的键**不出现在结果里**——调用方按 omp 的默认语义兜底。
pub fn pick_values(
    all: &serde_json::Map<String, serde_json::Value>,
    keys: &[&str],
) -> serde_json::Map<String, serde_json::Value> {
    let mut picked = serde_json::Map::new();
    for k in keys {
        if let Some(entry) = all.get(*k) {
            picked.insert(
                (*k).to_string(),
                entry.get("value").cloned().unwrap_or(serde_json::Value::Null),
            );
        }
    }
    picked
}

/// 读 retry 组里与转移链有关的三个键（读命令与两个写命令的回读共用）。
/// `chains` 读失败要冒泡：不能兜底成空表——界面拿空表编辑后写回会把用户的链清空。
/// 两个开关读不到就按 omp 自己的默认值显示（新 agentDir 下 `config list` 也返回默认值）。
async fn read_retry_info(
    state: &tauri::State<'_, AppState>,
    bin: &str,
) -> Result<FallbackChainsInfo, String> {
    let vals = config_values_global(
        state,
        bin,
        &[
            "retry.fallbackChains",
            "retry.modelFallback",
            "retry.fallbackRevertPolicy",
        ],
    )
    .await?;
    let chains = vals
        .get("retry.fallbackChains")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    Ok(FallbackChainsInfo {
        chains: parse_chains(&chains),
        model_fallback: vals
            .get("retry.modelFallback")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        revert_policy: vals
            .get("retry.fallbackRevertPolicy")
            .and_then(|v| v.as_str())
            .unwrap_or(REVERT_POLICIES[0])
            .to_string(),
    })
}

// ---------- Tauri 命令 ----------

/// 供应商清单：`omp auth-broker list --json` 的全量 OAuth 供应商 + 当前已配置标记。
#[tauri::command]
pub async fn list_providers(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<ProviderView>, CmdError> {
    let bin = omp_bin(&state)?;
    // 两个读取**并发**：清单是纯凭证库操作（~0.3s），目录走 SWR（吃缓存，过期只起后台刷新）
    // ——`omp models --json` 实测 2–10s，供应商页等它只会白等；新快照到达后由
    // `omp-models://catalog` 事件送回，界面再更新一次已配置标记。
    let (listed, catalog) = tokio::join!(
        run_omp(&bin, &["auth-broker", "list", "--json"]),
        crate::commands::catalog_swr(&state, &app),
    );
    let out = listed.map_err(|e| {
        cmd_err(
            "PROVIDER_LIST_FAILED",
            format!("读取供应商清单失败：{e}"),
            None,
        )
    })?;
    let base = parse_providers(&out);
    if base.is_empty() {
        return Err(cmd_err(
            "PROVIDER_LIST_EMPTY",
            "omp 没有返回可登录的供应商".into(),
            Some("omp 版本可能过旧，升级后再试".into()),
        ));
    }
    // 已配置标记：目录里出现过的供应商（只有从未拉过目录时才会在这里真等一次）
    let configured = catalog.map(|c| configured_set(&c)).unwrap_or_default();
    Ok(base
        .into_iter()
        .map(|(id, name)| ProviderView {
            configured: configured.contains(&id),
            id,
            name,
        })
        .collect())
}

/// 当前（或最近一次）登录的进度快照——切走设置页再回来时用它补齐中间的输出。
#[tauri::command]
pub async fn get_provider_login(
    state: tauri::State<'_, AppState>,
) -> Result<LoginStatus, CmdError> {
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
        return Err(cmd_err(
            "PROVIDER_ID_EMPTY",
            "供应商 id 不能为空".into(),
            None,
        ));
    }
    // 启动、替换和取消共用槽位锁；并发启动不能越过彼此的初始化。
    let mut slot = state.login.lock().await;
    if let Some(old) = slot.take() {
        if let Some(tx) = old.cancel {
            let _ = tx.send(());
        }
    }
    let seq = LOGIN_SEQ.fetch_add(1, Ordering::Relaxed);
    {
        let mut status = state.login_status.lock().await;
        *status = LoginStatus {
            seq,
            provider: provider.clone(),
            running: true,
            ..Default::default()
        };
    }
    let spawned = tokio::process::Command::new(&bin)
        .args(["auth-broker", "login", &provider])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(error) => {
            let message = format!("启动登录失败：{error}");
            push_status(&app, &state.login_status, seq, |status| {
                status.running = false;
                status.done = Some(LoginDone {
                    ok: false,
                    cancelled: false,
                    message: Some(message.clone()),
                });
            })
            .await;
            return Err(cmd_err("LOGIN_SPAWN_FAILED", message, None));
        }
    };
    let stdin = child.stdin.take().expect("stdin piped");
    let (cancel_tx, cancel_rx) = oneshot::channel();
    *slot = Some(LoginSession {
        seq,
        stdin: Arc::new(Mutex::new(stdin)),
        cancel: Some(cancel_tx),
    });
    // 初始化事件与后续 pump 更新都按 spawn 身份隔离。
    push_status(&app, &state.login_status, seq, |_| {}).await;
    drop(slot);
    start_login_pump(
        app,
        child,
        seq,
        state.login.clone(),
        state.login_status.clone(),
        cancel_rx,
    );
    Ok(())
}

/// 回答上游提问（如「选端点 / 粘贴 API key」）：把一行文本写进登录子进程的 stdin。
#[tauri::command]
pub async fn provider_login_input(
    state: tauri::State<'_, AppState>,
    text: String,
) -> Result<(), CmdError> {
    let session = state.login.lock().await;
    let Some(s) = session.as_ref() else {
        return Err(cmd_err(
            "LOGIN_NOT_RUNNING",
            "当前没有进行中的登录".into(),
            None,
        ));
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
        None => Err(cmd_err(
            "LOGIN_NOT_RUNNING",
            "当前没有进行中的登录".into(),
            None,
        )),
    }
}

/// 登出：`omp auth-broker logout <providerId>`（删除该供应商在 omp 凭证库里的全部凭证）。
#[tauri::command]
pub async fn logout_provider(
    state: tauri::State<'_, AppState>,
    provider_id: String,
) -> Result<(), CmdError> {
    let bin = omp_bin(&state)?;
    let provider = provider_id.trim().to_string();
    if provider.is_empty() {
        return Err(cmd_err(
            "PROVIDER_ID_EMPTY",
            "供应商 id 不能为空".into(),
            None,
        ));
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
pub async fn get_model_roles(
    state: tauri::State<'_, AppState>,
) -> Result<ModelRolesInfo, CmdError> {
    let bin = omp_bin(&state)?;
    let vals = config_values_global(&state, &bin, &["modelRoles", "modelRoleStorage"])
        .await
        .map_err(|e| cmd_err("ROLES_READ_FAILED", e, None))?;
    Ok(roles_info(&vals))
}

/// 从读取结果造角色视图（读与写回读共用同一口径：缺失的键按 omp 的默认语义兜底）。
fn roles_info(vals: &serde_json::Map<String, serde_json::Value>) -> ModelRolesInfo {
    ModelRolesInfo {
        roles: vals
            .get("modelRoles")
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default(),
        storage: vals
            .get("modelRoleStorage")
            .and_then(|v| v.as_str())
            .unwrap_or("global")
            .to_string(),
        builtin: BUILTIN_ROLES.iter().map(|s| s.to_string()).collect(),
    }
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
    let vals = config_values_global(&state, &bin, &["modelRoles"])
        .await
        .map_err(|e| cmd_err("ROLES_READ_FAILED", e, None))?;
    let mut roles = vals
        .get("modelRoles")
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default();
    apply_role_edit(&mut roles, &role, selector.as_deref())
        .map_err(|e| cmd_err("ROLE_INVALID", e, None))?;
    let json = serde_json::to_string(&serde_json::Value::Object(roles))
        .map_err(|e| cmd_err("ROLES_WRITE_FAILED", format!("角色序列化失败：{e}"), None))?;
    run_omp(&bin, &["config", "set", "modelRoles", &json])
        .await
        .map_err(|e| cmd_err("ROLES_WRITE_FAILED", format!("写入角色失败：{e}"), None))?;
    // 回读：写入被 omp 静默丢弃时，界面不该显示一个其实没生效的值
    let vals = config_values_global(&state, &bin, &["modelRoles", "modelRoleStorage"])
        .await
        .map_err(|e| cmd_err("ROLES_READ_FAILED", e, None))?;
    Ok(roles_info(&vals))
}

/// Ctrl+P 快速切换环（`cycleOrder`）：条目是角色 id，顺序即轮换顺序。
#[tauri::command]
pub async fn get_cycle_order(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<String>, CmdError> {
    let bin = omp_bin(&state)?;
    let vals = config_values_global(&state, &bin, &["cycleOrder"])
        .await
        .map_err(|e| cmd_err("CYCLE_READ_FAILED", e, None))?;
    let order = vals
        .get("cycleOrder")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    Ok(parse_cycle_order(&order))
}

/// 整表写回环：array 键直接覆盖写（不是「读-改-写」），空数组 = 清空环。
///
/// 与 `set_model_role` 共用 `roles_edit` 锁——两者都是对同一份 config.yml 的
/// `omp config set`，串行化避免两次写入并发互相覆盖；写完回读一次确认。
#[tauri::command]
pub async fn set_cycle_order(
    state: tauri::State<'_, AppState>,
    order: Vec<String>,
) -> Result<Vec<String>, CmdError> {
    let bin = omp_bin(&state)?;
    let _guard = state.roles_edit.lock().await;
    let json = serde_json::to_string(&normalize_cycle_order(&order))
        .map_err(|e| cmd_err("CYCLE_WRITE_FAILED", format!("切换环序列化失败：{e}"), None))?;
    run_omp(&bin, &["config", "set", "cycleOrder", &json])
        .await
        .map_err(|e| cmd_err("CYCLE_WRITE_FAILED", format!("写入切换环失败：{e}"), None))?;
    // 回读：写入被 omp 静默丢弃时，界面不该显示一个其实没生效的环
    let vals = config_values_global(&state, &bin, &["cycleOrder"])
        .await
        .map_err(|e| cmd_err("CYCLE_READ_FAILED", e, None))?;
    let order = vals
        .get("cycleOrder")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    Ok(parse_cycle_order(&order))
}

/// 失败转移链表（`retry.fallbackChains`）+ 两个配套开关——模型请求失败时由哪个模型接手。
#[tauri::command]
pub async fn get_fallback_chains(
    state: tauri::State<'_, AppState>,
) -> Result<FallbackChainsInfo, CmdError> {
    let bin = omp_bin(&state)?;
    read_retry_info(&state, &bin)
        .await
        .map_err(|e| cmd_err("RETRY_READ_FAILED", e, None))
}

/// 改一条转移链：`fallbacks = Some(非空)` 设置 / 覆盖，`None`（或空数组）删除该键。
/// 与 `set_model_role` 同款：读 → 改 → 整表写回，`retry_edit` 串行化；写完回读一次确认。
#[tauri::command]
pub async fn set_fallback_chain(
    state: tauri::State<'_, AppState>,
    key: String,
    fallbacks: Option<Vec<String>>,
) -> Result<FallbackChainsInfo, CmdError> {
    let bin = omp_bin(&state)?;
    let _guard = state.retry_edit.lock().await;
    let vals = config_values_global(&state, &bin, &["retry.fallbackChains"])
        .await
        .map_err(|e| cmd_err("RETRY_READ_FAILED", e, None))?;
    let current = vals
        .get("retry.fallbackChains")
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    let mut chains = parse_chains(&current);
    apply_chain_edit(&mut chains, &key, fallbacks.as_deref())
        .map_err(|e| cmd_err("CHAIN_INVALID", e, None))?;
    let json = serde_json::to_string(&chains)
        .map_err(|e| cmd_err("RETRY_WRITE_FAILED", format!("转移链序列化失败：{e}"), None))?;
    run_omp(&bin, &["config", "set", "retry.fallbackChains", &json])
        .await
        .map_err(|e| cmd_err("RETRY_WRITE_FAILED", format!("写入转移链失败：{e}"), None))?;
    read_retry_info(&state, &bin)
        .await
        .map_err(|e| cmd_err("RETRY_READ_FAILED", e, None))
}

/// 改两个配套开关（`retry.modelFallback` / `retry.fallbackRevertPolicy`）。
/// omp 对 bool 只认 `true` / `false` 字面量（实测传 `yes` 会被静默归一成 true），
/// 回归策略传非法值直接报错——两个值都在这里先定死再发。
#[tauri::command]
pub async fn set_retry_options(
    state: tauri::State<'_, AppState>,
    model_fallback: bool,
    revert_policy: String,
) -> Result<FallbackChainsInfo, CmdError> {
    let bin = omp_bin(&state)?;
    if !REVERT_POLICIES.contains(&revert_policy.as_str()) {
        return Err(cmd_err(
            "RETRY_OPTION_INVALID",
            format!("不支持的回归策略：{revert_policy}"),
            None,
        ));
    }
    let flag = if model_fallback { "true" } else { "false" };
    run_omp(&bin, &["config", "set", "retry.modelFallback", flag])
        .await
        .map_err(|e| {
            cmd_err(
                "RETRY_WRITE_FAILED",
                format!("写入失败转移开关失败：{e}"),
                None,
            )
        })?;
    run_omp(
        &bin,
        &[
            "config",
            "set",
            "retry.fallbackRevertPolicy",
            &revert_policy,
        ],
    )
    .await
    .map_err(|e| cmd_err("RETRY_WRITE_FAILED", format!("写入回归策略失败：{e}"), None))?;
    read_retry_info(&state, &bin)
        .await
        .map_err(|e| cmd_err("RETRY_READ_FAILED", e, None))
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
                (
                    "anthropic".to_string(),
                    "Anthropic (Claude Pro/Max)".to_string()
                ),
                ("zai".to_string(), "Z.AI".to_string()),
            ]
        );
        // 缺 name 用 id 兜底；缺 id 的条目丢弃
        assert_eq!(
            parse_providers(r#"[{"id":"kimi"}]"#),
            vec![("kimi".to_string(), "kimi".to_string())]
        );
        assert_eq!(
            parse_providers(r#"[{"name":"x"},{"id":"a"}]"#),
            vec![("a".to_string(), "a".to_string())]
        );
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
    fn stale_login_output_and_completion_do_not_replace_current_snapshot() {
        // 供应商相同，但已经是第二次登录；旧 URL / 输出 / 结束通知都必须忽略。
        let mut status = LoginStatus {
            seq: 2,
            provider: "same-provider".into(),
            running: true,
            url: Some("https://example.com/new-login".into()),
            lines: vec!["new prompt".into()],
            done: None,
        };
        let before = serde_json::to_value(&status).unwrap();
        update_login_status(&mut status, 1, |status| {
            status.url = Some("https://example.com/old-login".into());
            push_line(status, "old prompt".into());
        });
        update_login_status(&mut status, 1, |status| {
            status.running = false;
            status.done = Some(LoginDone {
                ok: false,
                cancelled: true,
                message: None,
            });
        });
        assert_eq!(serde_json::to_value(&status).unwrap(), before);

        update_login_status(&mut status, 2, |status| {
            push_line(status, "current response".into())
        });
        assert_eq!(status.lines, vec!["new prompt", "current response"]);
        update_login_status(&mut status, 2, |status| {
            status.running = false;
            status.done = Some(LoginDone {
                ok: true,
                cancelled: false,
                message: None,
            });
        });
        assert!(!status.running);
        assert!(status.done.unwrap().ok);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stale_login_cleanup_keeps_new_session_input_usable() {
        // 只启动本地回显进程；不运行 omp、不读凭证、不联网。
        let mut child = tokio::process::Command::new("/bin/sh")
            .args(["-c", "IFS= read -r line; printf '%s\\n' \"$line\""])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let mut slot = Some(LoginSession {
            seq: 2,
            stdin: Arc::new(Mutex::new(child.stdin.take().unwrap())),
            cancel: None,
        });
        clear_login_session(&mut slot, 1);
        {
            let session = slot.as_ref().expect("旧会话收尾不能清掉新会话");
            let mut stdin = session.stdin.lock().await;
            stdin.write_all(b"current input\n").await.unwrap();
            stdin.flush().await.unwrap();
        }
        let output = tokio::time::timeout(Duration::from_secs(5), child.wait_with_output())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(output.stdout, b"current input\n");
        clear_login_session(&mut slot, 2);
        assert!(slot.is_none());
    }

    #[test]
    fn login_parser_extracts_url_after_prompt() {
        let mut p = LoginParser::default();
        // 上游先打一个空行，再打提示行，再打 URL
        assert!(p.feed("").is_none());
        assert!(p.feed("Open this URL in your browser:").is_none());
        match p.feed("https://claude.ai/oauth/authorize?code=1") {
            Some(LoginEvent::Url { url }) => {
                assert_eq!(url, "https://claude.ai/oauth/authorize?code=1")
            }
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
        apply_role_edit(
            &mut roles,
            "default",
            Some("commandcode/meta/muse-spark-1.3-contributor:xhigh"),
        )
        .unwrap();
        let json = serde_json::to_string(&serde_json::Value::Object(roles)).unwrap();
        // selector 里的 `/` 与 `:` 必须原样保留（provider/modelId:level 的既有形态）
        assert_eq!(
            json,
            r#"{"default":"commandcode/meta/muse-spark-1.3-contributor:xhigh"}"#
        );
    }

    #[test]
    fn cycle_order_parses_leniently_and_dedupes() {
        assert_eq!(
            parse_cycle_order(&serde_json::json!(["default", "smol", "slow"])),
            vec!["default", "smol", "slow"]
        );
        // 非数组 / 标量 → 空环（容错，不 panic）
        assert!(parse_cycle_order(&serde_json::json!(null)).is_empty());
        assert!(parse_cycle_order(&serde_json::json!("default")).is_empty());
        // 非字符串 / 空串 / 纯空白 / 带空白或控制字符的名字丢弃；重复保序去重
        let v = serde_json::json!([
            "default", 42, "", "   ", " smol ", "smol", "a\nb", "slow", "default"
        ]);
        assert_eq!(parse_cycle_order(&v), vec!["default", "smol", "slow"]);
    }

    #[test]
    fn cycle_order_write_normalizes_to_json_array() {
        // 写路径同样的归一（丢弃 + 保序去重）
        let out = normalize_cycle_order(&[
            "default".into(),
            "default".into(),
            " mycrole".into(),
            "smol".into(),
        ]);
        assert_eq!(out, vec!["default", "smol"]);
        // 自定义角色名原样保留；序列化是 JSON 数组字符串（omp 只认整数组）
        let json =
            serde_json::to_string(&normalize_cycle_order(&["my-role_2".into(), "default".into()]))
                .unwrap();
        assert_eq!(json, r#"["my-role_2","default"]"#);
        // 空数组 = 合法的「清空环」（不能写 null）
        assert_eq!(serde_json::to_string(&normalize_cycle_order(&[])).unwrap(), "[]");
    }

    #[test]
    fn chains_parsed_from_record_value() {
        // 本机配置的实测形态：键是模型 selector，值是单元素数组
        let v = serde_json::json!({
            "opencode-go/muse-spark-1.3-contributor": ["opencode-go/deepseek-v4.1-flash"],
            "default": ["openai/gpt-4o-mini", "google/*"],
        });
        let m = parse_chains(&v);
        assert_eq!(m["default"], vec!["openai/gpt-4o-mini", "google/*"]);
        assert_eq!(
            m["opencode-go/muse-spark-1.3-contributor"],
            vec!["opencode-go/deepseek-v4.1-flash"]
        );
        assert_eq!(m.len(), 2);
    }

    #[test]
    fn chains_parse_drops_bad_shapes_without_panic() {
        assert!(parse_chains(&serde_json::json!(null)).is_empty());
        assert!(parse_chains(&serde_json::json!("nope")).is_empty());
        // 值不是数组 / 空链没有语义 / 键为空——都当没有
        assert!(parse_chains(&serde_json::json!({"default": "openai/gpt-4o-mini"})).is_empty());
        assert!(parse_chains(&serde_json::json!({"default": []})).is_empty());
        assert!(parse_chains(&serde_json::json!({"": ["a/b"]})).is_empty());
        // 数组里的坏项剔除，好项保留
        let m = parse_chains(&serde_json::json!({"default": ["a/b", 42, "", "   ", "c/d:high"]}));
        assert_eq!(m["default"], vec!["a/b", "c/d:high"]);
    }

    #[test]
    fn chain_edit_sets_overrides_and_deletes() {
        let mut m = ChainMap::new();
        apply_chain_edit(&mut m, "default", Some(&["a/b".to_string()])).unwrap();
        assert_eq!(m["default"], vec!["a/b"]);
        // 覆盖同一个键
        apply_chain_edit(
            &mut m,
            "default",
            Some(&["c/d".to_string(), "e/f".to_string()]),
        )
        .unwrap();
        assert_eq!(m["default"], vec!["c/d", "e/f"]);
        // 删除：None / 空数组 / 全是空项等价，且不影响其他键
        apply_chain_edit(&mut m, "smol", Some(&["g/h".to_string()])).unwrap();
        apply_chain_edit(&mut m, "default", None).unwrap();
        assert!(!m.contains_key("default"));
        assert_eq!(m["smol"], vec!["g/h"]);
        apply_chain_edit(&mut m, "smol", Some(&[])).unwrap();
        apply_chain_edit(&mut m, "w/*", Some(&["  ".to_string()])).unwrap();
        assert!(m.is_empty());
    }

    #[test]
    fn chain_edit_rejects_bad_keys_and_entries() {
        let mut m = ChainMap::new();
        assert!(apply_chain_edit(&mut m, "", Some(&["a/b".to_string()])).is_err());
        assert!(apply_chain_edit(&mut m, " default", Some(&["a/b".to_string()])).is_err());
        assert!(apply_chain_edit(&mut m, "de fault", Some(&["a/b".to_string()])).is_err());
        assert!(apply_chain_edit(&mut m, "default", Some(&["a/b\nc".to_string()])).is_err());
        // 键的三种形态都放行（角色 / 模型 / 供应商通配，含 id 前缀通配）
        for k in [
            "default",
            "my-role_2",
            "opencode-go/deepseek-v4.1-flash",
            "opencode-go/*",
            "openrouter/google/*",
        ] {
            apply_chain_edit(&mut m, k, Some(&["a/b:high".to_string()])).unwrap();
        }
        assert_eq!(m.len(), 5);
    }

    #[test]
    fn chain_edit_serializes_to_record_json() {
        let mut m = ChainMap::new();
        apply_chain_edit(
            &mut m,
            "opencode-go/*",
            Some(&["anthropic/claude-sonnet-5:max".to_string()]),
        )
        .unwrap();
        let json = serde_json::to_string(&m).unwrap();
        // 通配键的 `*`、条目里的 `/` 与 `:` 必须原样保留（omp 的既有形态）
        assert_eq!(
            json,
            r#"{"opencode-go/*":["anthropic/claude-sonnet-5:max"]}"#
        );
    }

    #[test]
    fn push_line_keeps_tail_window() {
        let mut s = LoginStatus::default();
        for i in 0..(LOGIN_LINES_MAX + 5) {
            push_line(&mut s, format!("line {i}"));
        }
        assert_eq!(s.lines.len(), LOGIN_LINES_MAX);
        assert_eq!(s.lines.first().unwrap(), "line 5");
        assert_eq!(
            s.lines.last().unwrap(),
            &format!("line {}", LOGIN_LINES_MAX + 4)
        );
    }

    /// `config list --json` → 多键挑选：值取 `value` 字段，上游没有的键不出现在结果里。
    #[test]
    fn pick_values_selects_requested_keys_only() {
        let all: serde_json::Map<String, serde_json::Value> = serde_json::from_str(
            r#"{
                "modelRoles": {"value": {"default": "a/b"}, "type": "record", "description": ""},
                "cycleOrder": {"value": ["default"], "type": "array", "description": ""},
                "retry.modelFallback": {"value": true, "type": "boolean", "description": ""}
            }"#,
        )
        .unwrap();
        let picked = pick_values(&all, &["modelRoles", "retry.modelFallback", "missing.key"]);
        assert_eq!(picked.len(), 2, "缺失的键不出现");
        assert_eq!(picked["modelRoles"], serde_json::json!({"default": "a/b"}));
        assert_eq!(picked["retry.modelFallback"], serde_json::json!(true));
        // 空请求 → 空结果（不返回全量）
        assert!(pick_values(&all, &[]).is_empty());
    }
}
