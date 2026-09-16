//! 供应商配额（Provider usage limits）：把 `omp usage --json` 报的各供应商限额窗口
//! （5 小时 / 每周 / 每月）映射到输入框上方的用量入口。
//!
//! **与 `usage.rs` 的分工**：那边统计的是**本地**会话 jsonl 的 token 消耗（设置 › 使用统计），
//! 这边展示的是**供应商侧**的配额窗口——只有 omp 自己拿得到（各 provider 的上游用量接口），
//! 壳侧不直连任何配额 API、不读凭证库，只解析 `omp usage --json` 的输出（与供应商页走
//! `omp auth-broker` 同款做法）。
//!
//! 上游事实（omp 18.2.1 实测，明细见 `docs/v6-schedule.md`）：
//! - `omp usage --json` 输出 `{generatedAt, reports[], accountsWithoutUsage[], disabledCredentials[], capacity{}}`；
//!   `reports[].limits[]` 是各窗口：`{id, label, scope, window{id,label,resetsAt,durationMs?},
//!   amount{used,usedFraction,remainingFraction,unit}, status}`。
//! - **无数据 = `reports: []` + 退出码 0**（provider id 写错 / 未认证 / 上游失败都是这个形状），
//!   所以**不能靠退出码判断失败**——空报告是正常结果，不是错误。
//! - 时间戳（`generatedAt` / `fetchedAt` / `window.resetsAt`）全是 **epoch 毫秒整数**（不是 ISO 串）；
//!   `amount.used` 是 0–100 刻度，`usedFraction` / `remainingFraction` 是 0–1 小数。
//! - `window.durationMs` 对 monthly **缺失**（月窗锚定订阅周年日，不是固定时长），一律按可选解析。
//! - `metadata`（`planType` / `endpoint`）是 provider 自定义对象，字段不保证存在。
//! - 调用成本：冷启动约 1s，omp 自身报告缓存命中约 0.2s；`fetchedAt` 是**数据真实抓取时刻**，
//!   `generatedAt` 是本次渲染时刻（两者之差即缓存年龄，界面用来标「更新于 N 前」）。
//! - 本机数据里 JSON **不含任何账号身份**（`--redact` 对 JSON 是 no-op），所以不传该 flag。
//!
//! **只读**：不调 `omp usage invalidate`（那是清缓存的写操作，会改 omp 状态）。

use serde::Serialize;
use tauri::State;

use crate::commands::{cmd_err, discover_omp_path, AppState, CmdError};

// ---------- 视图类型 ----------

/// 一个限额窗口（5 小时 / 每周 / 每月…）。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageLimit {
    /// omp 的窗口 id（`rolling-5h` / `weekly` / `monthly`；未知值原样透传）。
    pub id: String,
    /// 上游展示名（`5 Hour limit`）——本应用按 `window_id` 走字典，这里只作兜底。
    pub label: String,
    /// 窗口标识（`5h` / `7d` / `monthly`）；语义归类用它，不用 `id`。
    pub window_id: String,
    /// 窗口短名（`5 Hour` / `Weekly` / `Monthly`）。
    pub window_label: String,
    /// 已用比例（0–1 小数；超限时可能 >1，原样透传）。
    pub used_fraction: f64,
    /// 已用百分比（0–100 刻度，同上）。
    pub percent: f64,
    /// 上游状态（`ok` / `exhausted`；开放枚举，未知值原样透传）。
    pub status: String,
    /// 下次重置时刻（epoch 毫秒；上游没给为 None）。
    pub resets_at: Option<i64>,
    /// 窗口时长（毫秒；monthly 恒缺省）。
    pub duration_ms: Option<i64>,
}

/// 一个供应商的配额报告。
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsageReport {
    pub provider: String,
    /// 套餐名（`OpenCode Go`）；上游没给为 None。
    pub plan_type: Option<String>,
    /// 数据真实抓取时刻（epoch 毫秒；0 = 上游未给）。
    pub fetched_at: i64,
    pub limits: Vec<UsageLimit>,
}

/// 配额总览（前端只格式化与按比例画条，不重算）。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderUsage {
    /// 本次渲染时刻（epoch 毫秒）。
    pub generated_at: i64,
    pub reports: Vec<ProviderUsageReport>,
    /// 已认证但本次拿不到用量的账号数（界面给一行说明）。
    pub accounts_without_usage: usize,
    /// 被禁用的凭据数。
    pub disabled_credentials: usize,
    /// 已配置的供应商 id（取自模型目录，与设置页「已配置」同一条口径）。
    ///
    /// **为什么需要它**：`omp usage` 只报**有探针**的供应商，没探针的（如本机实测的
    /// `commandcode`——omp 18.2.1 有它的 api-key 登录但没有它的用量实现）连
    /// `accountsWithoutUsage` 都不出现，全量输出里等于不存在。界面拿这份集合减去
    /// `reports`，才能把「配了这个供应商，但上游没给用量」如实说出来，而不是静默少一块。
    pub configured_providers: Vec<String>,
}

// ---------- 解析（纯函数，可测） ----------

fn text_of(v: Option<&serde_json::Value>) -> Option<&str> {
    v.and_then(|x| x.as_str()).filter(|s| !s.trim().is_empty())
}

/// 数字字段：JSON 里是整数（毫秒 / 百分比），但按 f64 读以兼容小数刻度。
fn num_of(v: Option<&serde_json::Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|i| i as f64)))
}

fn int_of(v: Option<&serde_json::Value>) -> Option<i64> {
    num_of(v).map(|f| f as i64)
}

/// 解析一个限额窗口。只要求 `id` 存在（其余全容错：老版本 / 新 provider 缺字段都不该让整块消失）。
fn parse_limit(v: &serde_json::Value) -> Option<UsageLimit> {
    let id = text_of(v.get("id"))?.to_string();
    let window = v.get("window");
    let scope = v.get("scope");
    let window_id = text_of(window.and_then(|w| w.get("id")))
        .or_else(|| text_of(scope.and_then(|s| s.get("windowId"))))
        .unwrap_or(&id)
        .to_string();
    let label = text_of(v.get("label")).map(str::to_string).unwrap_or_else(|| id.clone());
    let window_label = text_of(window.and_then(|w| w.get("label")))
        .map(str::to_string)
        .unwrap_or_else(|| label.clone());
    // 比例与百分比：优先同源取 `usedFraction`，缺了才用 `used`（仅在 `unit = percent` 时可信）
    // ——两个字段混用会在上游只给其一时给出互相矛盾的值。
    let amount = v.get("amount");
    let is_percent = text_of(amount.and_then(|a| a.get("unit"))).map(|u| u == "percent").unwrap_or(true);
    let used = num_of(amount.and_then(|a| a.get("used"))).filter(|_| is_percent);
    let used_fraction = num_of(amount.and_then(|a| a.get("usedFraction")))
        .or_else(|| used.map(|p| p / 100.0))
        .unwrap_or(0.0);
    Some(UsageLimit {
        id,
        label,
        window_id,
        window_label,
        used_fraction,
        percent: used.unwrap_or(used_fraction * 100.0),
        status: text_of(v.get("status")).unwrap_or("ok").to_string(),
        resets_at: int_of(window.and_then(|w| w.get("resetsAt"))),
        duration_ms: int_of(window.and_then(|w| w.get("durationMs"))),
    })
}

fn parse_report(v: &serde_json::Value) -> Option<ProviderUsageReport> {
    let provider = text_of(v.get("provider"))?.to_string();
    let limits = v
        .get("limits")
        .and_then(|l| l.as_array())
        .map(|arr| arr.iter().filter_map(parse_limit).collect())
        .unwrap_or_default();
    Some(ProviderUsageReport {
        provider,
        plan_type: text_of(v.get("metadata").and_then(|m| m.get("planType"))).map(str::to_string),
        fetched_at: int_of(v.get("fetchedAt")).unwrap_or(0),
        limits,
    })
}

/// 解析 `omp usage --json` 的输出。
///
/// **空 `reports` 是正常结果**（没有任何供应商报配额），不是错误；只有「输出根本不是 JSON」
/// 才算失败——界面据此区分「没有可显示的配额」与「读取失败」。
pub fn parse_usage_json(out: &str) -> Result<ProviderUsage, String> {
    let v: serde_json::Value =
        serde_json::from_str(out.trim()).map_err(|e| format!("输出不是合法 JSON：{e}"))?;
    let arr_len = |key: &str| v.get(key).and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0);
    Ok(ProviderUsage {
        generated_at: int_of(v.get("generatedAt")).unwrap_or(0),
        reports: v
            .get("reports")
            .and_then(|r| r.as_array())
            .map(|arr| arr.iter().filter_map(parse_report).collect())
            .unwrap_or_default(),
        accounts_without_usage: arr_len("accountsWithoutUsage"),
        disabled_credentials: arr_len("disabledCredentials"),
        // 由命令层用模型目录补齐（解析层不碰第二次调用，保持纯函数可测）
        configured_providers: vec![],
    })
}

// ---------- 命令 ----------

fn omp_bin(state: &State<'_, AppState>) -> Result<String, CmdError> {
    discover_omp_path(state).ok_or_else(|| {
        cmd_err(
            "OMP_MISSING",
            "未找到 omp，无法读取用量限额".into(),
            Some("请先在设置 › 通用里指定 omp 路径".into()),
        )
    })
}

/// 各供应商的限额用量：跑 `omp usage --json` 并解析（**只读**，不动 omp 缓存）。
///
/// 「已配置供应商」**只从模型目录的内存缓存里取，绝不自己跑 `omp models --json`**：
/// 那条命令冷启动实测约 **10 秒**（要逐个供应商探测），配额刷新不该被它拖住——
/// 而供应商集合是慢变量，缓存过期也照用；完全没有缓存时才不带这份数据
/// （界面退化为不显示「无用量数据」的说明行，等模型目录自然刷新后下一次就有了）。
#[tauri::command]
pub async fn get_provider_usage(state: State<'_, AppState>) -> Result<ProviderUsage, CmdError> {
    let bin = omp_bin(&state)?;
    let out = crate::providers::run_omp(&bin, &["usage", "--json"])
        .await
        .map_err(|e| cmd_err("PROVIDER_USAGE_FAILED", format!("读取用量限额失败：{e}"), None))?;
    let mut usage = parse_usage_json(&out)
        .map_err(|e| cmd_err("PROVIDER_USAGE_PARSE_FAILED", format!("用量限额解析失败：{e}"), None))?;
    if let Some((_, catalog)) = state.models_cache.lock().await.clone() {
        let mut configured: Vec<String> =
            crate::providers::configured_set(&catalog).into_iter().collect();
        configured.sort();
        usage.configured_providers = configured;
    }
    Ok(usage)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 本机实测（omp 18.2.1 / opencode-go）的真实输出，逐字节照抄。
    const REAL: &str = r#"{
      "generatedAt": 1789551241099,
      "reports": [
        {
          "provider": "opencode-go",
          "fetchedAt": 1789551241090,
          "limits": [
            {
              "id": "rolling-5h",
              "label": "5 Hour limit",
              "scope": { "provider": "opencode-go", "windowId": "5h", "shared": true },
              "window": { "id": "5h", "label": "5 Hour", "resetsAt": 1789554297142, "durationMs": 18000000 },
              "amount": { "used": 26, "usedFraction": 0.26, "remainingFraction": 0.74, "unit": "percent" },
              "status": "ok"
            },
            {
              "id": "weekly",
              "label": "Weekly limit",
              "scope": { "provider": "opencode-go", "windowId": "7d", "shared": true },
              "window": { "id": "7d", "label": "Weekly", "resetsAt": 1789948800142, "durationMs": 604800000 },
              "amount": { "used": 36, "usedFraction": 0.36, "remainingFraction": 0.64, "unit": "percent" },
              "status": "ok"
            },
            {
              "id": "monthly",
              "label": "Monthly limit",
              "scope": { "provider": "opencode-go", "windowId": "monthly", "shared": true },
              "window": { "id": "monthly", "label": "Monthly", "resetsAt": 1791784779142 },
              "amount": { "used": 19, "usedFraction": 0.19, "remainingFraction": 0.81, "unit": "percent" },
              "status": "ok"
            }
          ],
          "metadata": { "planType": "OpenCode Go", "endpoint": "https://opencode.ai/zen/go/v1/usage" }
        }
      ],
      "accountsWithoutUsage": [],
      "disabledCredentials": [],
      "capacity": { "opencode-go": [] }
    }"#;

    #[test]
    fn parses_real_output_window_by_window() {
        let u = parse_usage_json(REAL).expect("真实输出应能解析");
        assert_eq!(u.generated_at, 1789551241099);
        assert_eq!(u.reports.len(), 1);
        let r = &u.reports[0];
        assert_eq!(r.provider, "opencode-go");
        assert_eq!(r.plan_type.as_deref(), Some("OpenCode Go"));
        assert_eq!(r.fetched_at, 1789551241090);
        assert_eq!(r.limits.len(), 3, "三档窗口都要在");

        let h5 = &r.limits[0];
        assert_eq!((h5.id.as_str(), h5.window_id.as_str()), ("rolling-5h", "5h"));
        assert_eq!(h5.window_label, "5 Hour");
        assert_eq!(h5.percent, 26.0);
        assert!((h5.used_fraction - 0.26).abs() < 1e-9);
        assert_eq!(h5.status, "ok");
        assert_eq!(h5.resets_at, Some(1789554297142));
        assert_eq!(h5.duration_ms, Some(18_000_000));

        let weekly = &r.limits[1];
        assert_eq!(weekly.window_id, "7d");
        assert_eq!(weekly.duration_ms, Some(604_800_000));
    }

    #[test]
    fn monthly_window_has_no_duration() {
        let u = parse_usage_json(REAL).expect("真实输出应能解析");
        let monthly = &u.reports[0].limits[2];
        assert_eq!(monthly.id, "monthly");
        assert_eq!(monthly.duration_ms, None, "月窗锚定订阅周年日，上游不给 durationMs");
        assert_eq!(monthly.resets_at, Some(1791784779142), "但重置时刻照给");
    }

    #[test]
    fn empty_reports_is_ok_not_an_error() {
        let u = parse_usage_json(r#"{"generatedAt": 1, "reports": [], "capacity": {}}"#)
            .expect("空报告是正常结果（未认证 / 上游没数据），不是错误");
        assert!(u.reports.is_empty());
        assert_eq!(u.accounts_without_usage, 0);
    }

    #[test]
    fn broken_output_is_an_error() {
        assert!(parse_usage_json("").is_err());
        assert!(parse_usage_json("Error: something went wrong").is_err());
        assert!(parse_usage_json("[1,2,3]").is_ok(), "数组不是对象：按缺字段处理，不算解析失败");
    }

    #[test]
    fn tolerates_missing_fields_and_skips_limits_without_id() {
        let out = r#"{
          "reports": [
            { "provider": "p1", "limits": [
              { "id": "weekly", "amount": { "used": 80, "unit": "percent" } },
              { "amount": { "used": 50 } },
              { "id": "" }
            ] }
          ]
        }"#;
        let u = parse_usage_json(out).expect("缺字段不该炸");
        let r = &u.reports[0];
        assert_eq!(r.plan_type, None);
        assert_eq!(r.fetched_at, 0);
        assert_eq!(r.limits.len(), 1, "缺 id / 空 id 的窗口直接跳过");
        let w = &r.limits[0];
        // 只有 `used`（unit = percent）时按 0–100 刻度折算比例
        assert_eq!(w.percent, 80.0);
        assert!((w.used_fraction - 0.8).abs() < 1e-9);
        assert_eq!(w.window_id, "weekly", "缺 window.id 时退回 limits[].id");
        assert_eq!(w.window_label, "weekly", "缺 window.label 时退回 label");
        assert_eq!((w.resets_at, w.duration_ms), (None, None));
        assert_eq!(w.status, "ok", "缺 status 按 ok");
    }

    #[test]
    fn keeps_provider_order_and_exhausted_status() {
        let out = r#"{
          "generatedAt": 9,
          "reports": [
            { "provider": "a", "limits": [ { "id": "monthly", "window": { "id": "monthly" }, "amount": { "usedFraction": 1.0 }, "status": "exhausted" } ] },
            { "provider": "b", "limits": [] }
          ],
          "accountsWithoutUsage": [{ "provider": "c" }],
          "disabledCredentials": [{ "provider": "d" }, { "provider": "e" }]
        }"#;
        let u = parse_usage_json(out).expect("应能解析");
        assert_eq!(
            u.reports.iter().map(|r| r.provider.as_str()).collect::<Vec<_>>(),
            vec!["a", "b"],
            "顺序保持上游给的（前端再把当前供应商提前）"
        );
        assert_eq!(u.reports[0].limits[0].status, "exhausted");
        assert_eq!(u.accounts_without_usage, 1);
        assert_eq!(u.disabled_credentials, 2);
    }
}
