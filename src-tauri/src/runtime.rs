//! M2 实时运行时：per-会话长驻 `omp --mode rpc` 子进程。
//!
//! 线路：spawn → 等 ready → negotiate v2 → get_state（拿身份）→
//! 后台读 stdout 行 → rpc_chunk 重组 → 按 type 分发 emit 事件。

use std::{collections::HashMap, sync::Arc};
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
        let mut a = vec!["--mode".into(), "rpc".into(), "--cwd".into(), self.cwd.clone()];
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

pub struct RunningChild {
    pub tx: mpsc::UnboundedSender<String>,
    pub child: Child,
    pub session_file: String,
    pub session_id: String,
    /// 运行时真值快照（模型 / 可用思考档 / 当前档），供打开会话时回填。
    pub meta: SessionMeta,
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
    /// omp 给的是 0–1 比例；前端展示时统一换算成百分比。
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
            // 用量 / 耗时来自 message_end，回读时保留旧值（见 handle_frame 的 StateSync 分支）
            usage: None,
            duration_ms: None,
            ttft_ms: None,
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

/// spawn 长驻进程并完成后握手。成功返回 (session_id, session_file, 运行时真值)。
/// 调用方负责把 RunningChild 放入 RuntimeMap 并启动 pump。
pub async fn spawn_long_lived(
    app: &AppHandle,
    map: RuntimeMap,
    key: String,
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
        if v.get("type").and_then(|t| t.as_str()) == Some("response")
            && v.get("id").and_then(|i| i.as_str()) == Some("h-state")
        {
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
        }
    };

    // 启动后台 pump：stdin 写 + stdout 读分发
    let stdin = stdin_opt.take().unwrap();
    start_pump(app.clone(), key.clone(), reader, stdin, rx, sid.clone());

    let mut m = map.lock().await;
    // 旧进程先杀
    if let Some(old) = m.remove(&key) {
        let _ = old.tx.send(String::new());
        let mut c = old.child;
        let _ = c.kill().await;
    }
    // pump 里持有 child？此处需要把 child 放回 map。简化：pump 自己 spawn？
    // 为保持实现简单：map 存 tx + “已启动”标记，child 所有权移交 pump 任务。
    // 这里用一个已退出的占位 child 无法表达——改为 map 只存 tx，kill 走 tx 哨兵。
    m.insert(
        key,
        RunningChild { tx, child, session_file: sfile.clone(), session_id: sid.clone(), meta: meta.clone() },
    );
    Ok((sid, sfile, meta))
}

fn start_pump(
    app: AppHandle,
    key: String,
    mut reader: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    mut stdin: ChildStdin,
    mut rx: mpsc::UnboundedReceiver<String>,
    worker_sid: String,
) {
    let evt = format!("omp-event://{key}");
    let status = format!("omp-status://{key}");
    let _ = worker_sid;
    tauri::async_runtime::spawn(async move {
        let mut asm = ChunkAsm::default();
        let mut pending: std::collections::VecDeque<String> = Default::default();
        // 状态：idle 起
        let _ = app.emit(&status, serde_json::json!({"state":"idle"}));
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
                            let _ = app.emit(&status, serde_json::json!({"state":"error","detail":format!("写入失败：{e}")}));
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
                            handle_frame(&app, &key, &evt, &status, &full, &mut stdin).await;
                        }
                        _ => {
                            let _ = app.emit(&status, serde_json::json!({"state":"exited","detail":"omp 进程已退出"}));
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
fn update_meta(app: &AppHandle, key: &str, f: impl FnOnce(&mut SessionMeta)) {
    let map = app.state::<crate::commands::AppState>().runtime.clone();
    let guard = map.try_lock();
    if let Ok(mut m) = guard {
        if let Some(r) = m.get_mut(key) {
            f(&mut r.meta);
        }
    }
}

/// 帧分类结果：状态回读 / 普通透传（附可选跟进命令）。
#[derive(Debug, PartialEq)]
pub enum FrameAction {
    /// 状态回读回包：只更新真值快照 + 推送 `omp-state`，不进会话流
    StateSync,
    /// 透传给前端；`Some(line)` 表示还要追加写回 stdin 的跟进命令
    Forward(Option<String>),
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
async fn handle_frame(
    app: &AppHandle,
    key: &str,
    evt: &str,
    status: &str,
    v: &serde_json::Value,
    stdin: &mut ChildStdin,
) {
    if v.get("type").and_then(|t| t.as_str()) == Some("response") {
        match classify(v) {
            FrameAction::StateSync => {
                if v.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
                    let d = v.get("data").cloned().unwrap_or_default();
                    let mut meta = SessionMeta::from_state(&d);
                    update_meta(app, key, |m| {
                        // 用量 / 耗时来自 message_end 而不是 get_state：回读时不能把它们抹掉
                        meta.usage = m.usage.clone();
                        meta.duration_ms = m.duration_ms;
                        meta.ttft_ms = m.ttft_ms;
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
    dispatch(app, evt, status, v);
}

fn dispatch(app: &AppHandle, evt: &str, status: &str, v: &serde_json::Value) {
    let t = v.get("type").and_then(|x| x.as_str()).unwrap_or("");
    match t {
        "agent_start" => {
            let _ = app.emit(status, serde_json::json!({"state":"running"}));
        }
        "agent_end" => {
            let terminal = v.get("isTerminal").and_then(|b| b.as_bool()).unwrap_or(true);
            if terminal {
                let _ = app.emit(status, serde_json::json!({"state":"idle"}));
            }
        }
        "extension_ui_request" => {
            let method = v.get("method").and_then(|m| m.as_str()).unwrap_or("");
            if method == "select" || method == "confirm" {
                let _ = app.emit(status, serde_json::json!({"state":"awaiting-approval"}));
            }
            let _ = app.emit(evt, v);
        }
        "response" | "message_start" | "message_update" | "message_end" | "turn_start" | "turn_end"
        | "tool_execution_start" | "tool_execution_update" | "tool_execution_end" | "model_changed"
        | "thinking_level_changed" | "available_commands_update" => {
            let _ = app.emit(evt, v);
        }
        _ => {
            // 未知帧：透传 unknown 进日志不崩（前端忽略）
            let _ = app.emit(evt, v);
        }
    }
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

#[cfg(test)]
mod tests {
    use super::*;

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
            "contextUsage": { "tokens": 22678, "contextWindow": 1000000, "percent": 0.023 }
        });
        let m = SessionMeta::from_state(&d);
        let cu = m.context_usage.as_ref().expect("contextUsage 应被解析");
        assert_eq!(cu.tokens, Some(22678));
        assert_eq!(cu.context_window, Some(1000000));
        assert!((cu.percent.unwrap_or_default() - 0.023).abs() < 1e-9);

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
        // 状态回读回包：自己消化，不回环（get_state 不再触发注入）
        let s = serde_json::json!({"id": STATE_SYNC_ID, "type": "response", "command": "get_state", "success": true});
        assert_eq!(classify(&s), FrameAction::StateSync);
    }
}
