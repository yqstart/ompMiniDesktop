//! 补充用量探针（壳侧）：对 **omp 没有实现探针**、但上游提供「API key 可用」的官方 / 可用
//! 查询接口的供应商做一次只读查询，把结果映射成与 `omp usage --json` 相同的
//! [`UsageLimit`] 结构——设置 ›「供应商用量」页因此能把它们与 omp 报的供应商并排展示。
//!
//! 上游事实（2026-09-18 实测，omp 18.2.5 / 本机 commandcode 凭据）：
//!
//! - **omp 的用量探针清单**（`packages/ai/src/usage/`）里没有 `commandcode` 与 `deepseek`——
//!   全量 `omp usage --json` 会把它们从 `accountsWithoutUsage` 里也滤掉（静默缺席）。
//! - **commandcode**：官方文档只描述滚动窗口，没有文档化的用量 API；但
//!   `GET https://api.commandcode.ai/alpha/billing/credits`（Bearer = Provider API key）实测
//!   **可用**（alpha 前缀即「API key 通道」）；同域 `/internal/billing/*` 只认网页会话 cookie
//!   （API key 打过去 401）。响应（实测）：
//!   `{credits:{monthlyCredits,purchasedCredits,…}, windowLimits:{fiveHour:{used,cap,exceeded,resetAt},weekly:{…}}}`
//!   —— `cap`/`used` 是美元 credits，`resetAt` 是 epoch 毫秒；`monthlyCredits` 是**剩余**月度 credits
//!   （与 CodexBar 的 `monthlyCreditsRemaining` 同口径）。alpha 是未文档化端点：解析全容错、
//!   失败只报一行「查询失败」，绝不影响 omp 探针的数据。
//! - **deepseek**：官方文档化接口 `GET https://api.deepseek.com/user/balance`（Bearer = API key；
//!   api-docs.deepseek.com/zh-cn/api/get-user-balance）返回
//!   `{is_available, balance_infos:[{currency,total_balance,granted_balance,topped_up_balance}]}`；
//!   余额是**字符串**，有 CNY / USD 两种币种。deepseek 没有公开的滚动窗口 / 用量明细接口
//!   （平台网页才能看），所以这里只展示余额。
//!
//! **凭证边界**：key 只经 `omp token <provider> --raw`（omp 官方 CLI，只读）取出，
//! 存于内存、仅用于本次请求头；不落盘、不打印、不进错误消息、不回传前端。凭据不存在 /
//! 端点失败都只产出一行失败记录，界面按「查询失败」展示。
//!
//! **只读**：全部是 GET；不发任何写请求、不动 omp 状态。

use std::sync::LazyLock;
use std::time::Duration;

use crate::provider_usage::{ExtraProbeFailure, ProviderUsage, ProviderUsageReport, UsageLimit};

/// 注册了补充探针的供应商（只在「已配置且 omp 没给报告」时触发）。
pub const EXTRA_PROBES: [&str; 2] = ["commandcode", "deepseek"];

/// 单次 HTTP 查询超时。实测 commandcode 约 2s、deepseek 约 1s；15s 给慢网络留余量。
const HTTP_TIMEOUT: Duration = Duration::from_secs(15);

static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .build()
        .expect("reqwest client 构建失败")
});

// ---------- 纯函数（可测） ----------

/// 从 `omp token <provider> --raw` 的输出里取出凭据。
///
/// 实测：成功时 stdout 是**无空白的单行 token**（如 93 字符的 commandcode key）；
/// 没有凭据时**退出码仍可能是 0**，stdout 是 `No active credential found for provider "x".`
/// 加一行 `Configured providers: …`——所以不能只看退出码，必须按内容判定。
pub fn extract_key(out: &str) -> Option<String> {
    let text = out.trim();
    if text.is_empty() || text.contains(char::is_whitespace) || text.starts_with("No active credential") {
        return None;
    }
    if text.len() < 16 {
        return None;
    }
    Some(text.to_string())
}

/// 错误响应体里抽一行简短消息（JSON 的 `message` / `error.message`，或截断的原文）。
fn short_error(body: &str) -> String {
    let trimmed = body.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        let candidates: [&[&str]; 2] = [&["message"], &["error", "message"]];
        for path in candidates {
            let mut cur = &v;
            let mut ok = true;
            for key in path {
                match cur.get(key) {
                    Some(next) => cur = next,
                    None => {
                        ok = false;
                        break;
                    }
                }
            }
            if ok {
                if let Some(s) = cur.as_str() {
                    if !s.trim().is_empty() {
                        return s.trim().to_string();
                    }
                }
            }
        }
    }
    let one_line = trimmed.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim();
    if one_line.chars().count() > 160 {
        let mut cut: String = one_line.chars().take(160).collect();
        cut.push('…');
        cut
    } else {
        one_line.to_string()
    }
}

fn num(v: Option<&serde_json::Value>) -> Option<f64> {
    v.and_then(|x| x.as_f64().or_else(|| x.as_i64().map(|i| i as f64)))
}

/// commandcode 官方套餐表（Usage Limits 文档的表格）：(5 小时 cap, 每周 cap) → 月度 credits 总额。
///
/// API key 通道的 credits 响应里**没有 plan 字段**（plan 在 subscriptions 端点），但 5h/weekly 的
/// cap 组合在官方表里唯一确定套餐——用它反查月额度，比信任 planId 字符串格式更稳（表变了就
/// 匹配不到：那时月度只显示剩余额，不猜）。
const COMMANDCODE_MONTHLY_CREDITS: [(f64, f64, f64); 6] = [
    (3.0, 6.0, 10.0),     // Go
    (14.0, 35.0, 70.0),   // GOAT
    (16.0, 40.0, 80.0),   // Pro
    (45.0, 90.0, 150.0),  // Max 10×
    (90.0, 180.0, 300.0), // Max 20×
    (12.0, 24.0, 40.0),   // Team Pro
];

fn monthly_total_for(cap_5h: Option<f64>, cap_weekly: Option<f64>) -> Option<f64> {
    let (a, b) = (cap_5h?, cap_weekly?);
    COMMANDCODE_MONTHLY_CREDITS
        .iter()
        .find(|(x, y, _)| (x - a).abs() < 0.001 && (y - b).abs() < 0.001)
        .map(|(_, _, total)| *total)
}

/// 解析 commandcode 的 `/alpha/billing/credits` 响应（结构见模块文档；字段全容错）。
///
/// `period_end_ms` 来自 subscriptions 端点（月度重置时刻；拿不到为 None）。
/// 月度行与官方页面同口径：**已用百分比**（总额按 5h/weekly 的 cap 组合反查官方套餐表——
/// 反查不到时只给剩余额，不猜百分比）。
pub fn parse_commandcode_credits(
    v: &serde_json::Value,
    period_end_ms: Option<i64>,
) -> Result<Vec<UsageLimit>, String> {
    let mut limits = vec![];
    let window_limits = v.get("windowLimits");
    let window = |key: &str| -> Option<(UsageLimit, Option<f64>)> {
        let w = window_limits?.get(key)?;
        let used = num(w.get("used"));
        let cap = num(w.get("cap")).filter(|c| *c > 0.0);
        let (window_id, window_label, id, label, duration) = match key {
            "fiveHour" => ("5h", "5 Hour", "rolling-5h", "5 Hour limit", Some(18_000_000_i64)),
            "weekly" => ("7d", "Weekly", "weekly", "Weekly limit", Some(604_800_000_i64)),
            _ => (key, key, key, key, None),
        };
        let fraction = match (used, cap) {
            (Some(u), Some(c)) => u / c,
            _ => 0.0,
        };
        let exceeded = w.get("exceeded").and_then(|x| x.as_bool()).unwrap_or(false);
        let status = if exceeded || fraction >= 1.0 {
            "exhausted"
        } else if fraction >= 0.8 {
            "warning"
        } else {
            "ok"
        };
        Some((
            UsageLimit {
                id: id.to_string(),
                label: label.to_string(),
                window_id: window_id.to_string(),
                window_label: window_label.to_string(),
                used_fraction: fraction,
                percent: fraction * 100.0,
                status: status.to_string(),
                resets_at: w.get("resetAt").and_then(|x| x.as_i64()),
                duration_ms: duration,
                notes: vec![],
                used,
                limit: cap,
                remaining: match (cap, used) {
                    (Some(c), Some(u)) => Some((c - u).max(0.0)),
                    _ => None,
                },
                unit: "usd".into(),
            },
            cap,
        ))
    };
    let mut cap_5h = None;
    let mut cap_weekly = None;
    if let Some((limit, cap)) = window("fiveHour") {
        cap_5h = cap;
        limits.push(limit);
    }
    if let Some((limit, cap)) = window("weekly") {
        cap_weekly = cap;
        limits.push(limit);
    }
    // 月度：官方页面显示「已用 N%」（总额 = 官方套餐表按 cap 组合反查）；`monthlyCredits` 是剩余。
    let credits = v.get("credits");
    if let Some(monthly_left) = num(credits.and_then(|c| c.get("monthlyCredits"))) {
        let total = monthly_total_for(cap_5h, cap_weekly);
        let (used, limit, fraction, status) = match total {
            Some(t) if t > 0.0 => {
                let used = (t - monthly_left).max(0.0);
                let fraction = used / t;
                let status = if fraction >= 1.0 {
                    "exhausted"
                } else if fraction >= 0.8 {
                    "warning"
                } else {
                    "ok"
                };
                (Some(used), Some(t), fraction, status)
            }
            _ => (None, None, 0.0, "ok"),
        };
        let mut notes = vec![];
        let purchased = num(credits.and_then(|c| c.get("purchasedCredits"))).unwrap_or(0.0);
        if purchased > 0.0 {
            notes.push(format!("purchased: ${purchased:.2}"));
        }
        limits.push(UsageLimit {
            id: "monthly".into(),
            label: "Monthly limit".into(),
            window_id: "monthly".into(),
            window_label: "Monthly".into(),
            used_fraction: fraction,
            percent: fraction * 100.0,
            status: status.into(),
            resets_at: period_end_ms,
            duration_ms: None,
            notes,
            used,
            limit,
            remaining: Some(monthly_left),
            unit: "usd".into(),
        });
    }
    if limits.is_empty() {
        return Err("响应里没有可用的窗口数据".into());
    }
    Ok(limits)
}

/// RFC 3339 → epoch 毫秒（subscriptions 的 `currentPeriodEnd` 是 ISO 串）。
fn parse_iso_ms(s: &str) -> Option<i64> {
    chrono::DateTime::parse_from_rfc3339(s).ok().map(|dt| dt.timestamp_millis())
}

/// 解析 deepseek 的 `/user/balance` 响应（每个币种一条「余额」行；`total_balance` 是字符串）。
pub fn parse_deepseek_balance(v: &serde_json::Value) -> Result<Vec<UsageLimit>, String> {
    let available = v.get("is_available").and_then(|x| x.as_bool()).unwrap_or(false);
    let infos = v
        .get("balance_infos")
        .and_then(|x| x.as_array())
        .ok_or_else(|| "响应里没有 balance_infos".to_string())?;
    let mut limits = vec![];
    for info in infos {
        let currency = info.get("currency").and_then(|x| x.as_str()).unwrap_or("CNY");
        let total = info
            .get("total_balance")
            .and_then(|x| x.as_str())
            .and_then(|s| s.trim().parse::<f64>().ok())
            .or_else(|| num(info.get("total_balance")));
        let Some(total) = total else { continue };
        limits.push(UsageLimit {
            id: format!("balance-{}", currency.to_lowercase()),
            label: "Balance".into(),
            window_id: "balance".into(),
            window_label: "Balance".into(),
            used_fraction: 0.0,
            percent: 0.0,
            status: if available { "ok" } else { "exhausted" }.into(),
            resets_at: None,
            duration_ms: None,
            notes: vec![],
            used: None,
            limit: None,
            remaining: Some(total),
            unit: currency.to_lowercase(),
        });
    }
    if limits.is_empty() {
        return Err("响应里没有可解析的余额".into());
    }
    Ok(limits)
}

// ---------- 网络与编排 ----------

/// GET 一个 JSON 接口（Bearer 认证）。错误消息不含凭据。
async fn fetch_json(url: &str, key: &str) -> Result<serde_json::Value, String> {
    let resp = HTTP
        .get(url)
        .bearer_auth(key)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("网络请求失败：{e}"))?;
    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("读取响应失败：{e}"))?;
    if !status.is_success() {
        return Err(format!("HTTP {}：{}", status.as_u16(), short_error(&body)));
    }
    serde_json::from_str(&body).map_err(|e| format!("响应不是合法 JSON：{e}"))
}

/// 取某供应商的凭据（`omp token <provider> --raw`）。
async fn fetch_key(bin: &str, provider: &str) -> Result<String, String> {
    let out = crate::providers::run_omp(bin, &["token", provider, "--raw"]).await?;
    extract_key(&out).ok_or_else(|| "omp 里没有这个供应商的可用凭据".to_string())
}

/// 跑一个补充探针（key → 请求 → 解析）。
pub async fn probe(bin: &str, provider: &str) -> Result<Vec<UsageLimit>, String> {
    let key = fetch_key(bin, provider).await?;
    match provider {
        "commandcode" => {
            // 两个端点并行：credits（必需）与 subscriptions（尽力——拿「月度重置时刻」，
            // 免费层 / 失败时为 None，不影响额度本身）
            let credits_fut = fetch_json("https://api.commandcode.ai/alpha/billing/credits", &key);
            let subs_fut = fetch_json("https://api.commandcode.ai/alpha/billing/subscriptions", &key);
            let (credits, subs) = tokio::join!(credits_fut, subs_fut);
            let period_end = subs.ok().and_then(|s| {
                s.get("data")
                    .and_then(|d| d.get("currentPeriodEnd"))
                    .and_then(|x| x.as_str())
                    .and_then(parse_iso_ms)
            });
            parse_commandcode_credits(&credits?, period_end)
        }
        "deepseek" => {
            let v = fetch_json("https://api.deepseek.com/user/balance", &key).await?;
            parse_deepseek_balance(&v)
        }
        other => Err(format!("没有为 {other} 注册补充探针")),
    }
}

/// 对「已配置但 omp 没给报告」的供应商逐个跑补充探针，把成功的报告并进 `usage`，
/// 失败的收集成 `extra_failures`（界面显示「查询失败」而不是「无用量数据」）。
pub async fn run_probes(bin: &str, usage: &mut ProviderUsage) -> Vec<ExtraProbeFailure> {
    let mut failures = vec![];
    for provider in EXTRA_PROBES {
        if !usage.configured_providers.iter().any(|c| c == provider) {
            continue;
        }
        if usage.reports.iter().any(|r| r.provider == provider) {
            continue;
        }
        match probe(bin, provider).await {
            Ok(limits) if !limits.is_empty() => usage.reports.push(ProviderUsageReport {
                provider: provider.to_string(),
                plan_type: None,
                account_label: None,
                fetched_at: chrono::Utc::now().timestamp_millis(),
                limits,
            }),
            Ok(_) => {}
            Err(message) => failures.push(ExtraProbeFailure {
                provider: provider.to_string(),
                message,
            }),
        }
    }
    failures
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_key_takes_clean_tokens_only() {
        assert_eq!(extract_key("  cc-abcdef0123456789abcdef  \n"), Some("cc-abcdef0123456789abcdef".into()));
        assert_eq!(extract_key(""), None);
        assert_eq!(extract_key("No active credential found for provider \"deepseek\".\nConfigured providers: commandcode"), None);
        assert_eq!(extract_key("short"), None, "过短的输出不是 token");
        assert_eq!(extract_key("two words token"), None, "含空白不是单行 token");
    }

    /// 本机实测（2026-09-18）的 `/alpha/billing/credits` 响应，逐字节照抄。
    const COMMANDCODE: &str = r#"{
      "credits": { "belowThreshold": false, "creditThreshold": 0, "monthlyCredits": 54.768619927, "purchasedCredits": 0, "freeCredits": 0 },
      "windowLimits": {
        "limited": true, "exceeded": null,
        "fiveHour": { "used": 0.306242895, "cap": 14, "exceeded": false, "resetAt": 1789727992310 },
        "weekly": { "used": 15.231380073, "cap": 35, "exceeded": false, "resetAt": 1790043631859 }
      }
    }"#;

    #[test]
    fn commandcode_maps_windows_and_monthly_credits() {
        let v: serde_json::Value = serde_json::from_str(COMMANDCODE).unwrap();
        let limits = parse_commandcode_credits(&v, Some(1791500000000)).expect("实测响应必须能解析");
        assert_eq!(limits.len(), 3, "5 小时 / 每周 / 月度三档");

        let h5 = &limits[0];
        assert_eq!((h5.id.as_str(), h5.window_id.as_str()), ("rolling-5h", "5h"));
        assert!((h5.used.unwrap() - 0.306242895).abs() < 1e-9);
        assert_eq!(h5.limit, Some(14.0));
        assert!((h5.percent - 2.1874).abs() < 0.01, "used/cap 折算百分比");
        assert_eq!(h5.status, "ok");
        assert_eq!(h5.resets_at, Some(1789727992310));
        assert_eq!(h5.unit, "usd");
        assert!(h5.remaining.unwrap() > 13.6);

        let weekly = &limits[1];
        assert_eq!(weekly.window_id, "7d");
        assert!((weekly.percent - 43.518).abs() < 0.01);

        // 月度与官方页面同口径：cap 组合（14/35）反查 GOAT 月额度 70 → 已用 = 70 - 剩余
        let monthly = &limits[2];
        assert_eq!(monthly.window_id, "monthly");
        assert_eq!(monthly.limit, Some(70.0), "GOAT 月额度由 5h/weekly cap 反查");
        assert!((monthly.used.unwrap() - (70.0 - 54.768619927)).abs() < 1e-6);
        assert!((monthly.percent - 21.759).abs() < 0.01, "官方页面显示「已用 22%」同口径");
        assert_eq!(monthly.resets_at, Some(1791500000000), "月度重置来自 subscriptions 的 currentPeriodEnd");
        assert!((monthly.remaining.unwrap() - 54.768619927).abs() < 1e-6);
    }

    #[test]
    fn commandcode_unknown_plan_shows_remaining_without_fake_percent() {
        // cap 组合不在官方套餐表里（表变了 / 新套餐）：月度只给剩余额，不猜百分比
        let out = r#"{"credits":{"monthlyCredits":5},"windowLimits":{
          "fiveHour":{"used":1,"cap":7,"resetAt":1},
          "weekly":{"used":2,"cap":9,"resetAt":2}}}"#;
        let v: serde_json::Value = serde_json::from_str(out).unwrap();
        let limits = parse_commandcode_credits(&v, None).unwrap();
        let monthly = limits.iter().find(|l| l.window_id == "monthly").expect("月度行仍在");
        assert_eq!(monthly.limit, None);
        assert_eq!(monthly.used, None);
        assert_eq!(monthly.percent, 0.0);
        assert_eq!(monthly.remaining, Some(5.0));
        assert_eq!(monthly.resets_at, None);
    }

    #[test]
    fn commandcode_status_reflects_exceeded_and_thresholds() {
        let out = r#"{"credits":{"monthlyCredits":1},"windowLimits":{
          "fiveHour":{"used":14,"cap":14,"exceeded":true,"resetAt":1},
          "weekly":{"used":30,"cap":35,"exceeded":false,"resetAt":2}}}"#;
        let v: serde_json::Value = serde_json::from_str(out).unwrap();
        let limits = parse_commandcode_credits(&v, None).unwrap();
        assert_eq!(limits[0].status, "exhausted", "exceeded=true → exhausted");
        assert_eq!(limits[1].status, "warning", "85.7% → warning");
        assert_eq!(limits[2].status, "warning", "月度 69/70 = 98.6% → warning");
    }

    #[test]
    fn commandcode_missing_data_is_an_error_not_a_fake_zero() {
        assert!(parse_commandcode_credits(&serde_json::json!({}), None).is_err());
        assert!(parse_commandcode_credits(&serde_json::json!({"credits":{}}), None).is_err());
        // 只有窗口、没有 credits 也成立
        let only_window = serde_json::json!({"windowLimits":{"fiveHour":{"used":1,"cap":2,"resetAt":3}}});
        let limits = parse_commandcode_credits(&only_window, None).unwrap();
        assert_eq!(limits.len(), 1);
    }

    /// deepseek 官方文档（api-docs.deepseek.com/zh-cn/api/get-user-balance）的响应形状。
    #[test]
    fn deepseek_maps_balance_lines() {
        let v = serde_json::json!({
            "is_available": true,
            "balance_infos": [
                { "currency": "CNY", "total_balance": "110.00", "granted_balance": "10.00", "topped_up_balance": "100.00" }
            ]
        });
        let limits = parse_deepseek_balance(&v).unwrap();
        assert_eq!(limits.len(), 1);
        assert_eq!(limits[0].window_id, "balance");
        assert_eq!(limits[0].remaining, Some(110.0));
        assert_eq!(limits[0].unit, "cny");
        assert_eq!(limits[0].status, "ok");

        let unavailable = serde_json::json!({
            "is_available": false,
            "balance_infos": [{ "currency": "USD", "total_balance": "0.00" }]
        });
        let limits = parse_deepseek_balance(&unavailable).unwrap();
        assert_eq!(limits[0].status, "exhausted");
        assert_eq!(limits[0].unit, "usd");
    }

    #[test]
    fn deepseek_without_balance_is_an_error() {
        assert!(parse_deepseek_balance(&serde_json::json!({})).is_err());
        assert!(parse_deepseek_balance(&serde_json::json!({"is_available": true, "balance_infos": []})).is_err());
    }

    #[test]
    fn short_error_prefers_machine_readable_message() {
        assert_eq!(
            short_error(r#"{"success":false,"error":{"code":"UNAUTHORIZED","status":401,"message":"You're logged out."}}"#),
            "You're logged out."
        );
        assert_eq!(short_error("plain text line\nsecond"), "plain text line");
        assert_eq!(short_error(""), "");
    }

    /// 真实 commandcode 端到端（默认跳过；`cargo test -- --ignored` 手动跑）：
    /// 本机装了 omp 且配了 commandcode 凭据时，跑真实 `omp token` + 真实 HTTP，
    /// **alpha 端点漂移会在这里先炸**。无凭据 / 离线时跳过（打印原因）。
    #[test]
    #[ignore]
    fn real_commandcode_probe() {
        let bin = std::env::var("OMP_BIN").unwrap_or_else(|_| "omp".into());
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime");
        match rt.block_on(probe(&bin, "commandcode")) {
            Ok(limits) => {
                assert!(limits.len() >= 2, "至少有 5 小时 / 每周两档窗口");
                for l in &limits {
                    println!(
                        "  {} window={} used={:?}/{:?} percent={:.2}% remaining={:?} unit={} status={} resetsAt={:?}",
                        l.id, l.window_id, l.used, l.limit, l.percent, l.remaining, l.unit, l.status, l.resets_at
                    );
                }
                let monthly = limits.iter().find(|l| l.window_id == "monthly");
                if let Some(m) = monthly {
                    println!("月度（官方页面同口径）：已用 {:.2}% / 总额 {:?} / 剩余 {:?}", m.percent, m.limit, m.remaining);
                }
            }
            Err(e) => eprintln!("跳过：commandcode 探针不可用（{e}）"),
        }
    }
}
