use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// agentDir 解析优先级：PI_CODING_AGENT_DIR > `omp config path` 末行 > ~/.omp/agent
pub fn resolve_agent_dir(config_path_out: Option<String>) -> PathBuf {
    if let Ok(v) = std::env::var("PI_CODING_AGENT_DIR") {
        let v = v.trim().to_string();
        if !v.is_empty() {
            return PathBuf::from(v);
        }
    }
    if let Some(out) = config_path_out {
        if let Some(last) = out.lines().map(str::trim).filter(|l| !l.is_empty()).last() {
            let p = PathBuf::from(last);
            if p.is_absolute() {
                return p;
            }
        }
    }
    dirs_home().join(".omp").join("agent")
}

fn dirs_home() -> PathBuf {
    std::env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/tmp"))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionHead {
    pub id: String,
    pub cwd: String,
    pub timestamp: i64,
    pub title: String,
    pub file: String,
    pub corrupt: bool,
}

/// 只读文件头部取 session 行；失败标 corrupt。
/// 文件格式：每行一个 JSON，含 `{"type":"session",...}`。
///
/// 列表扫描要遍历 sessions 下所有 jsonl，**不能整个读进内存**（真实环境单文件可达几十 MB），
/// 所以小文件一次读完、大文件只读「头 64KB + 尾 64KB」两段：
/// 头段拿 `session` / `title` 行，尾段拿最后一个 `title_change`（标题以最新一次为准）。
/// 两段各自跳过被切断的残行，避免半行 JSON 干扰解析。
pub fn parse_session_head(path: &std::path::Path) -> SessionHead {
    const CHUNK: usize = 64 * 1024;
    let fallback = SessionHead {
        id: path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string(),
        cwd: String::new(),
        timestamp: 0,
        title: String::new(),
        file: path.to_string_lossy().to_string(),
        corrupt: true,
    };
    let Ok(meta) = std::fs::metadata(path) else { return fallback };
    let size = meta.len() as usize;
    if size == 0 {
        return fallback;
    }
    let is_small = size <= CHUNK * 2;

    let mut tail_lines: Vec<String> = vec![];
    let head_text: String = if is_small {
        match std::fs::read_to_string(path) {
            Ok(t) => t,
            Err(_) => return fallback,
        }
    } else {
        use std::io::{Read, Seek, SeekFrom};
        let Ok(mut f) = std::fs::File::open(path) else { return fallback };
        let mut head = vec![0u8; CHUNK];
        if f.read_exact(&mut head).is_err() {
            return fallback;
        }
        // 尾段往前多读 1 字节：用于判断首行是不是完整行（前一个字节是否换行）
        if f.seek(SeekFrom::Start((size - CHUNK - 1) as u64)).is_err() {
            return fallback;
        }
        let mut tail = vec![0u8; CHUNK + 1];
        if f.read_exact(&mut tail).is_err() {
            return fallback;
        }
        let tail_s = String::from_utf8_lossy(&tail).to_string();
        tail_lines = split_complete_tail(&tail_s).into_iter().map(str::to_string).collect();
        String::from_utf8_lossy(&head).to_string()
    };

    // 头段：大文件时最后一行可能被窗口切断，丢掉；小文件整段都是完整行
    let head_lines: Vec<&str> = if is_small {
        head_text.split('\n').filter(|l| !l.trim().is_empty()).collect()
    } else {
        split_complete_head(&head_text)
    };

    let mut title = String::new();
    let mut last_title_change: Option<String> = None;
    let mut session: Option<serde_json::Value> = None;
    for line in &head_lines {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("session") => session = Some(v),
            Some("title") => {
                if let Some(t) = v.get("title").and_then(|t| t.as_str()) {
                    if title.is_empty() {
                        title = t.to_string();
                    }
                }
            }
            Some("title_change") => {
                if let Some(t) = v.get("title").and_then(|t| t.as_str()) {
                    last_title_change = Some(t.to_string());
                }
            }
            _ => {}
        }
    }
    // 大文件的 title_change 在尾段（标题以最新一次为准，会覆盖头段看到的旧值）
    for line in &tail_lines {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        if v.get("type").and_then(|t| t.as_str()) == Some("title_change") {
            if let Some(t) = v.get("title").and_then(|t| t.as_str()) {
                last_title_change = Some(t.to_string());
            }
        }
    }

    let Some(s) = session else { return fallback };
    title = last_title_change.unwrap_or(title);
    if title.is_empty() {
        title = s.get("title").and_then(|t| t.as_str()).unwrap_or("").to_string();
    }
    SessionHead {
        id: s.get("id").and_then(|v| v.as_str()).unwrap_or(&fallback.id).to_string(),
        cwd: s.get("cwd").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        timestamp: s.get("timestamp").and_then(|v| v.as_str()).and_then(parse_ts).unwrap_or(0),
        title,
        file: path.to_string_lossy().to_string(),
        corrupt: false,
    }
}

/// 头段取完整行：文件不以换行结尾时，最后一行是被窗口切断的残行，丢掉。
fn split_complete_head(text: &str) -> Vec<&str> {
    let mut v: Vec<&str> = text.split('\n').collect();
    if !text.ends_with('\n') {
        v.pop();
    }
    v.into_iter().filter(|l| !l.trim().is_empty()).collect()
}

/// 尾段取完整行：窗口起点落在行中间时（前一个字节不是换行），首行是残行，丢掉。
fn split_complete_tail(text: &str) -> Vec<&str> {
    let mut v: Vec<&str> = text.split('\n').collect();
    if !text.starts_with('\n') && v.len() > 1 {
        v.remove(0);
    }
    v.into_iter().filter(|l| !l.trim().is_empty()).collect()
}

fn parse_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).ok()
}

/// cwd 归组：按真实路径前缀匹配，不猜 slug。
/// 归一化：去首尾空白与末尾 `/`；macOS 上 `/tmp` 常为 `/private/tmp` 符号链接，
/// 两边统一展开后再比，避免“同目录不同写法”导致会话掉进未归属。
pub fn project_of(cwd: &str, projects: &[String]) -> Option<String> {
    if cwd.is_empty() {
        return None;
    }
    let norm = |p: &str| {
        let mut s = p.trim().to_string();
        while s.len() > 1 && s.ends_with('/') {
            s.pop();
        }
        // /tmp -> /private/tmp（macOS 符号链接），失败则保留原文
        if s == "/tmp" || s.starts_with("/tmp/") {
            if let Ok(canon) = std::fs::canonicalize(&s) {
                return canon.to_string_lossy().to_string();
            }
            return s.replacen("/tmp", "/private/tmp", 1);
        }
        // 项目侧也做一次 canonicalize（目录真实存在时），消掉一切符号链接差异
        if let Ok(canon) = std::fs::canonicalize(&s) {
            return canon.to_string_lossy().to_string();
        }
        s
    };
    let cwd = norm(cwd);
    let mut best: Option<(usize, String)> = None;
    for p in projects {
        let np = norm(p);
        let hit = cwd == np || cwd.starts_with(&format!("{np}/"));
        if hit && best.as_ref().map(|b| np.len() > b.0).unwrap_or(true) {
            best = Some((np.len(), p.clone()));
        }
    }
    best.map(|b| b.1)
}

// ---------------------------------------------------------------------------
// 会话内容搜索（V2 M7b）
// ---------------------------------------------------------------------------

/// 命中片段：`("…上下文…含命中词…", 命中次数)`；`needle_lower` 必须已小写。
/// 片段按**字符**（不是字节）切，保证中文/emoji 不被截断；换行折成空格，便于单行展示。
pub fn snippet_around(text: &str, needle_lower: &str, radius: usize) -> Option<(String, usize)> {
    if needle_lower.is_empty() {
        return None;
    }
    let lower = text.to_lowercase();
    let first = lower.find(needle_lower)?;
    let hits = lower.matches(needle_lower).count();
    // 以字符为单位取命中点前后的上下文
    let prefix_chars = lower[..first].chars().count();
    let needle_chars = needle_lower.chars().count();
    let chars: Vec<char> = text.chars().collect();
    let start = prefix_chars.saturating_sub(radius);
    let end = (prefix_chars + needle_chars + radius).min(chars.len());
    let mut snip: String = chars[start..end].iter().collect();
    snip = snip.replace(['\n', '\r', '\t'], " ");
    if start > 0 {
        snip.insert(0, '…');
    }
    if end < chars.len() {
        snip.push('…');
    }
    Some((snip, hits))
}

/// 扫单个 jsonl 文件：返回（首个命中片段, 命中次数, 实际读取字节数）。
/// `max_bytes` 是本文件允许读取的上限（全局预算已由调用方按剩余量传入）；
/// 逐行读取，超预算即停——最多超出一行的长度（读完一行才判断）。
pub fn search_one_file(
    path: &std::path::Path,
    needle_lower: &str,
    max_bytes: u64,
) -> (Option<String>, usize, u64) {
    let Ok(file) = std::fs::File::open(path) else { return (None, 0, 0) };
    let mut reader = std::io::BufReader::new(file);
    let mut line = String::new();
    let mut read = 0u64;
    let mut count = 0usize;
    let mut first: Option<String> = None;
    loop {
        line.clear();
        let Ok(n) = std::io::BufRead::read_line(&mut reader, &mut line) else { break };
        if n == 0 {
            break;
        }
        read += n as u64;
        if read > max_bytes {
            break;
        }
        let Some(text) = searchable_text(&line) else { continue };
        if let Some((snip, c)) = snippet_around(&text, needle_lower, 60) {
            count += c;
            if first.is_none() {
                first = Some(snip);
            }
        }
    }
    (first, count, read)
}

/// 一行 jsonl 里**可搜索的正文**：只管 user / assistant 的 text 块。
/// 工具输出、thinking、JSON 字段名都不进搜索面——否则搜 "user" 会命中每一行。
pub fn searchable_text(line: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("message") {
        return None;
    }
    let m = v.get("message")?;
    let role = m.get("role").and_then(|r| r.as_str())?;
    if role != "user" && role != "assistant" {
        return None;
    }
    let mut out = String::new();
    for b in m.get("content")?.as_array()? {
        if b.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                if !out.is_empty() {
                    out.push('\n');
                }
                out.push_str(t);
            }
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn group_by_cwd_prefix_longest_wins() {
        let ps = vec!["/a".to_string(), "/a/b".to_string()];
        assert_eq!(project_of("/a/b/c", &ps).as_deref(), Some("/a/b"));
        assert_eq!(project_of("/a/other", &ps).as_deref(), Some("/a"));
        assert_eq!(project_of("/x", &ps), None);
    }

    #[test]
    fn agent_dir_env_wins() {
        std::env::set_var("PI_CODING_AGENT_DIR", "/tmp/xyz-agent");
        assert_eq!(resolve_agent_dir(Some("/nope".into())), PathBuf::from("/tmp/xyz-agent"));
        std::env::remove_var("PI_CODING_AGENT_DIR");
    }

    // ---------- 会话头解析（M1-1 要求覆盖：正常 / 缺 title / 损坏 / 超大） ----------

    fn tmp_file(name: &str, content: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("omp-scan-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join(name);
        std::fs::write(&p, content).unwrap();
        p
    }

    #[test]
    fn parse_head_normal_takes_latest_title_change() {
        let p = tmp_file(
            "normal.jsonl",
            concat!(
                "{\"type\":\"title\",\"title\":\"初始标题\"}\n",
                "{\"type\":\"session\",\"id\":\"abc-123\",\"timestamp\":\"2026-09-15T10:00:00.000Z\",\"cwd\":\"/tmp/proj\",\"title\":\"会话标题\"}\n",
                "{\"type\":\"message\",\"message\":{\"role\":\"user\",\"content\":[]}}\n",
                "{\"type\":\"title_change\",\"title\":\"改过一次\"}\n",
                "{\"type\":\"title_change\",\"title\":\"最新标题\"}\n",
            ),
        );
        let h = parse_session_head(&p);
        assert!(!h.corrupt);
        assert_eq!(h.id, "abc-123");
        assert_eq!(h.cwd, "/tmp/proj");
        assert_eq!(h.title, "最新标题");
        assert!(h.timestamp > 0, "timestamp 应被解析成毫秒");
    }

    #[test]
    fn parse_head_missing_title_yields_empty() {
        let p = tmp_file(
            "notitle.jsonl",
            "{\"type\":\"session\",\"id\":\"x1\",\"timestamp\":\"2026-09-15T10:00:00.000Z\",\"cwd\":\"/tmp/a\"}\n",
        );
        let h = parse_session_head(&p);
        assert!(!h.corrupt);
        // 空标题交给 display_title 兜「未命名 + 日期」，解析层不编造
        assert_eq!(h.title, "");
    }

    #[test]
    fn parse_head_corrupt_cases() {
        let p = tmp_file("broken.jsonl", "这不是 JSON\n{\"type\":\"message\"}\n");
        let h = parse_session_head(&p);
        assert!(h.corrupt);
        assert_eq!(h.id, "broken", "损坏文件也要能用文件名兜一个可删的 id");

        let empty = tmp_file("empty.jsonl", "");
        assert!(parse_session_head(&empty).corrupt);
        assert!(parse_session_head(std::path::Path::new("/tmp/omp-scan-definitely-missing.jsonl")).corrupt);
    }

    #[test]
    fn parse_head_reads_large_file_from_head_and_tail() {
        // >128KB：session 行在头部窗口内，title_change 只在尾部窗口内
        let mut body = String::from(
            "{\"type\":\"session\",\"id\":\"big-1\",\"timestamp\":\"2026-09-15T10:00:00.000Z\",\"cwd\":\"/tmp/big\",\"title\":\"大文件\"}\n",
        );
        let filler = format!(
            "{}\n",
            serde_json::json!({"type":"message","message":{"role":"user","content":[{"type":"text","text":"x".repeat(400)}]}})
        );
        while body.len() < 200 * 1024 {
            body.push_str(&filler);
        }
        body.push_str("{\"type\":\"title_change\",\"title\":\"尾部标题\"}\n");
        let p = tmp_file("big.jsonl", &body);
        let h = parse_session_head(&p);
        assert!(!h.corrupt);
        assert_eq!(h.id, "big-1");
        assert_eq!(h.cwd, "/tmp/big");
        assert_eq!(h.title, "尾部标题", "标题必须来自尾段窗口，而不是只看头 64KB");
    }

    // --- V2 M7b：会话内容搜索 ---------------------------------------------

    #[test]
    fn snippet_counts_hits_and_keeps_char_boundaries() {
        let text = "先讲一段背景，然后提到缓存策略，最后再补充缓存失效的处理。";
        let (snip, hits) = snippet_around(text, "缓存", 4).unwrap();
        assert_eq!(hits, 2, "同一段文本里的多次命中都要计数");
        assert!(snip.contains("缓存"), "片段必须包含命中词：{snip}");
        assert!(snip.starts_with('…') && snip.ends_with('…'), "两端被截断要加省略号：{snip}");
        // 中文按字符切，不能切出半个字符（此处命中词在中间，两侧都有省略号即为字符边界正确）
        assert_eq!(snippet_around(text, "不存在的词", 4), None);
        assert_eq!(snippet_around(text, "", 4), None);
    }

    #[test]
    fn snippet_flattens_newlines() {
        let (snip, hits) = snippet_around("第一行\n第二行 关键词\n第三行", "关键词", 6).unwrap();
        assert_eq!(hits, 1);
        assert!(!snip.contains('\n'), "片段必须单行展示：{snip}");
    }

    #[test]
    fn searchable_text_only_takes_user_and_assistant_text() {
        let user = r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"帮我看看缓存"}]}}"#;
        assert_eq!(searchable_text(user).unwrap(), "帮我看看缓存");
        // 工具结果、thinking、非 message 行都不进搜索面
        let tool = r#"{"type":"message","message":{"role":"toolResult","content":[{"type":"text","text":"缓存命中"}]}}"#;
        assert!(searchable_text(tool).is_none());
        let custom = r#"{"type":"custom","customType":"tool_execution_start","data":{"command":"echo 缓存"}}"#;
        assert!(searchable_text(custom).is_none());
        let think = r#"{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"缓存"}]}}"#;
        assert!(searchable_text(think).is_none());
        assert!(searchable_text("not json").is_none());
    }

    #[test]
    fn search_one_file_finds_hits_and_respects_byte_budget() {
        let body = [
            r#"{"type":"session","id":"s-1","timestamp":"2026-09-15T10:00:00.000Z","cwd":"/tmp/x","title":"缓存优化"}"#,
            r#"{"type":"message","message":{"role":"user","content":[{"type":"text","text":"帮我看看缓存策略"}]}}"#,
            r#"{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"建议先量命中率，再决定缓存层数。"}]}}"#,
            r#"{"type":"message","message":{"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"缓存缓存缓存"}]}}"#,
        ]
        .join("\n");
        let p = tmp_file("search.jsonl", &body);
        let (snip, hits, read) = search_one_file(&p, "缓存", 8 * 1024 * 1024);
        assert_eq!(hits, 2, "只数 user/assistant 正文里的命中（各 1 次），工具输出里的 3 次不算");
        assert!(snip.unwrap().contains("缓存"));
        assert!(read > 0);

        // 预算极小 → 必须提前收手（读满一行才判断，所以允许最多超出一行的长度）
        let full = std::fs::metadata(&p).unwrap().len();
        let (_, hits_small, read_small) = search_one_file(&p, "缓存", 10);
        assert!(read_small < full, "预算到点要提前收手：读到 {read_small} / 共 {full} 字节");
        assert!(hits_small <= 2);
    }
}
