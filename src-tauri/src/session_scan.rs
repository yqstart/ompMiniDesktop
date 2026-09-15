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
/// 文件格式：每行一个 JSON，含 {"type":"session",...}。
pub fn parse_session_head(path: &std::path::Path) -> SessionHead {
    let fallback = SessionHead {
        id: path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string(),
        cwd: String::new(),
        timestamp: 0,
        title: String::new(),
        file: path.to_string_lossy().to_string(),
        corrupt: true,
    };
    let Ok(text) = std::fs::read_to_string(path) else { return fallback };
    let mut title = String::new();
    let mut last_title_change: Option<String> = None;
    let mut session: Option<serde_json::Value> = None;
    // 尾部 title_change：先全扫（文件通常 < 20MB，M1 可接受；超大走截断在外层做）
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else { continue };
        match v.get("type").and_then(|t| t.as_str()) {
            Some("session") => session = Some(v),
            Some("title_change") => {
                if let Some(t) = v.get("title").and_then(|t| t.as_str()) {
                    last_title_change = Some(t.to_string());
                }
            }
            Some("title") => {
                if let Some(t) = v.get("title").and_then(|t| t.as_str()) {
                    if title.is_empty() {
                        title = t.to_string();
                    }
                }
            }
            _ => {}
        }
        if text.len() > 40_000_000 {
            break;
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

fn parse_ts(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).map(|d| d.timestamp_millis()).ok()
}

/// cwd 归组：按真实路径前缀匹配，不猜 slug。
pub fn project_of(cwd: &str, projects: &[String]) -> Option<String> {
    if cwd.is_empty() {
        return None;
    }
    let norm = |p: &str| {
        let mut s = p.trim().to_string();
        while s.len() > 1 && s.ends_with('/') {
            s.pop();
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
}
