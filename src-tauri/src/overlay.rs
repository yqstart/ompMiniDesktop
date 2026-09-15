use serde::{Deserialize, Serialize};

pub const OVERLAY_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Project {
    pub id: String,
    pub path: String,
    #[serde(default)]
    pub added_at: i64,
    #[serde(default)]
    pub last_model: Option<String>,
    #[serde(default)]
    pub last_thinking: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Overlay {
    pub version: u32,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub archived: std::collections::HashMap<String, bool>,
    #[serde(default)]
    pub notes: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub session_approval: std::collections::HashMap<String, String>,
    #[serde(default)]
    pub omp_path: Option<String>,
    #[serde(flatten, default)]
    pub extra: serde_json::Map<String, serde_json::Value>,
}

impl Default for Overlay {
    fn default() -> Self {
        Self {
            version: OVERLAY_VERSION,
            projects: vec![],
            archived: Default::default(),
            notes: Default::default(),
            session_approval: Default::default(),
            omp_path: None,
            extra: Default::default(),
        }
    }
}

impl Overlay {
    pub fn normalize(mut self) -> (Self, bool) {
        if self.version != OVERLAY_VERSION {
            return (Self { omp_path: self.omp_path, ..Self::default() }, true);
        }
        // 去重项目（按规范化路径保留首个）
        let mut seen = std::collections::HashSet::new();
        self.projects.retain(|p| seen.insert(normalize_path(&p.path)));
        (self, false)
    }
}

pub fn normalize_path(p: &str) -> String {
    let mut s = p.trim().to_string();
    while s.len() > 1 && s.ends_with('/') {
        s.pop();
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_mismatch_resets_but_keeps_omp_path() {
        let ov = Overlay { version: 99, omp_path: Some("/x/omp".into()), ..Overlay::default() };
        let (n, reset) = ov.normalize();
        assert!(reset);
        assert_eq!(n.version, 1);
        assert_eq!(n.omp_path.as_deref(), Some("/x/omp"));
    }

    #[test]
    fn dedup_projects_by_path() {
        let ov = Overlay {
            version: 1,
            projects: vec![
                Project { id: "p1".into(), path: "/a/".into(), added_at: 1, last_model: None, last_thinking: None },
                Project { id: "p2".into(), path: "/a".into(), added_at: 2, last_model: None, last_thinking: None },
            ],
            ..Overlay::default()
        };
        let (n, _) = ov.normalize();
        assert_eq!(n.projects.len(), 1);
    }
}
