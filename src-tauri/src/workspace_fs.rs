//! 右栏「文件」页签的目录读取（v4 右栏改造）：只读、单层、懒加载。
//!
//! 不做递归树（大仓库一次全量会卡首屏）、不读文件内容、不写文件——范围边界见 `AGENTS.md`
//! 「不做编辑器」：这里只回答「这个目录里有什么」，打开交给系统默认程序。

use std::path::Path;

use serde::Serialize;

use crate::commands::{cmd_err, CmdError};
use crate::git_info::{git_bin, run_git};

/// 单层条目上限：`node_modules` / 构建产物目录动辄上万项，列全了既卡界面也没人看。
const MAX_ENTRIES: usize = 2000;

/// 目录里的一个条目。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    pub name: String,
    /// 绝对路径（前端打开 / 引用注入直接用它）。
    pub path: String,
    /// 是否目录：**跟随符号链接**后的判断（链接到目录也能展开）。
    pub is_dir: bool,
    /// 符号链接（前端标 `↗`，避免把它当成真实目录）。
    pub is_symlink: bool,
    /// 文件字节数；目录 / stat 失败时为 None。
    pub size: Option<u64>,
}

/// 一次目录列举的结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirListing {
    pub path: String,
    /// 父目录（已是文件系统根时为 None）。
    pub parent: Option<String>,
    pub entries: Vec<DirEntry>,
    /// 命中 [`MAX_ENTRIES`]：前端注明「还有更多未列出」。
    pub truncated: bool,
    /// 该目录所属 git 仓库根（`withRepoRoot` 为真且确实在仓库内时给）：
    /// 前端用它把 `get_change_set` 的相对路径换算成树节点的绝对路径，做变更标色。
    pub repo_root: Option<String>,
}

/// 读一层目录（纯函数，便于单测）：目录优先 + 名称升序（大小写不敏感），超限截断。
pub fn read_entries(dir: &str) -> Result<(Vec<DirEntry>, bool), CmdError> {
    let rd = std::fs::read_dir(dir).map_err(|e| cmd_err("DIR_READ", e.to_string(), Some(dir.to_string())))?;
    let mut out = Vec::new();
    for item in rd.flatten() {
        let path = item.path();
        let meta = std::fs::symlink_metadata(&path);
        let is_symlink = meta.as_ref().map(|m| m.file_type().is_symlink()).unwrap_or(false);
        // 链接按目标判类型：链接到目录要能展开，链接断了就当普通条目
        let is_dir = if is_symlink {
            std::fs::metadata(&path).map(|m| m.is_dir()).unwrap_or(false)
        } else {
            meta.as_ref().map(|m| m.is_dir()).unwrap_or(false)
        };
        let size = if is_dir { None } else { std::fs::metadata(&path).ok().map(|m| m.len()) };
        out.push(DirEntry {
            name: item.file_name().to_string_lossy().into_owned(),
            path: path.to_string_lossy().into_owned(),
            is_dir,
            is_symlink,
            size,
        });
    }
    out.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    let truncated = out.len() > MAX_ENTRIES;
    out.truncate(MAX_ENTRIES);
    Ok((out, truncated))
}

/// 该目录所属仓库根（非仓库 / git 不可用 / 超时都返回 None，前端降级为不标色）。
async fn repo_root_of(dir: &str) -> Option<String> {
    let git = git_bin().await?;
    let out = run_git(&git, dir, &["rev-parse", "--show-toplevel"]).await.ok()?;
    let text = out.trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// 列一层目录（右栏文件树的懒加载入口）。
///
/// `with_repo_root` 只在树根加载时传 true：仓库根每次展开都问一遍 git 是白花开销。
#[tauri::command]
pub async fn list_dir(path: String, with_repo_root: Option<bool>) -> Result<DirListing, CmdError> {
    let dir = Path::new(&path);
    if !dir.is_dir() {
        return Err(cmd_err("DIR_MISSING", "目录不存在".into(), Some(path.clone())));
    }
    // 本地读盘通常很快，但超大目录仍可能几十毫秒：放阻塞线程池，不占 tokio worker。
    let target = path.clone();
    let (entries, truncated) = tauri::async_runtime::spawn_blocking(move || read_entries(&target))
        .await
        .map_err(|e| cmd_err("DIR_READ", e.to_string(), None))??;
    let repo_root = if with_repo_root.unwrap_or(false) {
        repo_root_of(&path).await
    } else {
        None
    };
    Ok(DirListing {
        path: path.clone(),
        parent: dir.parent().map(|p| p.to_string_lossy().into_owned()),
        entries,
        truncated,
        repo_root,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_entries_lists_dirs_first() {
        // 用本 crate 目录做真样本（Cargo.toml 是文件、src 是目录）
        let dir = env!("CARGO_MANIFEST_DIR");
        let (entries, truncated) = read_entries(dir).expect("读目录");
        assert!(!truncated);
        let cargo = entries.iter().find(|e| e.name == "Cargo.toml").expect("Cargo.toml");
        assert!(!cargo.is_dir);
        assert!(cargo.size.unwrap_or(0) > 0);
        assert!(entries.iter().any(|e| e.name == "src" && e.is_dir));
        let first_file = entries.iter().position(|e| !e.is_dir).expect("至少一个文件");
        let last_dir = entries.iter().rposition(|e| e.is_dir).expect("至少一个目录");
        assert!(last_dir < first_file, "目录必须排在文件前面");
    }

    #[test]
    fn read_entries_missing_dir_errors() {
        assert!(read_entries("/nonexistent-omp-mini-dir-for-test").is_err());
    }
}
