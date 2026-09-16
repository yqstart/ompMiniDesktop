//! omp 常用设置（设置 › 通用）：把 omp 全局配置（`config.yml`）里用户最常改的那些键
//! 映射进界面。**读写走 `omp config` CLI 子进程**（与供应商页走 `omp auth-broker` 同款），
//! 壳侧不直接解析 / 改写 `config.yml` —— YAML 的合并、类型解析、schema 默认值都是 omp 的事。
//!
//! 上游事实（omp 18.2.1 实测，明细见 `docs/v8-schedule.md`）：
//! - `omp config list --json` 输出**扁平点路径** → `{value, type, description}`（501 项、约 90KB、
//!   实测 0.13s）。`type` 是 `boolean|number|enum|string|array|record`；**enum 的合法取值不在
//!   JSON 里**（只在人读的 `omp config list` 文本里，形如 `edit.mode = hashline (apply_patch|…)`），
//!   所以界面上的选项表是壳侧自带的白名单（见 `src/lib/ompSettings.ts`），当前值不在表里就
//!   原样补一条，不吞信息。
//! - `omp config get <key> --json` 回 `{key, value, type, description}`；未知 key 退出码 1。
//! - `omp config set <key> <value>` 按 schema 类型解析值：boolean 接受 `true/false/yes/no/on/off/1/0`，
//!   enum 必须精确匹配（失败时 stderr 回 `Error: Invalid value: X. Valid values: …`，原样透传给用户），
//!   写入的是**全局层**（`~/.omp/agent/config.yml`），**不写** `<cwd>/.omp/config.yml`。
//! - **负数 / 以 `-` 开头的值必须用 `--` 分隔**：实测 `omp config set temperature -1` 直接报
//!   `error: Unknown option '-1'`（yargs 把它当 flag），正确写法是 `omp config set temperature -- -1`。
//!   本模块一律走 `--` 形式（对普通值无副作用，已实测）——`temperature` / `compaction.thresholdPercent`
//!   的「默认」就是 `-1`，绕不开。
//! - `omp config reset <key>` 把该键的 **schema 默认值写回**全局配置（不是删键）；界面上的
//!   「恢复默认」用它。
//! - **读数受项目层影响**：`list` / `get` 返回的是 `defaults ← global ← project` 合并后的**有效值**。
//!   本模块一律把工作目录钉在 agentDir（那里不会有 `.omp/`），读到 / 写回的就是全局层的真相。
//! - **改动何时生效未实测**：长驻的 `omp --mode rpc` 会话是否热读 `config.yml` 没能验证
//!   （试过用 `extendedContext` + `get_state.contextWindow` 对拍，该键对当前模型没有可观测差异；
//!   18.2.1 的二进制里 JS 已不再是可读源码，`strings` 取不到加载逻辑）。界面上只做**必然为真**
//!   的表述——「新建的会话一定读到新值」，不宣称已打开的会话会立刻应用。
//!
//! 壳侧**只碰全局层**：不写项目配置、不写覆盖层、不直读凭证库；能改的键由前端的白名单限定，
//! 后端只做**格式校验**（点分标识符）与类型序列化，不认识具体有哪些键——上游增删配置项时
//! 前端白名单里缺失的项会自动显示为「当前 omp 版本没有这个设置」，不需要改这里。

use serde::Serialize;
use std::path::Path;
use tauri::State;

use crate::commands::{cmd_err, discover_omp_path, AppState, CmdError};
use crate::providers::run_omp_in;

/// 单次读取允许的最大 key 数（界面白名单约 40 项，留足余量；防前端异常传超大数组）。
const KEYS_MAX: usize = 200;
/// key 的长度上限：omp 的 schema 路径都是短点分标识符。
const KEY_MAX_LEN: usize = 128;

// ---------- 视图类型 ----------

/// 一个设置项的当前值：`kind` 是 omp 的 schema 类型（boolean / number / enum / …），
/// `description` 是上游英文说明（原样透传，不做翻译——它是 omp 对这条设置的定义）。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SettingItem {
    pub key: String,
    pub value: serde_json::Value,
    pub kind: String,
    pub description: String,
}

// ---------- 纯逻辑（单测锁着） ----------

/// key 是不是合法的点分标识符：非空、每段以**字母**开头、其余只含字母数字与 `_` / `-`。
///
/// 段内允许 `_` 与 `-` 是照着 omp 的 schema 来的（实测 18.2.1：`web_search.enabled`、
/// `generate_image.enabled` 带下划线，`providers.openai-codex.codeMode` 带连字符）。
/// 段首必须是字母：`-` 开头会被 yargs 当成 flag（`omp config set temperature -1` 就是这么
/// 翻车的，见模块头注释），从形状上先堵死。
///
/// 校验的意义不在防命令注入（`run_omp` 用 `Command::args` 传参、不经 shell），而在**别把
/// 前端 bug 变成对 omp 配置的随意写入**——`omp config set` 只认真实 schema 路径，但把
/// 用户可控字符串直接塞进命令行不是好习惯，这里先把形状钉死。
pub fn valid_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= KEY_MAX_LEN
        && key.split('.').all(|seg| {
            seg.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
                && seg.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        })
}

/// 把界面传来的 JSON 值转成 `omp config set` 的位置参数（含负数在内的字符串形式）。
///
/// 只接受标量：bool / number / string。array / record 形态的键不在白名单里（它们要整表
/// 读写，语义与单个开关不同），真传进来也一律拒绝，不猜。
pub fn value_arg(value: &serde_json::Value) -> Result<String, String> {
    match value {
        serde_json::Value::Bool(b) => Ok(b.to_string()),
        serde_json::Value::Number(n) => Ok(n.to_string()),
        serde_json::Value::String(s) if !s.is_empty() && !s.chars().any(char::is_control) => {
            Ok(s.clone())
        }
        serde_json::Value::String(_) => Err("值不能为空或含控制字符".into()),
        _ => Err("只支持布尔、数字与字符串类型的设置".into()),
    }
}

/// 从 `omp config list --json` 的输出里挑出请求的 key（顺序按 `keys` 给的来）。
///
/// 上游没有的 key（omp 版本差异、白名单漂移）**直接不出现在结果里**——界面据此把那一行
/// 标成「当前 omp 版本没有这个设置」并禁用，而不是显示一个编造的值。
pub fn pick_settings(out: &str, keys: &[String]) -> Vec<SettingItem> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(out.trim()) else {
        return vec![];
    };
    let Some(map) = v.as_object() else {
        return vec![];
    };
    keys.iter()
        .filter_map(|k| {
            let entry = map.get(k)?;
            Some(SettingItem {
                key: k.clone(),
                // 凭证类字段在上游是 `redacted: true` 且不带 value —— 白名单里没有这类键，
                // 万一漏进来，Null 会让界面显示成「未设置」而不是伪装成一个值。
                value: entry.get("value").cloned().unwrap_or(serde_json::Value::Null),
                kind: entry.get("type").and_then(|t| t.as_str()).unwrap_or_default().to_string(),
                description: entry
                    .get("description")
                    .and_then(|d| d.as_str())
                    .unwrap_or_default()
                    .to_string(),
            })
        })
        .collect()
}

/// 校验一批 key（命令入口用）：全过返回 Ok，否则给出第一个不合法的。
fn check_keys(keys: &[String]) -> Result<(), String> {
    if keys.len() > KEYS_MAX {
        return Err(format!("一次最多读取 {KEYS_MAX} 个设置"));
    }
    match keys.iter().find(|k| !valid_key(k)) {
        Some(bad) => Err(format!("非法的设置键：{bad}")),
        None => Ok(()),
    }
}

// ---------- 进程调用 ----------

fn omp_bin(state: &tauri::State<'_, AppState>) -> Result<String, CmdError> {
    discover_omp_path(state).ok_or_else(|| {
        cmd_err(
            "OMP_MISSING",
            "未找到 omp，无法读写设置".into(),
            Some("请先在设置 › 通用里指定 omp 路径".into()),
        )
    })
}

/// 读一个键的有效值（带 `--json`，拿到 value 与 description）。
async fn read_one(dir: &Path, bin: &str, key: &str) -> Result<serde_json::Value, String> {
    let out = run_omp_in(settings_cwd(dir), bin, &["config", "get", key, "--json"]).await?;
    let v: serde_json::Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("设置解析失败：{e}"))?;
    Ok(v)
}

/// 拿来做工作目录的 agentDir：**只在不存在的兜底路径上退让**。
///
/// agentDir 是「钉住全局层」的手段（见 `run_omp_in`），但它自己可能还没被 omp 建出来
/// （全新机器、omp 未初始化）——那种情况下 `current_dir` 会让 spawn 直接失败，
/// 所以退回到「不指定目录」，而不是让整个设置页报错。
fn settings_cwd(dir: &Path) -> Option<&Path> {
    dir.is_dir().then_some(dir)
}

/// 从 `omp config get` 的回包造一个视图项（写 / 恢复默认后回读用同一个口径）。
fn item_from_get(key: &str, v: &serde_json::Value) -> SettingItem {
    SettingItem {
        key: v.get("key").and_then(|k| k.as_str()).unwrap_or(key).to_string(),
        value: v.get("value").cloned().unwrap_or(serde_json::Value::Null),
        kind: v.get("type").and_then(|t| t.as_str()).unwrap_or_default().to_string(),
        description: v.get("description").and_then(|d| d.as_str()).unwrap_or_default().to_string(),
    }
}

// ---------- Tauri 命令 ----------

/// 批量读设置：一次 `omp config list --json` 拿全部，再按请求的 key 过滤。
///
/// **不逐个 `config get`**：白名单约 40 项，逐个 spawn 就是 40 个进程（每次 ~0.12s，
/// 冷启动更久），而全量 list 只要一次。
#[tauri::command]
pub async fn get_omp_settings(
    state: State<'_, AppState>,
    keys: Vec<String>,
) -> Result<Vec<SettingItem>, CmdError> {
    check_keys(&keys).map_err(|e| cmd_err("SETTING_KEY_INVALID", e, None))?;
    if keys.is_empty() {
        return Ok(vec![]);
    }
    let bin = omp_bin(&state)?;
    let dir = state.agent_dir.lock().await.clone();
    let out = run_omp_in(settings_cwd(&dir), &bin, &["config", "list", "--json"])
        .await
        .map_err(|e| cmd_err("SETTINGS_READ_FAILED", format!("读取 omp 设置失败：{e}"), None))?;
    Ok(pick_settings(&out, &keys))
}

/// 写一个设置项：`omp config set <key> -- <value>`（`--` 是必需的，见模块头注释），
/// 写完**回读**返回真相——omp 静默丢弃写入时界面不该显示一个其实没生效的值。
#[tauri::command]
pub async fn set_omp_setting(
    state: State<'_, AppState>,
    key: String,
    value: serde_json::Value,
) -> Result<SettingItem, CmdError> {
    if !valid_key(&key) {
        return Err(cmd_err("SETTING_KEY_INVALID", format!("非法的设置键：{key}"), None));
    }
    let arg = value_arg(&value).map_err(|e| cmd_err("SETTING_VALUE_INVALID", e, None))?;
    let bin = omp_bin(&state)?;
    let dir = state.agent_dir.lock().await.clone();
    run_omp_in(settings_cwd(&dir), &bin, &["config", "set", &key, "--", &arg])
        .await
        .map_err(|e| cmd_err("SETTINGS_WRITE_FAILED", format!("写入设置失败：{e}"), None))?;
    let back = read_one(&dir, &bin, &key)
        .await
        .map_err(|e| cmd_err("SETTINGS_READ_FAILED", format!("回读设置失败：{e}"), None))?;
    Ok(item_from_get(&key, &back))
}

/// 恢复一个设置项的 schema 默认值（`omp config reset`，把默认值写回全局配置）。
#[tauri::command]
pub async fn reset_omp_setting(
    state: State<'_, AppState>,
    key: String,
) -> Result<SettingItem, CmdError> {
    if !valid_key(&key) {
        return Err(cmd_err("SETTING_KEY_INVALID", format!("非法的设置键：{key}"), None));
    }
    let bin = omp_bin(&state)?;
    let dir = state.agent_dir.lock().await.clone();
    run_omp_in(settings_cwd(&dir), &bin, &["config", "reset", &key])
        .await
        .map_err(|e| cmd_err("SETTINGS_RESET_FAILED", format!("恢复默认失败：{e}"), None))?;
    let back = read_one(&dir, &bin, &key)
        .await
        .map_err(|e| cmd_err("SETTINGS_READ_FAILED", format!("回读设置失败：{e}"), None))?;
    Ok(item_from_get(&key, &back))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 本机实测（omp 18.2.1）`omp config list --json` 的真实片段，逐字节照抄（截断）。
    const LIST: &str = r#"{
      "edit.mode": {
        "value": "hashline",
        "type": "enum",
        "description": "Select the edit tool variant (replace, patch, hashline, or apply_patch)"
      },
      "compaction.thresholdPercent": {
        "value": -1,
        "type": "number",
        "description": "Percent threshold for context maintenance; set to Default to use legacy reserve-based behavior"
      },
      "todo.enabled": { "value": true, "type": "boolean" },
      "auth.broker.token": { "type": "string", "description": "", "redacted": true }
    }"#;

    fn keys(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn valid_key_accepts_schema_paths() {
        assert!(valid_key("extendedContext"));
        assert!(valid_key("tools.approvalMode"));
        assert!(valid_key("bash.allowCompoundCommands"));
        assert!(valid_key("eval.py"));
        assert!(valid_key("task.isolation.merge"));
        // 实测 18.2.1 的真实键：下划线与连字符都出现在 schema 路径里
        assert!(valid_key("web_search.enabled"));
        assert!(valid_key("generate_image.enabled"));
        assert!(valid_key("providers.openai-codex.codeMode"));
        assert!(valid_key("providers.ollama-cloud.maxConcurrency"));
    }

    #[test]
    fn valid_key_rejects_shapes_that_are_not_schema_paths() {
        assert!(!valid_key(""));
        assert!(!valid_key(".leading.dot"));
        assert!(!valid_key("trailing."));
        assert!(!valid_key("double..dot"));
        assert!(!valid_key("has space"));
        assert!(!valid_key("-startsWithDash"));
        assert!(!valid_key("semi;colon"));
        assert!(!valid_key("quote\"inside"));
        assert!(!valid_key("newline\ninside"));
        // 段内可以有 `-`，但段首不行（会被 yargs 当 flag）
        assert!(valid_key("openai-codex.codeMode"));
        assert!(!valid_key("bad.-segment"));
        assert!(!valid_key(&"a".repeat(KEY_MAX_LEN + 1)));
    }

    #[test]
    fn value_arg_serializes_scalars() {
        assert_eq!(value_arg(&serde_json::json!(true)).unwrap(), "true");
        assert_eq!(value_arg(&serde_json::json!(false)).unwrap(), "false");
        // 负数与小数：omp 侧要 `--` 才不会当 flag，这里必须先给出正确的字符串
        assert_eq!(value_arg(&serde_json::json!(-1)).unwrap(), "-1");
        assert_eq!(value_arg(&serde_json::json!(0.7)).unwrap(), "0.7");
        assert_eq!(value_arg(&serde_json::json!(300)).unwrap(), "300");
        assert_eq!(value_arg(&serde_json::json!("apply_patch")).unwrap(), "apply_patch");
    }

    #[test]
    fn value_arg_rejects_non_scalars_and_empties() {
        assert!(value_arg(&serde_json::json!(["a"])).is_err());
        assert!(value_arg(&serde_json::json!({ "a": 1 })).is_err());
        assert!(value_arg(&serde_json::json!(null)).is_err());
        assert!(value_arg(&serde_json::json!("")).is_err());
        assert!(value_arg(&serde_json::json!("bad\nvalue")).is_err());
    }

    #[test]
    fn pick_settings_keeps_requested_order_and_types() {
        let got = pick_settings(
            LIST,
            &keys(&["todo.enabled", "edit.mode", "compaction.thresholdPercent"]),
        );
        assert_eq!(got.len(), 3);
        assert_eq!(got[0].key, "todo.enabled");
        assert_eq!(got[0].value, serde_json::json!(true));
        assert_eq!(got[0].kind, "boolean");
        assert_eq!(got[0].description, "");
        assert_eq!(got[1].value, serde_json::json!("hashline"));
        assert_eq!(got[1].kind, "enum");
        assert_eq!(got[2].value, serde_json::json!(-1));
    }

    #[test]
    fn pick_settings_drops_keys_the_upstream_does_not_have() {
        let got = pick_settings(LIST, &keys(&["todo.enabled", "gone.key"]));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].key, "todo.enabled");
    }

    #[test]
    fn pick_settings_survives_bad_json_and_non_object() {
        assert!(pick_settings("not json", &keys(&["todo.enabled"])).is_empty());
        assert!(pick_settings("[1,2,3]", &keys(&["todo.enabled"])).is_empty());
        assert!(pick_settings("", &keys(&["todo.enabled"])).is_empty());
    }

    #[test]
    fn pick_settings_does_not_fabricate_redacted_values() {
        let got = pick_settings(LIST, &keys(&["auth.broker.token"]));
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].value, serde_json::Value::Null);
    }

    #[test]
    fn check_keys_guards_shape_and_size() {
        assert!(check_keys(&keys(&["todo.enabled", "edit.mode"])).is_ok());
        assert!(check_keys(&[]).is_ok());
        assert!(check_keys(&keys(&["todo.enabled", "bad key"])).is_err());
        let too_many: Vec<String> = (0..KEYS_MAX + 1).map(|_| "todo.enabled".to_string()).collect();
        assert!(check_keys(&too_many).is_err());
    }
}
