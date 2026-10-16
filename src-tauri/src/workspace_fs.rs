//! 右栏「文件」页签的目录读取（v4 右栏改造）：只读、单层、懒加载。
//!
//! 不做递归树（大仓库一次全量会卡首屏）、不读文件内容、不写文件——范围边界见 `AGENTS.md`
//! 「不做编辑器」：这里只回答「这个目录里有什么」，打开交给系统默认程序。

use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::{cmd_err, CmdError};
use crate::git_info::{git_bin, run_git};

/// 单层条目上限：`node_modules` / 构建产物目录动辄上万项，列全了既卡界面也没人看。
const MAX_ENTRIES: usize = 2000;

/// 搜索跳过的目录名（依赖 / 缓存 / 构建中间产物）：搜索是为了找**源码**，
/// 钻进这些目录只会把结果淹掉、还拖慢遍历。命中本身不受影响（搜 `node_modules` 照样能搜到它）。
const SEARCH_SKIP_DIRS: &[&str] = &[
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    "target",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    ".nuxt",
    ".turbo",
    ".cache",
    ".gradle",
    ".idea",
    ".mypy_cache",
    ".pytest_cache",
    "Pods",
];

/// 搜索最大深度（防极端深目录；符号链接一律不跟，天然无环）。
const SEARCH_MAX_DEPTH: usize = 24;
/// 搜索扫描条目预算：到顶即停并如实标记截断（大仓库里搜一个字母也不许把界面卡死）。
const SEARCH_SCAN_BUDGET: usize = 200_000;
/// 搜索命中收集上限：先收够再排序取前 N，避免「先到先得」把好匹配挤掉。
const SEARCH_HIT_BUDGET: usize = 800;

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

/// 搜索命中项（右栏文件页签的快速过滤）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathHit {
    /// 条目名（最后一段）。
    pub name: String,
    /// 相对搜索根（POSIX 分隔；前端直接显示这个，不是绝对路径）。
    pub rel: String,
    /// 绝对路径（前端打开 / 引用注入用它）。
    pub path: String,
    pub is_dir: bool,
}

/// 一次搜索的结果。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub hits: Vec<PathHit>,
    /// 结果被截断（命中 / 扫描预算用尽，或超出 `limit`）：界面据此注明「继续输入以缩小范围」。
    pub truncated: bool,
}

/// 单条命中的相关度（越大越靠前；None = 不匹配）。
///
/// 判据从强到弱：名字精确 → 名字前缀 → 名字内包含（位置越靠前越好）→ 仅路径包含；
/// 同档再按「层级浅、路径短」加分——`src/a.ts` 要排在 `deep/deeper/a.ts` 前面。
///
/// **路径包含只在查询自带 `/` 时才算命中**（`src/comp` 这类带层级的写法）：否则搜 `src`
/// 会把 `src` 下每个文件都列出来（它们的相对路径都含 `src/`），结果全是没有信息量的噪音。
fn match_score(lower_query: &str, name: &str, rel: &str) -> Option<i64> {
    let n = name.to_lowercase();
    let base = if n == lower_query {
        1000
    } else if n.starts_with(lower_query) {
        900
    } else if let Some(pos) = n.find(lower_query) {
        800 - pos.min(150) as i64
    } else if lower_query.contains('/') && rel.to_lowercase().contains(lower_query) {
        600
    } else {
        return None;
    };
    let depth = rel.matches('/').count() as i64;
    Some(base - depth * 5 - (rel.len() as i64) / 8)
}

/// 递归搜索（纯函数，便于单测）：名字 / 相对路径包含 `query` 的都算命中，
/// 深度 + 扫描条目 + 命中数三重预算，返回 `(命中, 是否截断)`。
pub fn search_entries(root: &str, query: &str, limit: usize) -> (Vec<PathHit>, bool) {
    let q = query.trim().to_lowercase();
    if q.is_empty() || limit == 0 {
        return (vec![], false);
    }
    let mut stack: Vec<(PathBuf, String, usize)> = vec![(PathBuf::from(root), String::new(), 0)];
    let mut scored: Vec<(i64, PathHit)> = Vec::new();
    let mut scanned = 0usize;
    let mut truncated = false;
    while let Some((dir, rel, depth)) = stack.pop() {
        if depth > SEARCH_MAX_DEPTH {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        // 目录顺序不影响最终排序（分数 + 路径决定），所以不做 collect 排序，直接遍历
        for item in rd.flatten() {
            scanned += 1;
            if scanned > SEARCH_SCAN_BUDGET {
                truncated = true;
                break;
            }
            let Ok(file_type) = item.file_type() else { continue };
            let name = item.file_name().to_string_lossy().into_owned();
            let child_rel = if rel.is_empty() { name.clone() } else { format!("{rel}/{name}") };
            let is_dir = file_type.is_dir();
            // 跳过判断要在 `name` 被 move 进命中项之前算（跳过的目录本身仍可被搜到，只是不进去）
            let skip = SEARCH_SKIP_DIRS.contains(&name.as_str());
            if let Some(score) = match_score(&q, &name, &child_rel) {
                if scored.len() >= SEARCH_HIT_BUDGET {
                    truncated = true;
                } else {
                    scored.push((
                        score,
                        PathHit {
                            name,
                            rel: child_rel.clone(),
                            path: item.path().to_string_lossy().into_owned(),
                            is_dir,
                        },
                    ));
                }
            }
            // 只递归真实目录（符号链接不跟）
            if is_dir && !skip {
                stack.push((item.path(), child_rel, depth + 1));
            }
        }
        if scanned > SEARCH_SCAN_BUDGET {
            break;
        }
    }
    scored.sort_by(|a, b| {
        b.0.cmp(&a.0)
            .then_with(|| a.1.rel.len().cmp(&b.1.rel.len()))
            .then_with(|| a.1.rel.cmp(&b.1.rel))
    });
    if scored.len() > limit {
        truncated = true;
        scored.truncate(limit);
    }
    (scored.into_iter().map(|(_, hit)| hit).collect(), truncated)
}

/// 右栏文件页签的快速过滤：按名字 / 相对路径搜索文件与文件夹（**只读**，不读文件内容）。
///
/// 目标目录 = 当前会话 cwd（与文件树同一个根）；命中给相对路径，前端显示与引用注入都用它。
#[tauri::command]
pub async fn search_paths(root: String, query: String, limit: Option<usize>) -> Result<SearchResult, CmdError> {
    if !Path::new(&root).is_dir() {
        return Err(cmd_err("DIR_MISSING", "目录不存在".into(), Some(root)));
    }
    let cap = limit.unwrap_or(200).clamp(1, SEARCH_HIT_BUDGET);
    // 递归遍历是纯 CPU + 磁盘活：放阻塞线程池，不占 tokio worker
    let target = root.clone();
    let (hits, truncated) =
        tauri::async_runtime::spawn_blocking(move || search_entries(&target, &query, cap))
            .await
            .map_err(|e| cmd_err("DIR_READ", e.to_string(), None))?;
    Ok(SearchResult { hits, truncated })
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

    /// 临时目录树：`src/components/FileTree.tsx` / `src/index.ts` / `docs/FileTree.md` /
    /// `node_modules/pkg/index.ts`（应被跳过）。
    fn sample_tree(tag: &str) -> PathBuf {
        let root = std::env::temp_dir().join(format!("omp-mini-search-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        for dir in ["src/components", "docs", "node_modules/pkg"] {
            std::fs::create_dir_all(root.join(dir)).expect("建临时目录");
        }
        std::fs::write(root.join("src/components/FileTree.tsx"), "x").unwrap();
        std::fs::write(root.join("src/index.ts"), "x").unwrap();
        std::fs::write(root.join("docs/FileTree.md"), "x").unwrap();
        std::fs::write(root.join("node_modules/pkg/index.ts"), "x").unwrap();
        root
    }

    #[test]
    fn search_matches_files_and_dirs_with_relative_paths() {
        let root = sample_tree("rel");
        let dir = root.to_str().unwrap();
        // 名字命中：文件与目录都返回，路径是相对根的 POSIX 写法
        let (hits, truncated) = search_entries(dir, "filetree", 50);
        assert!(!truncated);
        assert_eq!(
            hits.iter().map(|h| h.rel.as_str()).collect::<Vec<_>>(),
            vec!["docs/FileTree.md", "src/components/FileTree.tsx"],
            "同分按路径短者先：{hits:?}"
        );
        assert!(!hits[0].is_dir);
        assert_eq!(
            hits[1].path,
            root.join("src/components/FileTree.tsx").to_string_lossy()
        );

        let (dirs, _) = search_entries(dir, "components", 50);
        assert_eq!(dirs.len(), 1, "只按名字匹配，不许把目录下的文件也带出来：{dirs:?}");
        assert!(dirs[0].is_dir, "目录也要能搜到：{dirs:?}");
        assert_eq!(dirs[0].rel, "src/components");

        // 带层级的查询（含 `/`）才按相对路径匹配：`src/` 命中该目录本身与它下面的条目
        let (by_path, _) = search_entries(dir, "src/", 50);
        assert!(by_path.iter().any(|h| h.rel == "src/components/FileTree.tsx"), "{by_path:?}");
        assert!(by_path.iter().all(|h| h.rel.starts_with("src/")), "{by_path:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn search_skips_dependency_dirs_but_finds_them() {
        let root = sample_tree("skip");
        let dir = root.to_str().unwrap();
        let (hits, _) = search_entries(dir, "index.ts", 50);
        assert_eq!(hits.len(), 1, "node_modules 里的同名文件不许出现：{hits:?}");
        assert_eq!(hits[0].rel, "src/index.ts");
        // 跳过的是「进去搜」，不是「搜不到」：目录本身照旧命中
        let (dirs, _) = search_entries(dir, "node_modules", 50);
        assert!(dirs.iter().any(|h| h.rel == "node_modules" && h.is_dir), "{dirs:?}");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn search_ranks_exact_and_shallow_first_and_truncates() {
        let root = sample_tree("rank");
        let dir = root.to_str().unwrap();
        // 精确同名 > 前缀 > 包含 > 仅路径包含；层级浅者先
        let (hits, _) = search_entries(dir, "src", 50);
        assert!(hits.iter().any(|h| h.rel == "src" && h.is_dir));
        assert_eq!(hits[0].rel, "src", "精确命中排最前：{hits:?}");
        // limit 生效并标记截断
        let (limited, truncated) = search_entries(dir, "i", 2);
        assert_eq!(limited.len(), 2);
        assert!(truncated);
        // 空查询 / 非法参数：不返回东西，也不报错
        assert!(search_entries(dir, "   ", 10).0.is_empty());
        assert!(search_entries(dir, "x", 0).0.is_empty());
        assert!(search_entries("/nonexistent-omp-mini-search", "x", 10).0.is_empty());
        let _ = std::fs::remove_dir_all(&root);
    }
}
