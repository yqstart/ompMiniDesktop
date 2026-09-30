//! 「常用设置」的运行时主题列表（`theme.dark` / `theme.light` 的下拉用；docs/v28-schedule.md 三稿）。
//!
//! 上游口径（omp 18.4.4，源码 `packages/tui/src/theme` 的 `getAvailableThemes`）：
//! `availableThemes = Object.keys(内置注册表) ∪ <agentDir>/themes/*.json（去 .json 后缀）`，
//! 排序返回；自定义主题目录不存在 / 读取失败按「没有自定义主题」处理（上游同款 `catch {}`）。
//!
//! 内置表 = omp 注册表字面量（`{ dark, light, ...defaults }`）的键——本机 18.4.4 = **102 个**
//! （`dark` + `light` 两个默认主题 + `defaults/` 的 100 个；与 `theme/defaults/*.json` 的
//! 文件清单交叉核对过零差异）。**随 omp 升级手工同步**：升级后对照二进制里的注册表字面量
//! （或 omp TUI `/settings` 主题选择器的 `Browse all…`）重新提取。
//!
//! 命令只读、不碰 omp 配置；「常用设置」拿到列表后与 enum 取值表同款渲染（当前值不在列表里
//! 时原样补一条，见前端 `lib/settingsList.ts` 的 `runtimeChoiceValues`）。

use std::path::Path;
use tauri::State;

use crate::commands::{AppState, CmdError};

/// omp 18.4.4 的内置主题名（注册表键；排序在合并后做，见 `theme_names`）。
pub const BUILTIN_THEMES: &[&str] = &[
    "dark",
    "light",
    "alabaster",
    "amethyst",
    "anthracite",
    "basalt",
    "birch",
    "dark-abyss",
    "dark-arctic",
    "dark-aurora",
    "dark-catppuccin",
    "dark-cavern",
    "dark-celestial",
    "dark-copper",
    "dark-cosmos",
    "dark-cyberpunk",
    "dark-dracula",
    "dark-eclipse",
    "dark-ember",
    "dark-equinox",
    "dark-forest",
    "dark-github",
    "dark-gruvbox",
    "dark-lavender",
    "dark-lunar",
    "dark-midnight",
    "dark-monochrome",
    "dark-monokai",
    "dark-nebula",
    "dark-neon-noir",
    "dark-nord",
    "dark-ocean",
    "dark-one",
    "dark-poimandres",
    "dark-rainforest",
    "dark-reef",
    "dark-retro",
    "dark-rose-pine",
    "dark-sakura",
    "dark-slate",
    "dark-solarized",
    "dark-solstice",
    "dark-starfall",
    "dark-sunset",
    "dark-swamp",
    "dark-synthwave",
    "dark-taiga",
    "dark-terminal",
    "dark-tokyo-night",
    "dark-tundra",
    "dark-twilight",
    "dark-volcanic",
    "graphite",
    "light-arctic",
    "light-aurora-day",
    "light-canyon",
    "light-catppuccin",
    "light-cirrus",
    "light-coral",
    "light-cyberpunk",
    "light-dawn",
    "light-dunes",
    "light-eucalyptus",
    "light-forest",
    "light-frost",
    "light-github",
    "light-glacier",
    "light-gruvbox",
    "light-haze",
    "light-honeycomb",
    "light-lagoon",
    "light-lavender",
    "light-meadow",
    "light-mint",
    "light-monochrome",
    "light-ocean",
    "light-one",
    "light-opal",
    "light-orchard",
    "light-paper",
    "light-poimandres",
    "light-prism",
    "light-retro",
    "light-sand",
    "light-savanna",
    "light-solarized",
    "light-soleil",
    "light-sunset",
    "light-synthwave",
    "light-tokyo-night",
    "light-wetland",
    "light-zenith",
    "limestone",
    "mahogany",
    "marble",
    "obsidian",
    "onyx",
    "pearl",
    "porcelain",
    "quartz",
    "sandstone",
    "titanium",
];

/// 主题名列表：内置 ∪ `<dir>/themes/*.json`（去 `.json` 后缀），排序去重。
///
/// 与上游 `getAvailableThemes` 完全同口径：只按 `.json` 后缀判断（不查文件类型），
/// 目录读不到就当作「没有自定义主题」。
pub fn theme_names(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = BUILTIN_THEMES.iter().map(|s| (*s).to_string()).collect();
    if let Ok(entries) = std::fs::read_dir(dir.join("themes")) {
        for entry in entries.flatten() {
            let file = entry.file_name();
            let Some(name) = file.to_str() else { continue };
            if let Some(stem) = name.strip_suffix(".json") {
                if !stem.is_empty() {
                    names.push(stem.to_string());
                }
            }
        }
    }
    names.sort();
    names.dedup();
    names
}

/// 本机 omp 的主题列表（「常用设置」的深色 / 浅色主题下拉用；只读）。
#[tauri::command]
pub async fn list_omp_themes(state: State<'_, AppState>) -> Result<Vec<String>, CmdError> {
    let dir = state.agent_dir.lock().await.clone();
    Ok(theme_names(&dir))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 造一个临时目录（同 `memories.rs` 的单测做法）；调用方负责清理。
    fn scratch(tag: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("omp-mini-themes-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn builtin_table_matches_omp_18_4_4() {
        assert_eq!(BUILTIN_THEMES.len(), 102);
        assert_eq!(BUILTIN_THEMES.iter().filter(|n| **n == "dark").count(), 1);
        for key in ["dark", "light", "titanium", "dark-catppuccin", "light-canyon", "light-zenith"] {
            assert!(BUILTIN_THEMES.contains(&key), "缺内置主题 {key}");
        }
    }

    #[test]
    fn theme_names_merges_custom_dir_sorted() {
        let dir = scratch("merge");
        let themes = dir.join("themes");
        std::fs::create_dir_all(&themes).unwrap();
        std::fs::write(themes.join("my-theme.json"), "{}").unwrap();
        std::fs::write(themes.join("another.json"), "{}").unwrap();
        std::fs::write(themes.join("not-a-theme.txt"), "{}").unwrap();
        let names = theme_names(&dir);
        // 自定义进列表、非 json 不进、整个列表排序
        assert!(names.contains(&"my-theme".to_string()));
        assert!(names.contains(&"another".to_string()));
        assert!(!names.contains(&"not-a-theme".to_string()));
        assert!(names.windows(2).all(|w| w[0] <= w[1]), "必须排序");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn theme_names_dedups_and_tolerates_missing_dir() {
        let dir = scratch("dedup");
        let themes = dir.join("themes");
        std::fs::create_dir_all(&themes).unwrap();
        // 自定义主题与内置同名：去重后只留一个
        std::fs::write(themes.join("titanium.json"), "{}").unwrap();
        let names = theme_names(&dir);
        assert_eq!(names.iter().filter(|n| *n == "titanium").count(), 1);
        let _ = std::fs::remove_dir_all(&dir);

        // 目录不存在 = 只有内置
        let missing = dir.join("no-such");
        assert_eq!(theme_names(&missing).len(), BUILTIN_THEMES.len());
    }
}
