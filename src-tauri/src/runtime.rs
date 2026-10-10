//! M2 实时运行时：per-会话长驻 `omp --mode rpc-ui` 子进程。
//!
//! 线路：spawn → 等 ready → negotiate v2 → get_state（拿身份）→
//! 后台读 stdout 行 → rpc_chunk 重组 → 按 type 分发 emit 事件。
//!
//! 用 `rpc-ui` 而非 `rpc`：上游把 `hasUI=true` 的 RPC 变体单独出一个模式，
//! 差别是会话会挂上 `ask` 工具（模型能主动向用户提问，UI 请求走既有的
//! `extension_ui_request` 桥）。实测对比与帧形状见 docs/rpc-memo.md §1。

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicI64, AtomicU8, Ordering},
        Arc,
    },
};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, ChildStdin},
    sync::mpsc,
};

use crate::commands::cmd_err;

#[derive(Debug, Clone)]
pub struct SpawnOpts {
    pub bin: String,
    pub cwd: String,
    pub resume: Option<String>,
    pub model: Option<String>,
    pub thinking: Option<String>,
    pub approval: Option<String>,
}

impl SpawnOpts {
    fn args(&self) -> Vec<String> {
        let mut a = vec!["--mode".into(), "rpc-ui".into(), "--cwd".into(), self.cwd.clone()];
        if let Some(r) = &self.resume {
            a.push("--resume".into());
            a.push(r.clone());
        }
        if let Some(m) = &self.model {
            a.push("--model".into());
            a.push(m.clone());
        }
        if let Some(t) = &self.thinking {
            a.push("--thinking".into());
            a.push(t.clone());
        }
        if let Some(x) = &self.approval {
            a.push("--approval-mode".into());
            a.push(x.clone());
        }
        a
    }
}

/// 会话活动态：闲置回收的判定依据（V34）。
///
/// `last_active_ms` 在**每次收到 omp 帧**时 touch（spawn 时刻起算）；
/// `state` 跟随 omp 的运行状态（帧驱动，与发给前端的 `omp-status://` 同一批更新点，
/// 见 [`emit_status`]）。回收只认 `idle`——`running`（agent 在干活，哪怕某个工具
/// 长时间没输出）/ `awaiting`（等用户审批）/ `exited`（异常退出）一律不碰。
pub struct SessionActivity {
    last_active_ms: AtomicI64,
    state: AtomicU8,
}

/// 与 `dispatch` 发给前端的 `{"state": ...}` 字符串一一对应。
pub const ACT_IDLE: u8 = 0;
pub const ACT_RUNNING: u8 = 1;
pub const ACT_AWAITING: u8 = 2;
/// 异常退出 / 错误：与「正常 idle」区分开，回收不认它。
pub const ACT_EXITED: u8 = 3;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl SessionActivity {
    fn new() -> Self {
        Self { last_active_ms: AtomicI64::new(now_ms()), state: AtomicU8::new(ACT_IDLE) }
    }

    fn touch(&self) {
        self.last_active_ms.store(now_ms(), Ordering::Relaxed);
    }

    /// 命令路径（approve / respond_ui 把状态改回 running）也可以直接落活动态。
    pub fn set_state(&self, s: u8) {
        self.state.store(s, Ordering::Relaxed);
    }

    /// 当前活动态（回读路径 `get_session_runtime` 用它把状态补回真值，见 [`activity_state_label`]）。
    pub fn state(&self) -> u8 {
        self.state.load(Ordering::Relaxed)
    }

    fn last_active_ms(&self) -> i64 {
        self.last_active_ms.load(Ordering::Relaxed)
    }
}

/// 活动态 → 前端口径的字符串（与 [`emit_status`] 的 `state` 一一对应；`error` / `exited`
/// 两档共用一个活动态，回读时统一报 `exited`——前端两档的展示同为「不在跑」）。
pub fn activity_state_label(s: u8) -> &'static str {
    match s {
        ACT_RUNNING => "running",
        ACT_AWAITING => "awaiting-approval",
        ACT_IDLE => "idle",
        _ => "exited",
    }
}

impl Default for SessionActivity {
    fn default() -> Self {
        Self::new()
    }
}

/// 闲置回收阈值：idle 且这么久没有任何帧 → 回收（kill）长驻进程。
/// 内存大头就是这些常驻 omp 进程（每个 0.5–1GB，实测见 docs/v17-schedule.md），
/// 而「浏览过的会话」会一直留着——不回收，开十个会话就是十个进程。
/// 回收后**重新打开 / 直接发消息都会自动 resume**（`send_prompt` 的自动恢复），
/// 所以这个阈值不需要保守到「用户回来第一眼看不到会话」的程度。
pub const IDLE_RECYCLE_MS: i64 = 30 * 60 * 1000;

/// 回收扫描间隔。
const REAP_INTERVAL_SECS: u64 = 60;

/// 单个会话是否符合回收条件（纯判定，不含「已落盘」检查——那是调用处的 I/O）。
fn idle_recyclable(act: &SessionActivity, now_ms: i64, idle_ms: i64) -> bool {
    act.state() == ACT_IDLE && now_ms.saturating_sub(act.last_active_ms()) >= idle_ms
}

/// 闲置回收循环（app 启动时挂一次）：每 [`REAP_INTERVAL_SECS`] 秒扫一遍聊天会话进程表，
/// 把「idle 超阈值 + 已落盘」的会话 kill 掉。
///
/// 为什么必须「已落盘」：omp 的 jsonl 是懒写盘的（首个 turn 才落文件），刚建好、
/// 还没说过话的会话被回收后磁盘上什么都没有——列表靠 runtime 补的那一行会凭空消失。
///
/// 静默回收（不发状态事件）：回收只发生在 idle，前端状态本来就显示 idle，一致；
/// 用户回来后发消息走自动恢复，中间不需要看见「已退出」这类会吓人的中间态。
pub fn start_idle_reaper<R: tauri::Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(REAP_INTERVAL_SECS)).await;
            let state = app.state::<crate::commands::AppState>();
            let now = now_ms();
            let victims: Vec<String> = {
                let rt = state.runtime.lock().await;
                rt.iter()
                    .filter(|(_, r)| {
                        idle_recyclable(&r.activity, now, IDLE_RECYCLE_MS)
                            && r.session_file.as_ref().map(|f| f.exists()).unwrap_or(false)
                    })
                    .map(|(k, _)| k.clone())
                    .collect()
            };
            for sid in victims {
                eprintln!("[omp-mini] 回收闲置聊天会话进程：{sid}");
                crate::commands::kill_runtime(&state, &sid);
            }
        }
    });
}

pub struct RunningChild {
    pub tx: mpsc::UnboundedSender<String>,
    pub child: Child,
    /// 运行时真值快照（模型 / 可用思考档 / 当前档 / 用量），供打开会话时回填。
    pub meta: SessionMeta,
    /// spawn 时的 `--cwd`。omp 的 jsonl 是**懒写盘**的（首个 turn 才落文件），
    /// 刚建好的会话读不到文件头，会话归属只能靠这份事实，不许退回「未归属」。
    pub cwd: String,
    /// spawn 时刻（毫秒）。同理：没落盘就没有会话时间可用，列表补行时用这份事实，
    /// 而不是每次刷新都拿「现在」，免得那一行的时间随刷新跳动。
    pub created_ms: i64,
    /// 活动态（V34 闲置回收判定 / 帧触达）。
    pub activity: Arc<SessionActivity>,
    /// 会话 jsonl 路径（握手 `get_state` 的 `sessionFile`）。回收只碰**已落盘**的会话。
    pub session_file: Option<PathBuf>,
}

pub type RuntimeMap = Arc<Mutex<HashMap<String, RunningChild>>>;

/// 模型引用（精简：前端只需拼 selector = provider/id）。
#[derive(Debug, Clone, serde::Serialize)]
pub struct ModelRef {
    pub provider: String,
    pub id: String,
    pub name: Option<String>,
}

/// 上下文占用（omp `get_state.contextUsage`）——纯透传，前端不自算。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    pub tokens: Option<i64>,
    pub context_window: Option<i64>,
    /// omp 给的就是百分比（0–100，实测 `usedTokens / contextWindow * 100`，不是 0–1 比例）。
    pub percent: Option<f64>,
}

/// 最近一轮的用量（omp `message_end.message.usage`，实测结构与成本都在里面）。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: Option<i64>,
    pub output: Option<i64>,
    pub total_tokens: Option<i64>,
    pub cache_read: Option<i64>,
    pub reasoning_tokens: Option<i64>,
    pub cost_total: Option<f64>,
}

impl Usage {
    fn from_json(u: &serde_json::Value) -> Self {
        let n = |k: &str| u.get(k).and_then(|x| x.as_i64());
        Self {
            input: n("input"),
            output: n("output"),
            total_tokens: n("totalTokens"),
            cache_read: n("cacheRead"),
            reasoning_tokens: n("reasoningTokens"),
            cost_total: u.get("cost").and_then(|c| c.get("total")).and_then(|x| x.as_f64()),
        }
    }
}

/// 会话运行时真值：由 omp `get_state` / `set_model` / `message_end` 回包提取，前端只读回填。
/// 实时变化经 `omp-state://<id>` 推送，与命令 `get_session_runtime` 结构一致。
#[derive(Debug, Clone, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub model: Option<ModelRef>,
    /// 当前模型可用思考档（omp `model.thinking.efforts`）；`None` = 不支持思考。
    pub efforts: Option<Vec<String>>,
    /// 当前思考档；缺键（无思考模型）= `None`。
    pub thinking_level: Option<String>,
    /// 上下文占用（`get_state.contextUsage`）。
    pub context_usage: Option<ContextUsage>,
    /// 最近一轮用量（`message_end.message.usage`）。
    pub usage: Option<Usage>,
    /// 最近一轮耗时（毫秒）；omp 原样给毫秒，这里不做任何换算。
    pub duration_ms: Option<f64>,
    /// 最近一轮首字延迟（毫秒）。
    pub ttft_ms: Option<f64>,
    /// 排队中的消息数（`get_state.queuedMessageCount`）。
    pub queued_count: Option<i64>,
    /// 任务计划（`get_state.todoPhases` 原样透传）。
    pub todo_phases: Option<serde_json::Value>,
    /// 可用命令（`available_commands_update` 缓存）。
    pub commands: Option<serde_json::Value>,
    /// 当前活动态（`idle` / `running` / `awaiting-approval` / `exited`）。
    ///
    /// **只在回读（`get_session_runtime`）里填**：`omp-status://` 的事件是推送，前端切走
    /// 期间收不到——切回时靠这次回读把状态补回真值（否则一个正在跑的会话会显示成 idle，
    /// 输入框会把下一句当新 prompt 发出去 = 打断进行中的轮次）。事件推送里保持 `None`，
    /// 前端按事件维护自己那份副本。
    pub status: Option<String>,
    /// 上下文非消息部分的字符权重（`get_state` 的 systemPrompt / dumpTools 估算）。
    /// **不进前端**：只给 `get_context_breakdown` 用，原始 systemPrompt / dumpTools 有几十 KB，
    /// 留在快照里会让每次 `omp-state` 推送都背上它。
    #[serde(skip)]
    pub ctx_weights: Option<crate::context::Weights>,
}

impl SessionMeta {
    /// 从 `get_state` 的 data 段提取真值。
    pub fn from_state(d: &serde_json::Value) -> Self {
        let m = d.get("model").filter(|m| !m.is_null());
        Self {
            model: m.and_then(model_ref),
            efforts: m.and_then(efforts_of),
            thinking_level: d.get("thinkingLevel").and_then(|x| x.as_str()).map(str::to_string),
            context_usage: d.get("contextUsage").filter(|c| !c.is_null()).map(|c| ContextUsage {
                tokens: c.get("tokens").and_then(|x| x.as_i64()),
                context_window: c.get("contextWindow").and_then(|x| x.as_i64()),
                percent: c.get("percent").and_then(|x| x.as_f64()),
            }),
            queued_count: d.get("queuedMessageCount").and_then(|x| x.as_i64()),
            todo_phases: d.get("todoPhases").filter(|t| !t.is_null()).cloned(),
            // 用量 / 耗时 / 命令来自事件流，回读时保留旧值（见 handle_frame 的 StateSync 分支）
            usage: None,
            duration_ms: None,
            ttft_ms: None,
            commands: None,
            // 活动态不在 `get_state` 回包里，由回读路径（`get_session_runtime`）从进程表现取
            status: None,
            // 系统提示词 / 工具定义只在 get_state 里有，就地折成字符权重后丢掉原文
            ctx_weights: crate::context::weights_from_state(d),
        }
    }

    /// 从 `set_model` 回包（data 即模型对象本身）提取；档位留空，等随后的 `get_state` 回读填。
    pub fn from_model(m: &serde_json::Value) -> Self {
        Self {
            model: model_ref(m),
            efforts: efforts_of(m),
            thinking_level: None,
            ..Self::default()
        }
    }

    /// 从 `message_end` 的 assistant 消息提取用量与耗时；非 assistant / 无字段返回 `None`。
    fn usage_from_message_end(m: &serde_json::Value) -> Option<(Option<Usage>, Option<f64>, Option<f64>)> {
        if m.get("role").and_then(|r| r.as_str()) != Some("assistant") {
            return None;
        }
        let usage = m.get("usage").filter(|u| !u.is_null()).map(Usage::from_json);
        let duration = m.get("duration").and_then(|x| x.as_f64());
        let ttft = m.get("ttft").and_then(|x| x.as_f64());
        if usage.is_none() && duration.is_none() && ttft.is_none() {
            return None;
        }
        Some((usage, duration, ttft))
    }
}

/// 提取精简模型引用（provider/id/name）。
fn model_ref(m: &serde_json::Value) -> Option<ModelRef> {
    let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if id.is_empty() {
        return None;
    }
    Some(ModelRef {
        provider: m.get("provider").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        id,
        name: m.get("name").and_then(|x| x.as_str()).map(str::to_string),
    })
}

/// 思考档强度序（与 omp CLI `--thinking` 全集一致，off 最弱）。
pub const EFFORT_ORDER: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

/// 提取模型可用思考档：`thinking.efforts`（对象形态）或 `thinking`（数组形态）。
/// 空数组归一为 `None`（视同不支持思考）。
pub fn efforts_of(model: &serde_json::Value) -> Option<Vec<String>> {
    let t = model.get("thinking")?;
    let arr = if t.is_array() { Some(t) } else { t.get("efforts") };
    let out: Vec<String> = arr?
        .as_array()?
        .iter()
        .filter_map(|x| x.as_str())
        .map(str::to_string)
        .collect();
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

/// 该模型支持的最高档（不在 8 档全集内的一律忽略）；无可用档 = `off`。
pub fn highest_effort(efforts: Option<&Vec<String>>) -> String {
    let mut best = "off";
    let mut rank = 0usize;
    for e in efforts.into_iter().flatten() {
        if let Some(r) = EFFORT_ORDER.iter().position(|x| x == e) {
            if r > rank {
                rank = r;
                best = EFFORT_ORDER[r];
            }
        }
    }
    best.to_string()
}

/// v2 大帧分片重组器（rpc_chunk）。V1 先实现校验 + 重组。
#[derive(Default)]
pub struct ChunkAsm {
    cur: Option<(String, usize, Vec<Option<String>>)>,
}

impl ChunkAsm {
    /// 输入一行解析后的帧；返回重组完成的完整帧（若有）。
    pub fn feed(&mut self, v: &serde_json::Value) -> Option<serde_json::Value> {
        if v.get("type").and_then(|t| t.as_str()) != Some("rpc_chunk") {
            return None;
        }
        let id = v.get("chunkId").and_then(|s| s.as_str())?.to_string();
        let index = v.get("index").and_then(|n| n.as_u64())? as usize;
        let count = v.get("count").and_then(|n| n.as_u64())? as usize;
        let data = v.get("data").and_then(|s| s.as_str())?.to_string();
        if count == 0 || count > 4096 || index >= count {
            self.cur = None;
            return None;
        }
        match &mut self.cur {
            Some((cid, ccount, parts)) if *cid == id && *ccount == count => {
                if parts[index].is_some() {
                    self.cur = None;
                    return None;
                }
                parts[index] = Some(data);
            }
            _ => {
                let mut parts = vec![None; count];
                parts[index] = Some(data);
                self.cur = Some((id, count, parts));
            }
        }
        let done = self.cur.as_ref().map(|(_, _, p)| p.iter().all(|x| x.is_some())).unwrap_or(false);
        if !done {
            return None;
        }
        let (_, _, parts) = self.cur.take().unwrap();
        let joined: String = parts.into_iter().flatten().collect();
        let bytes = b64decode(&joined)?;
        let text = String::from_utf8(bytes).ok()?;
        serde_json::from_str(&text).ok()
    }
}

/// spawn 长驻进程并完成握手，登记进 `RuntimeMap`（**键 = 会话 id**）并启动 pump。
/// 成功返回 `(session_id, session_file, 运行时真值)`。
///
/// 为什么不用调用方给的 key 作 map 键：像 `create_session` 这样的调用方手里只有占位键
/// （`new-<ts>`），真身份要握手才知道；而事件三通道与 pump 的 map 查询（真值快照 /
/// 命令面缓存 / 偏好回写）**从第一帧起**就得按会话 id 走——占位键会把新建会话的帧发到
/// 无人订阅的通道（实测见 `docs/v34-schedule.md` §1.3）。这里统一以 sid 为键，
/// 调用方拿到的返回值即最终身份、无需换名。
pub async fn spawn_long_lived<R: tauri::Runtime>(
    app: &AppHandle<R>,
    map: RuntimeMap,
    opts: SpawnOpts,
) -> Result<(String, String, SessionMeta), crate::commands::CmdError> {
    let mut child = tokio::process::Command::new(&opts.bin)
        .args(opts.args())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| cmd_err("SPAWN_FAILED", format!("启动 omp 失败：{e}"), None))?;

    let stdin: ChildStdin = child.stdin.take().unwrap();
    let reader = BufReader::new(child.stdout.take().unwrap()).lines();
    let (tx, rx) = mpsc::unbounded_channel::<String>();

    // 先做同步握手拿身份（30s 超时）
    let mut reader = reader;
    let mut stdin_opt = Some(stdin);
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    // 握手期间到达的帧先攒着，等 pump 起来后原序回放（见 pump 启动处的说明）
    let mut leftover: Vec<String> = Vec::new();
    loop {
        let line = tokio::time::timeout_at(deadline, reader.next_line())
            .await
            .map_err(|_| cmd_err("RPC_TIMEOUT", "等待 omp 就绪超时".into(), None))?
            .map_err(|e| cmd_err("RPC_IO", format!("读取 omp 输出失败：{e}"), None))?;
        match line {
            Some(l) if l.trim().is_empty() => continue,
            Some(l) => {
                let v: serde_json::Value = serde_json::from_str(l.trim()).unwrap_or_default();
                if v.get("type").and_then(|t| t.as_str()) == Some("ready") {
                    break;
                }
                leftover.push(l);
            }
            None => return Err(cmd_err("RPC_EOF", "omp 进程意外退出".into(), None)),
        }
    }
    {
        let s = stdin_opt.as_mut().unwrap();
        s.write_all(b"{\"id\":\"h-neg\",\"type\":\"negotiate_protocol\",\"protocolVersion\":2}\n")
            .await
            .map_err(|e| cmd_err("RPC_IO", format!("写入失败：{e}"), None))?;
        s.write_all(b"{\"id\":\"h-state\",\"type\":\"get_state\"}\n")
            .await
            .map_err(|e| cmd_err("RPC_IO", format!("写入失败：{e}"), None))?;
        // 子代理帧订阅：omp 默认 `"off"`，不主动开的话 task 工具跑子代理时壳侧一帧都收不到
        // （此前界面只有一个转圈的 task 行）。`"progress"` 转发 lifecycle + progress 两类。
        // 回包（成功 / 旧版不认此命令的失败）由 classify 的 Swallow 分支本地消化，不进前端。
        s.write_all(b"{\"id\":\"h-sub\",\"type\":\"set_subagent_subscription\",\"level\":\"progress\"}\n")
            .await
            .map_err(|e| cmd_err("RPC_IO", format!("写入失败：{e}"), None))?;
        s.flush().await.map_err(|e| cmd_err("RPC_IO", format!("写入失败：{e}"), None))?;
    }
    let (sid, sfile, meta) = loop {
        let line = tokio::time::timeout_at(deadline, reader.next_line())
            .await
            .map_err(|_| cmd_err("RPC_TIMEOUT", "等待 omp 状态超时".into(), None))?
            .map_err(|e| cmd_err("RPC_IO", format!("读取 omp 输出失败：{e}"), None))?;
        let Some(l) = line else {
            return Err(cmd_err("RPC_EOF", "omp 进程意外退出".into(), None));
        };
        if l.trim().is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(l.trim()) else { continue };
        // 握手包里别的不只是噪声：omp 在 `get_state` 回包**之前**就把
        // `available_commands_update` 发出来了（实测帧序：ready → setWidget →
        // advisor_cost_changed → available_commands_update → negotiate 回包 → get_state 回包）。
        // 早先这里整条丢弃，于是前端永远收不到命令面，`/` 补全一个候选都不弹。
        // 现在按原序攒下、pump 起来后回放（不进会话流的东西由前端自己忽略）。
        if !(v.get("type").and_then(|t| t.as_str()) == Some("response")
            && v.get("id").and_then(|i| i.as_str()) == Some("h-state"))
        {
            leftover.push(l);
            continue;
        }
        if v.get("success").and_then(|s| s.as_bool()) != Some(true) {
            return Err(cmd_err(
                "RPC_STATE",
                format!("获取会话状态失败：{}", v.get("error").and_then(|e| e.as_str()).unwrap_or("")),
                None,
            ));
        }
        let d = v.get("data").cloned().unwrap_or_default();
        let sid = d.get("sessionId").and_then(|s| s.as_str()).map(|s| s.to_string());
        let sfile = d.get("sessionFile").and_then(|s| s.as_str()).map(|s| s.to_string());
        match (sid, sfile) {
            (Some(a), Some(b)) => break (a, b, SessionMeta::from_state(&d)),
            _ => return Err(cmd_err("RPC_STATE", "未拿到会话身份".into(), None)),
        }
    };

    // 先登记进程再起 pump：回放握手帧时会走 `update_meta`（命令面缓存等），
    // 快照里还没有这一条的话那些帧就白回了。
    let mut m = map.lock().await;
    // 同一会话的旧进程先杀（重复 open / 重开的竞态）；stdin 关闭等于进程退出（code 0）
    if let Some(old) = m.remove(&sid) {
        let _ = old.tx.send(String::new());
        let mut c = old.child;
        let _ = c.kill().await;
    }
    m.insert(
        sid.clone(),
        RunningChild {
            tx,
            child,
            meta: meta.clone(),
            cwd: opts.cwd.clone(),
            created_ms: chrono::Utc::now().timestamp_millis(),
            activity: Arc::new(SessionActivity::new()),
            session_file: Some(PathBuf::from(&sfile)),
        },
    );
    // pump 与回收判定共用同一份活动态（帧触达 / 状态更新都在泵里）
    let activity = m.get(&sid).map(|r| r.activity.clone()).unwrap();
    drop(m);

    // 启动后台 pump：stdin 写 + stdout 读分发（先把握手期间攒下的帧原序回放）。
    // 通道名与 map 查询键都用 **sid**（会话 id）：前端从订阅建立那一刻起听的永远是
    // `omp-*://<会话 id>`——用占位键会把新建会话的所有帧发到无人订阅的通道
    // （V34 探针实证：占位键通道收到全部帧、sid 通道一条都没有）。
    let stdin = stdin_opt.take().unwrap();
    start_pump(app.clone(), sid.clone(), reader, stdin, rx, leftover, activity);

    // 开场真值快照：omp 的握手回包里已经有模型 / 思考档 / 上下文占用，但那份回包
    // **只在本地消化**（不进事件流），而前端建订阅后的那次 `get_session_runtime` 补拉
    // 会早于 spawn 完成（拉空）——不在这里补一发，打开旧会话后工具行上的模型与思考档
    // 就一直空着，直到用户手动切一次模型。前端建订阅通常早于握手完成（会话先选中、
    // spawn 要等 omp 起来），所以这一发能收到；真收不到也有那次补拉兜底。
    let _ = app.emit(&format!("omp-state://{sid}"), &meta);
    Ok((sid, sfile, meta))
}

/// `sid` = 会话 id：既是事件三通道（`omp-event` / `omp-status` / `omp-state`）的名字，
/// 也是 pump 内所有 map 查询（真值快照 / 命令面缓存 / 项目偏好回写）的键——
/// 与 map 的 key 解耦（create 的占位键会换名，见 [`spawn_long_lived`] 的说明）。
fn start_pump<R: tauri::Runtime>(
    app: AppHandle<R>,
    sid: String,
    mut reader: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    mut stdin: ChildStdin,
    mut rx: mpsc::UnboundedReceiver<String>,
    leftover: Vec<String>,
    activity: Arc<SessionActivity>,
) {
    let evt = format!("omp-event://{sid}");
    let status = format!("omp-status://{sid}");
    tauri::async_runtime::spawn(async move {
        let mut asm = ChunkAsm::default();
        let mut pending: std::collections::VecDeque<String> = Default::default();
        // 状态：idle 起
        emit_status(&app, &status, &activity, "idle", None);
        // 握手期间攒下的帧（命令面 / 单向宿主指令）按原序补发：
        // 它们到得比订阅早，不补发就等于永久丢失（`/` 补全没有数据源就是这个原因）。
        {
            for line in leftover {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                let v: serde_json::Value = match serde_json::from_str(&line) {
                    Ok(v) => v,
                    Err(_) => continue,
                };
                let full = if v.get("type").and_then(|t| t.as_str()) == Some("rpc_chunk") {
                    match asm.feed(&v) {
                        Some(full) => full,
                        None => continue,
                    }
                } else {
                    v
                };
                handle_frame(&app, &sid, &evt, &status, &full, &mut stdin, &activity).await;
            }
        }
        loop {
            tokio::select! {
                w = rx.recv() => {
                    match w {
                        Some(line) if line.is_empty() => break, // kill 哨兵
                        Some(line) => { pending.push_back(line); }
                        None => break,
                    }
                    while let Some(l) = pending.pop_front() {
                        if let Err(e) = stdin.write_all(l.as_bytes()).await {
                            emit_status(&app, &status, &activity, "error", Some(&format!("写入失败：{e}")));
                            break;
                        }
                    }
                    let _ = stdin.flush().await;
                }
                r = reader.next_line() => {
                    match r {
                        Ok(Some(line)) => {
                            let line = line.trim().to_string();
                            if line.is_empty() { continue; }
                            // 任何一帧都算活动（闲置回收的触达点）：running 的会话
                            // 一直在推帧，天然不会被回收；真闲下来的会话才开始计时。
                            activity.touch();
                            let v: serde_json::Value = match serde_json::from_str(&line) {
                                Ok(v) => v,
                                Err(_) => continue, // 坏行跳过记日志（M4 补日志通道）
                            };
                            // 分片帧先重组
                            let full = if v.get("type").and_then(|t| t.as_str()) == Some("rpc_chunk") {
                                match asm.feed(&v) {
                                    Some(full) => full,
                                    None => continue,
                                }
                            } else {
                                v
                            };
                            handle_frame(&app, &sid, &evt, &status, &full, &mut stdin, &activity).await;
                        }
                        _ => {
                            emit_status(&app, &status, &activity, "exited", Some("omp 进程已退出"));
                            break;
                        }
                    }
                }
            }
        }
    });
}

/// 状态回读回包的固定 id（pump 自发自收，不暴露给前端）。
const STATE_SYNC_ID: &str = "sync-state";

/// 构造一行 JSONL 命令；`extra` 为对象时并入顶层字段。
fn jsonl_line(id: &str, ty: &str, extra: serde_json::Value) -> Option<String> {
    let mut o = serde_json::Map::new();
    o.insert("id".into(), serde_json::Value::String(id.to_string()));
    o.insert("type".into(), serde_json::Value::String(ty.to_string()));
    if let serde_json::Value::Object(m) = extra {
        for (k, v) in m {
            o.insert(k, v);
        }
    }
    Some(format!("{}\n", serde_json::Value::Object(o)))
}

/// 更新 map 中的真值快照。用 `try_lock`：pump 不阻塞命令路径，拿不到就跳过（下次回读会补）。
fn update_meta<R: tauri::Runtime>(app: &AppHandle<R>, key: &str, f: impl FnOnce(&mut SessionMeta)) {
    let map = app.state::<crate::commands::AppState>().runtime.clone();
    let guard = map.try_lock();
    if let Ok(mut m) = guard {
        if let Some(r) = m.get_mut(key) {
            f(&mut r.meta);
        }
    }
}

/// 帧分类结果：状态回读 / 普通透传（附可选跟进命令）/ 本地消化。
#[derive(Debug, PartialEq)]
pub enum FrameAction {
    /// 状态回读回包：只更新真值快照 + 推送 `omp-state`，不进会话流
    StateSync,
    /// 透传给前端；`Some(line)` 表示还要追加写回 stdin 的跟进命令
    Forward(Option<String>),
    /// 壳侧内部管理命令的回包：本地消化，不进前端（用户没发起过这个动作，
    /// 成功无需展示，失败也只会变成一条莫名其妙的「操作失败」分隔线）。
    Swallow,
}

/// 判断一帧要不要跟进命令（纯函数，便于单测）。
///
/// 两条实测约束驱动此处逻辑（见 docs/rpc-memo.md §3）：
/// 1. omp 切模型后**不会**自动修正思考档（切到无思考模型会直接丢掉档位）→ 自动重设为新模型最高档；
/// 2. `set_thinking_level` 对非法档也回 `success:true`（静默归一/忽略）→ 只能靠 `get_state` 回读收敛 UI。
pub fn classify(v: &serde_json::Value) -> FrameAction {
    if v.get("type").and_then(|t| t.as_str()) != Some("response") {
        return FrameAction::Forward(None);
    }
    let rid = v.get("id").and_then(|i| i.as_str()).unwrap_or("");
    if rid == STATE_SYNC_ID {
        return FrameAction::StateSync;
    }
    let cmd = v.get("command").and_then(|c| c.as_str()).unwrap_or("");
    let ok = v.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    match cmd {
        // 会话建立时壳侧自己发的订阅命令：回执本地消化（成功无展示价值；旧版 omp
        // 不认这个命令会回失败，同样不许把它渲染成用户可见的错误行）。
        "set_subagent_subscription" => FrameAction::Swallow,
        "set_model" if ok => {
            let efforts = v.get("data").and_then(efforts_of);
            let level = highest_effort(efforts.as_ref());
            FrameAction::Forward(jsonl_line(
                "auto-think",
                "set_thinking_level",
                serde_json::json!({"level": level}),
            ))
        }
        // 切换失败也回读：纠正前端乐观态
        "set_model" | "set_thinking_level" => {
            FrameAction::Forward(jsonl_line(STATE_SYNC_ID, "get_state", serde_json::Value::Null))
        }
        _ => FrameAction::Forward(None),
    }
}

/// 单帧处理：按分类更新真值快照 / 注入跟进命令，再分发给前端。
async fn handle_frame<R: tauri::Runtime>(
    app: &AppHandle<R>,
    key: &str,
    evt: &str,
    status: &str,
    v: &serde_json::Value,
    stdin: &mut ChildStdin,
    activity: &SessionActivity,
) {
    if v.get("type").and_then(|t| t.as_str()) == Some("response") {
        match classify(v) {
            FrameAction::Swallow => return,
            FrameAction::StateSync => {
                if v.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
                    let d = v.get("data").cloned().unwrap_or_default();
                    let mut meta = SessionMeta::from_state(&d);
                    update_meta(app, key, |m| {
                        // 用量 / 耗时 / 命令缓存来自事件流而非 get_state：回读时不能抹掉
                        meta.usage = m.usage.clone();
                        meta.duration_ms = m.duration_ms;
                        meta.ttft_ms = m.ttft_ms;
                        meta.commands = m.commands.clone();
                        *m = meta.clone();
                    });
                    let payload = serde_json::to_value(&meta).unwrap_or(serde_json::Value::Null);
                    let _ = app.emit(&format!("omp-state://{key}"), payload);
                    // 真值顺带回写项目偏好：新建会话时沿用该项目上次的模型/思考档
                    let st = app.state::<crate::commands::AppState>();
                    let selector = meta.model.as_ref().map(|m| format!("{}/{}", m.provider, m.id));
                    crate::commands::remember_project_pref(&st, key, selector, meta.thinking_level.clone())
                        .await;
                }
                return;
            }
            FrameAction::Forward(inject) => {
                // set_model 回包的 data 即模型对象本身：先落真值（档位由随后的回读填）
                if v.get("command").and_then(|c| c.as_str()) == Some("set_model") {
                    if let Some(d) = v.get("data").filter(|d| d.get("provider").is_some()) {
                        let meta = SessionMeta::from_model(d);
                        update_meta(app, key, |m| {
                            m.model = meta.model;
                            m.efforts = meta.efforts;
                        });
                    }
                }
                if let Some(line) = inject {
                    let _ = stdin.write_all(line.as_bytes()).await;
                    let _ = stdin.flush().await;
                }
            }
        }
    }
    // 用量 / 耗时真值：assistant 消息结束时随 omp-state 推给前端（状态条纯透传的数据源）
    if v.get("type").and_then(|t| t.as_str()) == Some("message_end") {
        if let Some((usage, duration, ttft)) = v
            .get("message")
            .and_then(SessionMeta::usage_from_message_end)
        {
            let map = app.state::<crate::commands::AppState>().runtime.clone();
            let payload = {
                let mut guard = map.lock().await;
                guard.get_mut(key).map(|r| {
                    if usage.is_some() {
                        r.meta.usage = usage;
                    }
                    if duration.is_some() {
                        r.meta.duration_ms = duration;
                    }
                    if ttft.is_some() {
                        r.meta.ttft_ms = ttft;
                    }
                    serde_json::to_value(&r.meta).unwrap_or(serde_json::Value::Null)
                })
            };
            if let Some(p) = payload {
                let _ = app.emit(&format!("omp-state://{key}"), p);
            }
        }
    }
    // 一轮终了回读状态：`contextUsage` 只出现在 get_state 回包里，不回读的话输入框工具行上的
    // 上下文占用会一直停在「打开会话那一刻」，压缩入口（≥80%）也就永远不触发。
    // 只认终态 agent_end：非终态（还有排队 / 子代理在跑）回读没有意义。
    if v.get("type").and_then(|t| t.as_str()) == Some("agent_end")
        && v.get("isTerminal").and_then(|b| b.as_bool()).unwrap_or(true)
    {
        if let Some(line) = jsonl_line(STATE_SYNC_ID, "get_state", serde_json::Value::Null) {
            let _ = stdin.write_all(line.as_bytes()).await;
            let _ = stdin.flush().await;
        }
    }
    dispatch(app, key, evt, status, v, activity);
}

/// 状态唯一的出口：更新活动态（回收判定读它）+ 推 `omp-status://` 给前端。
/// `state` 取前端口径的字符串（idle / running / awaiting-approval / error / exited）；
/// `error` / `exited` 都归入 [`ACT_EXITED`]——回收只认 `idle`。
fn emit_status<R: tauri::Runtime>(
    app: &AppHandle<R>,
    status_ch: &str,
    activity: &SessionActivity,
    state: &str,
    detail: Option<&str>,
) {
    activity.state.store(
        match state {
            "running" => ACT_RUNNING,
            "awaiting-approval" => ACT_AWAITING,
            "idle" => ACT_IDLE,
            _ => ACT_EXITED,
        },
        Ordering::Relaxed,
    );
    let mut payload = serde_json::json!({ "state": state });
    if let Some(d) = detail {
        payload["detail"] = serde_json::Value::String(d.to_string());
    }
    let _ = app.emit(status_ch, payload);
}

fn dispatch<R: tauri::Runtime>(
    app: &AppHandle<R>,
    key: &str,
    evt: &str,
    status: &str,
    v: &serde_json::Value,
    activity: &SessionActivity,
) {
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match t {
        "agent_start" => {
            emit_status(app, status, activity, "running", None);
        }
        "agent_end" => {
            let terminal = v.get("isTerminal").and_then(|b| b.as_bool()).unwrap_or(true);
            if terminal {
                emit_status(app, status, activity, "idle", None);
            }
        }
        // 本地命令完成信号（`prompt` 回包 `data.agentInvoked:false` 或后续
        // `prompt_result{agentInvoked:false}`）：没有 agent turn、不会有
        // `agent_end`，此处直接收敛到 idle，否则转圈停不下来。
        "response" if is_local_prompt_result(v) => {
            emit_status(app, status, activity, "idle", None);
            let _ = app.emit(evt, v);
        }
        "prompt_result" if !v.get("agentInvoked").and_then(|b| b.as_bool()).unwrap_or(true) => {
            emit_status(app, status, activity, "idle", None);
            let _ = app.emit(evt, v);
        }
        "command_output" | "notice" | "todo_reminder" | "goal_updated" | "irc_message" => {
            // 本地命令输出 / 单向通知 / 计划提醒：透传给前端渲染，不触碰运行状态。
            let _ = app.emit(evt, v);
        }
        "available_commands_update" => {
            // 可用命令面：缓存后透传，前端 `/` 补全的数据源。
            if let Some(cmds) = v.get("commands") {
                let cmds = cmds.clone();
                update_meta(app, key, |m| {
                    m.commands = Some(cmds.clone());
                });
            }
            let _ = app.emit(evt, v);
        }
        "auto_compaction_start" | "auto_compaction_end" | "auto_retry_start" | "auto_retry_end"
        | "retry_fallback_applied" | "retry_fallback_succeeded" | "subagent_lifecycle" | "subagent_progress"
        | "subagent_event" => {
            // 压缩 / 重试 / 子代理生命周期：透传给前端渲染成分隔线。
            let _ = app.emit(evt, v);
        }
        "extension_ui_request" => {
            // 需要用户回包的方法才会进「等待输入」状态（审批 + 通用 UI 请求）；
            // 单向方法（notify / setStatus / setWidget / setTitle / set_editor_text）
            // 与服务端撤回（cancel）都不是等待，别把 composer 锁住。
            let method = v.get("method").and_then(|m| m.as_str()).unwrap_or("");
            if matches!(method, "select" | "confirm" | "input" | "editor") {
                emit_status(app, status, activity, "awaiting-approval", None);
            }
            let _ = app.emit(evt, v);
        }
        "response" | "message_start" | "message_update" | "message_end" | "turn_start" | "turn_end"
        | "tool_execution_start" | "tool_execution_update" | "tool_execution_end" | "model_changed"
        | "thinking_level_changed" | "title_change" => {
            let _ = app.emit(evt, v);
        }
        _ => {
            // 未知帧：透传 unknown 进日志不崩（前端忽略）
            let _ = app.emit(evt, v);
        }
    }
}

/// `prompt` 回包是否代表"本地收尾、无 agent turn"：
/// `command == "prompt" && success && data.agentInvoked == false`。
/// agent 真正开跑（`agentInvoked:true` / 缺字段）时不收敛，等后续 `agent_end`。
fn is_local_prompt_result(v: &serde_json::Value) -> bool {
    if v.get("command").and_then(|c| c.as_str()) != Some("prompt") {
        return false;
    }
    if v.get("success").and_then(|s| s.as_bool()) != Some(true) {
        return false;
    }
    v.get("data")
        .and_then(|d| d.get("agentInvoked"))
        .and_then(|b| b.as_bool())
        == Some(false)
}

/// base64 小实现（避免新增依赖）：仅用于 rpc_chunk data 段。
pub fn b64decode(s: &str) -> Option<Vec<u8>> {
    let mut out = vec![];
    let mut buf: u32 = 0;
    let mut bits = 0;
    for c in s.bytes() {
        let v = match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            _ => return None,
        } as u32;
        buf = (buf << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8 & 0xff);
        }
    }
    Some(out)
}

/// base64 编码（不带换行）：图片附件读文件后用（`read_image_file`）。
/// 与 `b64decode` 成对，避免为一个方向新增依赖。
pub fn b64encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for c in data.chunks(3) {
        let b0 = c[0] as u32;
        let b1 = *c.get(1).unwrap_or(&0) as u32;
        let b2 = *c.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// 应用退出路径：收掉全部聊天会话进程。
///
/// 不等优雅窗口（应用马上要没了，延迟补刀跑不到）：发 kill 哨兵让 pump 退出，
/// 同时 `start_kill`（同步信号，不 await）直接终止子进程——stdin 关闭本来会让
/// omp 以 code 0 退出，这里只是不给它「还在写盘」的机会。
pub fn kill_all(map: &RuntimeMap) {
    if let Ok(mut m) = map.try_lock() {
        for (_, r) in m.drain() {
            let _ = r.tx.send(String::new());
            let mut child = r.child;
            let _ = child.start_kill();
        }
    }
}

/// 真实 omp 的 RPC 冒烟（慢测试，**默认忽略**）。
///
/// 跑法：`cargo test --manifest-path src-tauri/Cargo.toml -- --ignored real_rpc`
/// 依赖：本机装好 `omp`（PATH / Homebrew 常见路径；可用 `OMP_BIN` 覆盖）＋ 一次真实 AI 调用。
///
/// 验的是 `spawn_long_lived` 的**完整代码路径**（不是纯函数）：spawn → 握手（negotiate v2 /
/// get_state / 子代理订阅）→ pump 读流 → `message_end` 用量回写 → `agent_end` 触发的
/// `get_state` 回读落到 `context_usage`，外加事件面（omp-event / omp-status 真的能到监听端）。
/// mock app（`tauri::test`）提供 AppHandle，不需要真实窗口。
#[cfg(test)]
mod real_rpc_tests {
    use super::*;
    use tauri::{Listener, Manager};

    fn omp_bin() -> Option<String> {
        if let Ok(v) = std::env::var("OMP_BIN") {
            return Some(v);
        }
        if let Ok(path) = std::env::var("PATH") {
            for dir in path.split(':') {
                let p = std::path::Path::new(dir).join("omp");
                if p.is_file() {
                    return Some(p.to_string_lossy().to_string());
                }
            }
        }
        for c in ["/opt/homebrew/bin/omp", "/usr/local/bin/omp"] {
            if std::path::Path::new(c).is_file() {
                return Some(c.to_string());
            }
        }
        None
    }

    #[test]
    #[ignore = "慢测试：真实 omp + 一次真实 AI 调用"]
    fn real_rpc_prompt_roundtrip() {
        let Some(bin) = omp_bin() else {
            eprintln!("[real_rpc] 跳过：本机找不到 omp（可用 OMP_BIN 指定）");
            return;
        };
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app 构建失败");
        // 会话进程表必须用 `AppState.runtime` 那一份：pump 的 meta 更新与 message_end 用量回写
        // 都经 `app.state::<AppState>()` 取表——传一份自己的 map 进去会看着「什么都没发生」。
        let state = crate::commands::load_state(app.handle());
        let map = state.runtime.clone();
        app.manage(state);
        let handle = app.handle().clone();

        // 事件面：omp-event / omp-status 都挂监听（顺带验证 emit 路径真能到监听端）。
        // 收集走无界通道（回调里只需同步 send），不引锁。
        // 注意：通道名 = 会话 id，而 sid 要握手后才拿得到——订阅只能发生在 spawn 之后
        // （pump 启动即回放握手期攒下的帧，这一瞬的竞态帧不作为本测试的断言对象；
        // 前端那边有 `syncSessionRuntime` 的补拉兜底）。
        let (evt_tx, mut evt_rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
        let (st_tx, mut st_rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();

        let cwd = std::env::temp_dir().join(format!("omp-rpc-it-{}", std::process::id()));
        std::fs::create_dir_all(&cwd).unwrap();
        // 状态序列跨 block_on 收集（轮询里顺手抽干通道；终态断言在 kill 之后统一做）
        let mut sts: Vec<String> = vec![];

        tauri::async_runtime::block_on(async {
            let (sid, sfile, meta) = spawn_long_lived(
                &handle,
                map.clone(),
                SpawnOpts {
                    bin,
                    cwd: cwd.to_string_lossy().to_string(),
                    resume: None,
                    model: None,
                    thinking: None,
                    approval: None,
                },
            )
            .await
            .expect("握手失败");
            assert!(!sid.is_empty(), "应拿到 sessionId");
            println!(
                "[real_rpc] 会话 {sid}（{sfile}）；模型 {:?}",
                meta.model.as_ref().map(|m| format!("{}/{}", m.provider, m.id))
            );
            // 拿到 sid 才订阅（通道名 = 会话 id；前端同口径）
            {
                let out = evt_tx.clone();
                handle.listen(format!("omp-event://{sid}").as_str(), move |e| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                        let _ = out.send(v);
                    }
                });
                let out = st_tx.clone();
                handle.listen(format!("omp-status://{sid}").as_str(), move |e| {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                        let _ = out.send(v);
                    }
                });
            }

            let tx = map.lock().await.get(&sid).unwrap().tx.clone();
            tx.send("{\"id\":\"p-it\",\"type\":\"prompt\",\"message\":\"Reply with exactly: ok\"}\n".to_string())
                .unwrap();

            // 握手期 get_state 已带 contextUsage——先记基线，终态要求它被回读刷新过（真值变了）
            let initial_ctx_tokens = meta.context_usage.as_ref().and_then(|c| c.tokens);
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            let mut usage_seen = false;
            let mut idle_seen = false;
            while std::time::Instant::now() < deadline {
                // 状态面：omp-status 的终态 idle 由 pump 在 agent_end(isTerminal) 时推（帧本身不透传）
                while let Ok(v) = st_rx.try_recv() {
                    let state = v.get("state").and_then(|s| s.as_str()).unwrap_or("").to_string();
                    if state == "idle" {
                        idle_seen = true;
                    }
                    sts.push(state);
                }
                let (usage, ctx_tokens) = {
                    let m = map.lock().await;
                    let r = m.get(&sid);
                    (
                        r.map(|r| r.meta.usage.is_some()).unwrap_or(false),
                        r.and_then(|r| r.meta.context_usage.as_ref()).and_then(|c| c.tokens),
                    )
                };
                if usage {
                    usage_seen = true;
                }
                // 1) message_end 的用量回写 + 2) agent_end 后 get_state 回读把 contextUsage 刷成新值
                if usage_seen && idle_seen && ctx_tokens.is_some() && ctx_tokens != initial_ctx_tokens {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            assert!(usage_seen, "120s 内没有等到 message_end 的用量回写");
            assert!(idle_seen, "120s 内状态没有回到 idle（agent_end 的收尾没跑）");

            // 收尾：kill 掉会话进程（与应用退出路径同一入口）
            kill_all(&map);
        });

        let mut kinds: Vec<String> = vec![];
        while let Ok(v) = evt_rx.try_recv() {
            kinds.push(v.get("type").and_then(|t| t.as_str()).unwrap_or("").to_string());
        }
        println!("[real_rpc] 收到 {} 帧：{kinds:?}", kinds.len());
        // 真实帧面：流式 message_update + message_end 必须有；agent_start/agent_end **不透传**
        // 会话流（agent_end 只推状态 idle），别拿它当完成信号。
        assert!(kinds.iter().any(|k| k == "message_update"), "应收到 message_update 流式帧");
        assert!(kinds.iter().any(|k| k == "message_end"), "应收到 message_end");
        // 握手期回放的 available_commands_update：本测试的订阅发生在 spawn 之后
        // （通道名要先拿到 sid），回放帧到得比订阅早时收不到——不断言，仅记录；
        // 「握手回放必达」的覆盖在 recycle 测试的 resume 场景（订阅先于 spawn）。
        println!(
            "[real_rpc] 命令面回放帧（订阅竞态，仅供参考）：{}",
            kinds.iter().any(|k| k == "available_commands_update")
        );
        assert!(sts.iter().any(|s| s == "running"), "状态应经过 running：{sts:?}");
        assert!(sts.iter().any(|s| s == "idle"), "状态应回到 idle：{sts:?}");
        while let Ok(v) = st_rx.try_recv() {
            sts.push(v.get("state").and_then(|s| s.as_str()).unwrap_or("").to_string());
        }
        println!("[real_rpc] 状态序列：{sts:?}");
        let _ = std::fs::remove_dir_all(&cwd);
    }

    /// V34 回收 → 发送自动恢复的真实慢测试（**默认忽略**）。
    ///
    /// 验的是闲置回收之后用户直接发消息的完整链路：kill 长驻进程（与 reaper 同一入口
    /// `kill_runtime`）→ `send_message` 发现进程不在 → `spawn_session_runtime` resume
    /// 拉起 → 消息送达 → 新一轮事件流照常。
    #[test]
    #[ignore = "慢测试：真实 omp + 两次真实 AI 调用（回收与自动恢复）"]
    fn real_rpc_recycle_recover() {
        let Some(bin) = omp_bin() else {
            eprintln!("[real_rpc] 跳过：本机找不到 omp（可用 OMP_BIN 指定）");
            return;
        };
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock app 构建失败");
        let state = crate::commands::load_state(app.handle());
        let map = state.runtime.clone();
        app.manage(state);
        let handle = app.handle().clone();

        let cwd = std::env::temp_dir().join(format!("omp-rpc-rc-{}", std::process::id()));
        std::fs::create_dir_all(&cwd).unwrap();

        tauri::async_runtime::block_on(async {
            // send_message 的自动恢复走 `state.omp_path`（真实应用由健康检查落位），
            // 测试直接注入
            let st = handle.state::<crate::commands::AppState>();
            *st.omp_path.lock().await = Some(bin.clone());

            // 初起照 create_session 的口径：spawn 内部以会话 id 作 runtime 表的键
            // （拿到 sid 前并不知道它，但调用方与 pump 从此都用同一个键）
            let (sid, sfile, _meta) = spawn_long_lived(
                &handle,
                map.clone(),
                SpawnOpts {
                    bin: bin.clone(),
                    cwd: cwd.to_string_lossy().to_string(),
                    resume: None,
                    model: None,
                    thinking: None,
                    approval: None,
                },
            )
            .await
            .expect("握手失败");
            // 前端订阅的是**真实 sid** 的通道（拿到 sid 之后才订阅）
            let (evt_tx, mut evt_rx) = tokio::sync::mpsc::unbounded_channel::<serde_json::Value>();
            handle.listen(format!("omp-event://{sid}").as_str(), move |e| {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(e.payload()) {
                    let _ = evt_tx.send(v);
                }
            });

            // 第一轮：真实 prompt，等 message_end 回写 + agent_end 收敛
            let tx = map.lock().await.get(&sid).unwrap().tx.clone();
            tx.send("{\"id\":\"p-rc1\",\"type\":\"prompt\",\"message\":\"Reply with exactly: ok\"}\n".to_string())
                .unwrap();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            let mut first_frame = false;
            loop {
                assert!(std::time::Instant::now() < deadline, "第一轮 120s 没有等到 idle");
                while let Ok(v) = evt_rx.try_recv() {
                    if v.get("type").and_then(|t| t.as_str()) == Some("message_end") {
                        first_frame = true;
                    }
                }
                let (idle, used) = {
                    let m = map.lock().await;
                    let r = m.get(&sid);
                    (
                        r.map(|r| r.activity.state() == ACT_IDLE).unwrap_or(false),
                        r.map(|r| r.meta.usage.is_some()).unwrap_or(false),
                    )
                };
                if idle && used && first_frame {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            assert!(first_frame, "按生产时序（订阅真实 sid 通道）没有收到第一轮 message_end");

            // 等 jsonl 落盘：omp 懒写盘（首个 turn 之后才写文件，且有节流延迟），
            // 自动恢复靠它找文件。reaper 也有同样的 file 检查——没落盘的会话本就不会被回收。
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
            while !std::path::Path::new(&sfile).exists() && std::time::Instant::now() < deadline {
                tokio::time::sleep(std::time::Duration::from_millis(300)).await;
            }
            assert!(std::path::Path::new(&sfile).exists(), "60s 内 jsonl 没有落盘：{sfile}");

            // 模拟闲置回收：与 reaper 同一入口 kill（只在 idle 时回收）
            crate::commands::kill_runtime(&st, &sid);
            assert!(map.lock().await.get(&sid).is_none(), "回收后进程应从表里移除");

            // 清掉第一轮残留帧，避免第二轮把旧帧误判成新帧
            while evt_rx.try_recv().is_ok() {}

            // 用户直接发消息：应自动 resume 并成功（不是报 NOT_RUNNING）
            crate::commands::send_prompt(&handle, &st, &sid, "prompt", "Reply with exactly: ok".into(), None)
                .await
                .expect("回收后发送应自动恢复，不该失败");
            assert!(map.lock().await.get(&sid).is_some(), "发送后应自动 resume 出新进程");

            // 第二轮事件流照常（新一轮 message_end；resume 新进程启动时的握手回放帧
            // 也应到达——订阅在本轮 spawn 之前就已建立，这是「回放必达」的可确定时序）
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(120);
            let mut second = false;
            let mut replay = false;
            while std::time::Instant::now() < deadline {
                while let Ok(v) = evt_rx.try_recv() {
                    match v.get("type").and_then(|t| t.as_str()) {
                        Some("message_end") => second = true,
                        Some("available_commands_update") => replay = true,
                        _ => {}
                    }
                }
                if second && replay {
                    break;
                }
                tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            }
            assert!(second, "恢复后 120s 内没有等到新一轮 message_end");
            assert!(replay, "resume 进程的握手回放帧没有到达 sid 通道");

            kill_all(&map);
        });
        let _ = std::fs::remove_dir_all(&cwd);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64encode_roundtrip() {
        // 与解码器互为逆运算（含 padding 的三种长度）
        for raw in [b"".as_slice(), b"a", b"ab", b"abc", b"\x00\xff\x10\x20"] {
            let enc = b64encode(raw);
            assert_eq!(b64decode(&enc).unwrap(), raw.to_vec(), "roundtrip 失败: {enc}");
        }
        assert_eq!(b64encode(b"hello world"), "aGVsbG8gd29ybGQ=");
        assert_eq!(b64encode(&[0xff, 0xd8, 0xff]), "/9j/");
    }

    #[test]
    fn chunk_reassemble_roundtrip() {
        // "hello world" 的 base64 切两片
        let full = serde_json::json!({"type":"response","id":"x"});
        let raw = serde_json::to_string(&full).unwrap();
        let b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        // 简单用自带编码
        let enc = {
            let bytes = raw.as_bytes();
            let mut s = String::new();
            let mut i = 0;
            while i < bytes.len() {
                let b0 = bytes[i] as u32;
                let b1 = *bytes.get(i + 1).unwrap_or(&0) as u32;
                let b2 = *bytes.get(i + 2).unwrap_or(&0) as u32;
                let n = (b0 << 16) | (b1 << 8) | b2;
                s.push(b64chars.chars().nth(((n >> 18) & 63) as usize).unwrap());
                s.push(b64chars.chars().nth(((n >> 12) & 63) as usize).unwrap());
                s.push(if i + 1 < bytes.len() { b64chars.chars().nth(((n >> 6) & 63) as usize).unwrap() } else { '=' });
                s.push(if i + 2 < bytes.len() { b64chars.chars().nth((n & 63) as usize).unwrap() } else { '=' });
                i += 3;
            }
            s
        };
        let mid = enc.len() / 2;
        let mut asm = ChunkAsm::default();
        assert!(asm.feed(&serde_json::json!({"type":"rpc_chunk","chunkId":"c1","index":1,"count":2,"byteLength":enc.len(),"data":&enc[mid..]})).is_none());
        // 乱序第二片先到：上面先喂了 index1，再喂 index0 应完成
        let done = asm.feed(&serde_json::json!({"type":"rpc_chunk","chunkId":"c1","index":0,"count":2,"byteLength":enc.len(),"data":&enc[..mid]}));
        assert!(done.is_some());
        assert_eq!(done.unwrap(), full);
    }

    #[test]
    fn b64decode_works() {
        assert_eq!(b64decode("aGk=").unwrap(), b"hi");
    }

    fn opus() -> serde_json::Value {
        serde_json::json!({
            "provider": "commandcode",
            "id": "claude-opus-5",
            "name": "Claude Opus 5",
            "thinking": { "mode": "anthropic-adaptive", "efforts": ["low","medium","high","xhigh","max"], "supportsDisplay": true }
        })
    }

    /// 状态条数据源：上下文占用来自 get_state，用量/毫秒耗时来自 message_end（结构照抄真实会话 jsonl）。
    #[test]
    fn usage_and_context_parsed_from_frames() {
        let d = serde_json::json!({
            "model": opus(),
            "thinkingLevel": "high",
            // percent 是 0–100 的百分比（真机 18.2.1 实测 28529/1000000 → 2.8529）
            "contextUsage": { "tokens": 22678, "contextWindow": 1000000, "percent": 2.2678 }
        });
        let m = SessionMeta::from_state(&d);
        let cu = m.context_usage.as_ref().expect("contextUsage 应被解析");
        assert_eq!(cu.tokens, Some(22678));
        assert_eq!(cu.context_window, Some(1000000));
        assert!((cu.percent.unwrap_or_default() - 2.2678).abs() < 1e-9);

        let msg = serde_json::json!({
            "role": "assistant",
            "usage": {
                "input": 232, "output": 302, "totalTokens": 22678,
                "cacheRead": 22144, "reasoningTokens": 181,
                "cost": { "input": 0.0000348, "output": 0.00018, "total": 0.00028 }
            },
            "duration": 2843.68,
            "ttft": 855.7
        });
        let (usage, dur, ttft) = SessionMeta::usage_from_message_end(&msg).expect("assistant 消息应被提取");
        let usage = usage.expect("usage 应被解析");
        assert_eq!(usage.total_tokens, Some(22678));
        assert_eq!(usage.cache_read, Some(22144));
        assert_eq!(usage.reasoning_tokens, Some(181));
        assert!(usage.cost_total.unwrap_or_default() > 0.0);
        assert_eq!(dur, Some(2843.68));
        assert_eq!(ttft, Some(855.7));

        // 只有 assistant 消息带用量语义；toolResult / 无字段的用户消息不提取
        assert!(SessionMeta::usage_from_message_end(&serde_json::json!({"role": "toolResult", "usage": {"input": 1}})).is_none());
        assert!(SessionMeta::usage_from_message_end(&serde_json::json!({"role": "assistant", "content": []})).is_none());
    }

    #[test]
    fn efforts_of_reads_both_shapes() {
        assert_eq!(efforts_of(&opus()).unwrap(), vec!["low", "medium", "high", "xhigh", "max"]);
        // 数组形态（防上游结构漂移）
        assert_eq!(efforts_of(&serde_json::json!({"thinking": ["high","max"]})).unwrap(), vec!["high", "max"]);
        // 无思考模型（实测 claude-haiku-4-5 无 thinking 键）
        assert!(efforts_of(&serde_json::json!({"id": "claude-haiku-4-5-20251001", "reasoning": false})).is_none());
        assert!(efforts_of(&serde_json::json!({"thinking": {"efforts": []}})).is_none());
    }

    #[test]
    fn highest_effort_uses_strength_order() {
        let e = |v: Vec<&str>| v.into_iter().map(str::to_string).collect::<Vec<_>>();
        assert_eq!(highest_effort(Some(&e(vec!["low", "medium", "high", "xhigh", "max"]))), "max");
        assert_eq!(highest_effort(Some(&e(vec!["low", "high", "max"]))), "max");
        assert_eq!(highest_effort(Some(&e(vec!["low", "medium", "high"]))), "high");
        // 不信任数组顺序，按强度序取最大
        assert_eq!(highest_effort(Some(&e(vec!["max", "low"]))), "max");
        assert_eq!(highest_effort(Some(&e(vec!["minimal", "low", "medium", "high", "xhigh"]))), "xhigh");
        // 未知档忽略；无可用档 = off（无思考模型）
        assert_eq!(highest_effort(Some(&e(vec!["low", "bogus"]))), "low");
        assert_eq!(highest_effort(Some(&e(vec!["bogus"]))), "off");
        assert_eq!(highest_effort(None), "off");
    }

    #[test]
    fn session_meta_from_state_and_model() {
        let state = serde_json::json!({ "model": opus(), "thinkingLevel": "xhigh", "sessionId": "s1" });
        let m = SessionMeta::from_state(&state);
        assert_eq!(m.model.as_ref().unwrap().id, "claude-opus-5");
        assert_eq!(m.model.as_ref().unwrap().provider, "commandcode");
        assert_eq!(m.efforts.as_ref().unwrap().len(), 5);
        assert_eq!(m.thinking_level.as_deref(), Some("xhigh"));

        // 无思考模型：档位键缺失（实测），efforts 为 None
        let haiku_state = serde_json::json!({ "model": {"provider":"commandcode","id":"claude-haiku-4-5-20251001"} });
        let h = SessionMeta::from_state(&haiku_state);
        assert!(h.efforts.is_none());
        assert!(h.thinking_level.is_none());
        assert_eq!(h.model.as_ref().unwrap().id, "claude-haiku-4-5-20251001");

        // set_model 回包：data 即模型对象本身，档位留空等回读
        let f = SessionMeta::from_model(&opus());
        assert_eq!(f.model.as_ref().unwrap().id, "claude-opus-5");
        assert_eq!(f.efforts.as_ref().unwrap().last().unwrap(), "max");
        assert!(f.thinking_level.is_none());

        // 无 id 的畸形 data 不产出模型
        assert!(SessionMeta::from_state(&serde_json::json!({"model": {"provider": "x"}})).model.is_none());
    }

    #[test]
    fn jsonl_line_shapes() {
        let line = jsonl_line("auto-think", "set_thinking_level", serde_json::json!({"level": "max"})).unwrap();
        assert!(line.ends_with('\n'));
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["type"], "set_thinking_level");
        assert_eq!(v["level"], "max");
        assert_eq!(v["id"], "auto-think");
        let g = jsonl_line(STATE_SYNC_ID, "get_state", serde_json::Value::Null).unwrap();
        assert_eq!(g.trim(), r#"{"id":"sync-state","type":"get_state"}"#);
    }

    fn injected(action: FrameAction) -> Option<String> {
        match action {
            FrameAction::Forward(x) => x,
            FrameAction::StateSync => panic!("不应分类为状态回读"),
            FrameAction::Swallow => panic!("不应分类为本地消化"),
        }
    }

    #[test]
    fn classify_set_model_success_switches_to_highest_effort() {
        // 切模型成功 → 自动重设该模型最高档（此处 max）
        let frame = serde_json::json!({
            "id": "m-1", "type": "response", "command": "set_model", "success": true, "data": opus()
        });
        let line = injected(classify(&frame)).unwrap();
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["type"], "set_thinking_level");
        assert_eq!(v["level"], "max");

        // 无思考模型 → 归一到 off
        let haiku = serde_json::json!({
            "id": "m-2", "type": "response", "command": "set_model", "success": true,
            "data": {"provider": "commandcode", "id": "claude-haiku-4-5-20251001", "reasoning": false}
        });
        let v2: serde_json::Value =
            serde_json::from_str(injected(classify(&haiku)).unwrap().trim()).unwrap();
        assert_eq!(v2["level"], "off");
    }

    #[test]
    fn classify_set_model_failure_reads_back_state() {
        // 失败（如 Model not found）：不碰档位，但回读真值纠正前端乐观态
        let frame = serde_json::json!({
            "id": "m-3", "type": "response", "command": "set_model", "success": false, "error": "Model not found"
        });
        let v: serde_json::Value =
            serde_json::from_str(injected(classify(&frame)).unwrap().trim()).unwrap();
        assert_eq!(v["id"], STATE_SYNC_ID);
        assert_eq!(v["type"], "get_state");
    }

    #[test]
    fn classify_set_thinking_reads_back_state() {
        let frame = serde_json::json!({
            "id": "t-1", "type": "response", "command": "set_thinking_level", "success": true
        });
        let v: serde_json::Value =
            serde_json::from_str(injected(classify(&frame)).unwrap().trim()).unwrap();
        assert_eq!(v["type"], "get_state");
    }

    #[test]
    fn classify_passthrough_and_state_sync() {
        // 普通事件：透传、不注入
        assert_eq!(classify(&serde_json::json!({"type": "agent_start"})), FrameAction::Forward(None));
        assert_eq!(classify(&serde_json::json!({"type": "prompt_result"})), FrameAction::Forward(None));
        // prompt 回包不触发回读
        let p = serde_json::json!({"id": "p-1", "type": "response", "command": "prompt", "success": true});
        assert_eq!(classify(&p), FrameAction::Forward(None));
    }

    #[test]
    fn classify_swallows_subagent_subscription() {
        // 壳侧自己发的订阅命令：成功与失败（旧版 omp 不认）都在本地消化，不进前端
        let ok = serde_json::json!({
            "id": "h-sub", "type": "response", "command": "set_subagent_subscription", "success": true,
            "data": {"level": "progress"}
        });
        assert_eq!(classify(&ok), FrameAction::Swallow);
        let fail = serde_json::json!({
            "id": "h-sub", "type": "response", "command": "set_subagent_subscription", "success": false,
            "error": "Unknown command"
        });
        assert_eq!(classify(&fail), FrameAction::Swallow);
    }

    #[test]
    fn spawn_args_use_rpc_ui_mode() {
        // rpc-ui（hasUI=true）而非 rpc：多挂 ask 工具，见 docs/rpc-memo.md §1
        let opts = SpawnOpts {
            bin: "omp".into(),
            cwd: "/tmp/x".into(),
            resume: None,
            model: None,
            thinking: None,
            approval: None,
        };
        let a = opts.args();
        assert_eq!(&a[0], "--mode");
        assert_eq!(&a[1], "rpc-ui");
        assert_eq!(&a[2], "--cwd");
        assert_eq!(&a[3], "/tmp/x");
    }

    #[test]
    fn local_prompt_result_detected() {
        // 本地收尾（agentInvoked:false）→ 收敛 idle
        let local = serde_json::json!({"id": "p-2", "type": "response", "command": "prompt", "success": true, "data": {"agentInvoked": false}});
        assert!(is_local_prompt_result(&local));
        // 真正开跑（true / 缺字段）→ 不收敛，等 agent_end
        let started = serde_json::json!({"id": "p-3", "type": "response", "command": "prompt", "success": true, "data": {"agentInvoked": true}});
        assert!(!is_local_prompt_result(&started));
        let legacy = serde_json::json!({"id": "p-4", "type": "response", "command": "prompt", "success": true});
        assert!(!is_local_prompt_result(&legacy));
        // 失败回包不收敛
        let failed = serde_json::json!({"id": "p-5", "type": "response", "command": "prompt", "success": false, "data": {"agentInvoked": false}});
        assert!(!is_local_prompt_result(&failed));
        // 状态回读回包：自己消化，不回环（get_state 不再触发注入）
        let s = serde_json::json!({"id": STATE_SYNC_ID, "type": "response", "command": "get_state", "success": true});
        assert_eq!(classify(&s), FrameAction::StateSync);
    }

    // ---------- V34 闲置回收 ----------

    #[test]
    fn session_activity_tracks_state_and_freshness() {
        let act = SessionActivity::new();
        assert_eq!(act.state(), ACT_IDLE, "spawn 起手是 idle");
        act.set_state(ACT_RUNNING);
        assert_eq!(act.state(), ACT_RUNNING);
        // touch 刷新活动时刻（回收计时的依据）
        act.last_active_ms.store(0, Ordering::Relaxed);
        act.touch();
        assert!(act.last_active_ms() > 0);
    }

    #[test]
    fn idle_recyclable_only_for_stale_idle() {
        let act = SessionActivity::new();
        let now = 10_000_000i64;
        let idle = 60_000i64;
        // idle 且超阈值 → 可回收（边界上等于阈值也算）
        act.last_active_ms.store(now - idle, Ordering::Relaxed);
        assert!(idle_recyclable(&act, now, idle));
        // 刚有帧 → 不可回收
        act.last_active_ms.store(now - idle + 1, Ordering::Relaxed);
        assert!(!idle_recyclable(&act, now, idle));
        // 非 idle（跑着 / 等审批 / 异常退出）一律不回收——哪怕很久没帧
        for st in [ACT_RUNNING, ACT_AWAITING, ACT_EXITED] {
            act.set_state(st);
            act.last_active_ms.store(0, Ordering::Relaxed);
            assert!(!idle_recyclable(&act, now, idle), "state={st} 不该被回收");
        }
    }
}
