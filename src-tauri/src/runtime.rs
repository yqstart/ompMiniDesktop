//! M2 实时运行时：per-会话长驻 `omp --mode rpc` 子进程。
//!
//! 线路：spawn → 等 ready → negotiate v2 → get_state（拿身份）→
//! 后台读 stdout 行 → rpc_chunk 重组 → 按 type 分发 emit 事件。

use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;
use tauri::{AppHandle, Emitter};
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
}

pub type RuntimeMap = Arc<Mutex<HashMap<String, RunningChild>>>;

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

/// spawn 长驻进程并完成后握手。成功返回 (session_id, session_file)。
/// 调用方负责把 RunningChild 放入 RuntimeMap 并启动 pump。
pub async fn spawn_long_lived(
    app: &AppHandle,
    map: RuntimeMap,
    key: String,
    opts: SpawnOpts,
) -> Result<(String, String), crate::commands::CmdError> {
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
    let (mut sid, mut sfile) = (None, None);
    loop {
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
            sid = d.get("sessionId").and_then(|s| s.as_str()).map(|s| s.to_string());
            sfile = d.get("sessionFile").and_then(|s| s.as_str()).map(|s| s.to_string());
            break;
        }
    }
    let (sid, sfile) = match (sid, sfile) {
        (Some(a), Some(b)) => (a, b),
        _ => return Err(cmd_err("RPC_STATE", "未拿到会话身份".into(), None)),
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
        RunningChild { tx, child, session_file: sfile.clone(), session_id: sid.clone() },
    );
    Ok((sid, sfile))
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
                            if v.get("type").and_then(|t| t.as_str()) == Some("rpc_chunk") {
                                if let Some(full) = asm.feed(&v) {
                                    dispatch(&app, &evt, &status, &full);
                                }
                                continue;
                            }
                            dispatch(&app, &evt, &status, &v);
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
}
