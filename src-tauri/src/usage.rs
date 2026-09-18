//! 使用统计（Usage）：把 omp 本地会话记录里的 token 用量聚合成设置页的三项指标
//! （tokens 用量 / Cache 命中率 / 活跃天数）。
//!
//! 上游事实（omp 18.x 实测，明细见 `docs/v5-schedule.md`）：
//! - 用量真值只在 jsonl 的 **assistant 消息**里：`message.usage` =
//!   `{input, output, cacheRead, cacheWrite, totalTokens, …}`，且实测逐条满足
//!   `totalTokens = input + output + cacheRead + cacheWrite`
//!   （`input` 是**未缓存**输入，缓存读 / 写单独成项）。
//! - `message.timestamp` 是**毫秒数字**（不是 ISO 串）。
//!
//! 扫描是**全量**的：时间范围内的每一条 assistant 消息都要计入，所以不能像列表那样只看文件头尾。
//! 保护手段与 `search_sessions` 同款——文件数 / 字节 / 墙钟三道预算，任何一道到点即停并把
//! `truncated` 置 true（**宁可说「可能不全」，不假装统计完了**）。行级预筛（先看原始行里有没有
//! `"usage"` 再解析 JSON）让真实目录（29MB）的整轮扫描保持在百毫秒级。
//!
//! 纯逻辑（行解析、按日聚合、范围过滤、连续天数、热力图窗口）与真实文件行为（扫描临时目录、
//! 预算截断、缺失目录）都有单测。
//!
//! 每日热力图（GitHub 贡献图口径）**独立于范围窗口**：它固定看最近 [`HEAT_WEEKS`] 周并按周日对齐，
//! 所以「今日」范围也能看到一整年日历，而三项指标仍只按所选范围聚合——界面上的「每日 / 每周 /
//! 累计」三档只是对同一份逐日数据换取值，不是三次扫描。

use chrono::{DateTime, Datelike, Days, Local, NaiveDate};
use serde::Serialize;
use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::commands::{AppState, CmdError};

/// 扫描文件数上限（按 mtime 取最近的一批，旧的先放弃）。
const SCAN_MAX_FILES: usize = 3000;
/// 读取字节上限。真实 sessions 目录 ~29MB，留足余量；到点即停并置 `truncated`。
const SCAN_MAX_BYTES: u64 = 256 * 1024 * 1024;
/// 墙钟时间上限（毫秒）。
const SCAN_MAX_MS: u64 = 5000;
/// 热力图窗口周数（GitHub 贡献图同款 53 列，最后一列 = 本周）。
const HEAT_WEEKS: u64 = 53;

// ---------- 视图类型 ----------

/// 一组用量数字（范围总览）。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// 未缓存输入 token。
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// omp 的 `totalTokens` 累加（= input + output + cacheRead + cacheWrite）。
    pub total: u64,
    /// 请求数（带 usage 的 assistant 消息条数）。
    pub calls: u64,
}

impl UsageBucket {
    fn add(&mut self, u: &MsgUsage) {
        self.input += u.input;
        self.output += u.output;
        self.cache_read += u.cache_read;
        self.cache_write += u.cache_write;
        self.total += u.total;
        self.calls += 1;
    }
}

/// 范围总览。派生指标（命中率 / 活跃天数 / 连续天数）一律在**后端**算好——
/// 前端只做格式化，不自算统计（与 `omp-state` 同一条口径）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    #[serde(flatten)]
    pub bucket: UsageBucket,
    /// 范围内有请求的天数。
    pub active_days: u64,
    /// 连续活跃天数（今天还没跑但昨天跑了不断签，GitHub 口径）。
    pub current_streak: u64,
    /// 范围内最长连续活跃天数。
    pub longest_streak: u64,
    /// 缓存命中率 = cacheRead / (input + cacheRead)；分母为 0 时 null。
    pub cache_hit_rate: Option<f64>,
}

/// 热力图格子里的一个模型用量（token 降序，界面按此列读数）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHeatModel {
    /// `model` 原样来自 jsonl；空串表示上游没给（界面显示「未知模型」）。
    pub model: String,
    pub total: u64,
}

/// 热力图的一格（`date` = 本地日期；没跑的日子补零，日历才成网格）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHeatRow {
    pub date: String,
    /// 当日 token 合计（= `models` 各行的和）。
    pub total: u64,
    /// 当日按模型拆分（token 降序；没有用量的日子为空）。
    pub models: Vec<UsageHeatModel>,
}

/// 使用统计整体回包（`truncated` = 因扫描预算提前收手，统计可能不全）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub totals: UsageTotals,
    /// 热力图：最近 53 周（周日对齐、逐日补零、到今天为止），**不随 `days` 裁剪**。
    pub heat: Vec<UsageHeatRow>,
    /// 实际扫描的会话文件数。
    pub scanned_files: usize,
    pub truncated: bool,
}

// ---------- 行解析（纯函数，可测） ----------

/// 一条 assistant 消息里的用量（omp `message.usage` 原值；缺失字段按 0）。
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct MsgUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub total: u64,
}

/// 一行 jsonl 里我们关心的东西。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedMsg {
    /// `message.timestamp`（毫秒数字）。
    pub ts_ms: i64,
    /// `message.model` 原样（热力图按模型拆分读数用；缺失为空串）。
    pub model: String,
    /// 没有 usage 的 assistant 行（如纯工具结果回复）为 None——它不进统计。
    pub usage: Option<MsgUsage>,
}

fn u64_of(v: Option<&serde_json::Value>) -> u64 {
    v.and_then(|x| x.as_u64()).unwrap_or(0)
}

/// 从 `message.usage` 取用量；**没有 `totalTokens` 的老数据**按四段之和兜底
/// （口径与 omp 的 `totalTokens = input + output + cacheRead + cacheWrite` 一致）。
pub fn parse_usage(v: &serde_json::Value) -> MsgUsage {
    let input = u64_of(v.get("input"));
    let output = u64_of(v.get("output"));
    let cache_read = u64_of(v.get("cacheRead"));
    let cache_write = u64_of(v.get("cacheWrite"));
    let total = match v.get("totalTokens").and_then(|x| x.as_u64()) {
        Some(t) if t > 0 => t,
        _ => input + output + cache_read + cache_write,
    };
    MsgUsage { input, output, cache_read, cache_write, total }
}

/// 解析一行 jsonl：只认 `type == "message"` 的 assistant 行。
/// 时间取 `message.timestamp`（毫秒数字），缺失时退回顶层 `timestamp`（ISO 串）；
/// 两者都读不到的行返回 None（无法按日归档，宁缺勿错算到今天头上）。
pub fn parse_message_line(line: &str) -> Option<ParsedMsg> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("message") {
        return None;
    }
    let m = v.get("message")?;
    if m.get("role").and_then(|r| r.as_str()) != Some("assistant") {
        return None;
    }
    let ts_ms = m
        .get("timestamp")
        .and_then(|t| t.as_i64())
        .or_else(|| {
            v.get("timestamp")
                .and_then(|t| t.as_str())
                .and_then(|s| DateTime::parse_from_rfc3339(s).ok())
                .map(|d| d.timestamp_millis())
        })?;
    Some(ParsedMsg {
        ts_ms,
        model: m.get("model").and_then(|p| p.as_str()).unwrap_or("").to_string(),
        usage: m.get("usage").map(parse_usage),
    })
}

/// 本地日期（`YYYY-MM-DD`）——按用户所在时区归档，与界面上的「今天」一致。
fn local_date(ms: i64) -> Option<String> {
    let dt = DateTime::from_timestamp_millis(ms)?;
    Some(dt.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

// ---------- 扫描 ----------

/// 扫描预算（单测用来把预算压到极小以验证截断）。
#[derive(Debug, Clone, Copy)]
struct Budget {
    max_files: usize,
    max_bytes: u64,
    max_ms: u64,
}

impl Default for Budget {
    fn default() -> Self {
        Budget { max_files: SCAN_MAX_FILES, max_bytes: SCAN_MAX_BYTES, max_ms: SCAN_MAX_MS }
    }
}

/// 扫 `sessions/` 下全部 jsonl，按 `days`（None = 全部）过滤后聚合。
/// 不碰 tauri，可在临时目录上做真实行为测试。
pub fn scan_usage_in(root: &Path, days: Option<u32>, now: DateTime<Local>) -> UsageStats {
    scan_usage_with(root, days, now, Budget::default())
}

fn scan_usage_with(
    root: &Path,
    days: Option<u32>,
    now: DateTime<Local>,
    budget: Budget,
) -> UsageStats {
    let today = now.date_naive();
    // 范围下界：今日 = 今天当天；近 N 日在内的是最近 N 个自然日（含今天）。
    // 日期串是 ISO，字典序即时间序，直接比字符串。
    let cutoff: Option<String> = match days {
        Some(d) => Some(
            (today - Days::new(d.saturating_sub(1) as u64)).format("%Y-%m-%d").to_string(),
        ),
        None => None,
    };
    // 热力图窗口起点：最近 53 周的周日。范围再窄也要把这一年的日粒度算全
    let heat_from = heat_window_start(today).format("%Y-%m-%d").to_string();

    let mut files: Vec<(std::time::SystemTime, PathBuf)> = vec![];
    if let Ok(rd) = std::fs::read_dir(root) {
        for entry in rd.flatten() {
            let Ok(inner) = std::fs::read_dir(entry.path()) else { continue };
            for f in inner.flatten() {
                let p = f.path();
                if p.extension().and_then(|s| s.to_str()) != Some("jsonl") {
                    continue;
                }
                let mtime = f.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
                files.push((mtime, p));
            }
        }
    }
    // 新会话优先：预算到点时，先保住最近的数据
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let mut truncated = files.len() > budget.max_files;

    let started = std::time::Instant::now();
    let mut scanned_files = 0usize;
    let mut bytes_read = 0u64;

    let mut totals = UsageTotals::default();
    let mut by_day: BTreeMap<String, UsageBucket> = BTreeMap::new();
    // 热力图按「日期 → 模型 → token」存：格子的读数要按模型拆开（三项指标不用它）
    let mut by_heat: BTreeMap<String, BTreeMap<String, u64>> = BTreeMap::new();

    for (_mtime, path) in files.into_iter().take(budget.max_files) {
        if bytes_read >= budget.max_bytes || started.elapsed().as_millis() as u64 >= budget.max_ms {
            truncated = true;
            break;
        }
        let Ok(file) = std::fs::File::open(&path) else { continue };
        scanned_files += 1;
        let reader = std::io::BufReader::new(file);
        for line in std::io::BufRead::lines(reader) {
            let Ok(line) = line else { break };
            bytes_read += line.len() as u64 + 1;
            if bytes_read > budget.max_bytes {
                truncated = true;
                break;
            }
            // 行级预筛：绝大多数行（用户消息 / 工具结果 / 标题变更）连解析都不用做
            if !line.contains("\"usage\"") {
                continue;
            }
            let Some(msg) = parse_message_line(&line) else { continue };
            let Some(date) = local_date(msg.ts_ms) else { continue };
            // 热力图在范围裁剪之前聚合：它固定看最近一年，不随上方范围切换
            if date.as_str() >= heat_from.as_str() {
                if let Some(u) = msg.usage.as_ref() {
                    *by_heat
                        .entry(date.clone())
                        .or_default()
                        .entry(msg.model.clone())
                        .or_insert(0) += u.total;
                }
            }
            if let Some(c) = &cutoff {
                if &date < c {
                    continue;
                }
            }
            let Some(u) = msg.usage else { continue };
            totals.bucket.add(&u);
            by_day.entry(date).or_default().add(&u);
        }
        if started.elapsed().as_millis() as u64 >= budget.max_ms {
            truncated = true;
            break;
        }
    }

    let totals = finish_totals(totals, &by_day, today);
    UsageStats { totals, heat: fill_heat(&by_heat, today), scanned_files, truncated }
}

/// 收尾：从 by_day 派生活跃天数、连续天数与命中率。
fn finish_totals(
    mut totals: UsageTotals,
    by_day: &BTreeMap<String, UsageBucket>,
    today: NaiveDate,
) -> UsageTotals {
    // by_day 的每个键都来自一条带 usage 的消息，键数即活跃天数
    let active: Vec<NaiveDate> = by_day
        .keys()
        .filter_map(|k| NaiveDate::parse_from_str(k, "%Y-%m-%d").ok())
        .collect();
    totals.active_days = active.len() as u64;
    totals.longest_streak = longest_streak(&active);
    totals.current_streak = current_streak(&active, today);
    let denom = totals.bucket.input + totals.bucket.cache_read;
    totals.cache_hit_rate =
        if denom > 0 { Some(totals.bucket.cache_read as f64 / denom as f64) } else { None };
    totals
}

/// 最长连续天数（输入需按日期升序）。
fn longest_streak(days: &[NaiveDate]) -> u64 {
    let mut best = 0u64;
    let mut cur = 0u64;
    let mut prev: Option<NaiveDate> = None;
    for d in days {
        cur = match prev {
            Some(p) if *d == p + Days::new(1) => cur + 1,
            _ => 1,
        };
        best = best.max(cur);
        prev = Some(*d);
    }
    best
}

/// 当前连续天数（GitHub 口径：今天还没跑但昨天跑了不算断签，从昨天往前数）。
fn current_streak(days: &[NaiveDate], today: NaiveDate) -> u64 {
    let set: HashSet<NaiveDate> = days.iter().copied().collect();
    if set.is_empty() {
        return 0;
    }
    let mut cur = if set.contains(&today) { today } else { today - Days::new(1) };
    let mut n = 0u64;
    while set.contains(&cur) {
        n += 1;
        cur = cur - Days::new(1);
    }
    n
}

// ---------- 热力图 ----------

/// 热力图窗口起点：最近 [`HEAT_WEEKS`] 周的周日（最后一列 = 本周，今天的格子落在它自己那一行）。
fn heat_window_start(today: NaiveDate) -> NaiveDate {
    let offset = today.weekday().num_days_from_sunday() as u64;
    today - Days::new((HEAT_WEEKS - 1) * 7 + offset)
}

/// 热力图：从窗口起点到今天**逐日补零**（没跑的日子也要有格子，日历才成网格），
/// 每格的模型明细按 token 降序（界面直接照着列读数）。
fn fill_heat(by_heat: &BTreeMap<String, BTreeMap<String, u64>>, today: NaiveDate) -> Vec<UsageHeatRow> {
    let none = BTreeMap::new();
    let mut out = vec![];
    let mut cur = heat_window_start(today);
    while cur <= today {
        let key = cur.format("%Y-%m-%d").to_string();
        let mut models: Vec<UsageHeatModel> = by_heat
            .get(&key)
            .unwrap_or(&none)
            .iter()
            .map(|(model, total)| UsageHeatModel { model: model.clone(), total: *total })
            .collect();
        models.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.model.cmp(&b.model)));
        let total = models.iter().map(|m| m.total).sum();
        out.push(UsageHeatRow { date: key, total, models });
        cur = cur + Days::new(1);
    }
    out
}

// ---------- 命令 ----------

/// 使用统计：扫会话 jsonl 聚合三项指标（范围可选：1 / 7 / 30 天，null = 全部）。
#[tauri::command]
pub async fn get_usage_stats(
    state: State<'_, AppState>,
    days: Option<u32>,
) -> Result<UsageStats, CmdError> {
    let agent = state.agent_dir.lock().await.clone();
    let days = days.map(|d| d.clamp(1, 3650));
    Ok(scan_usage_in(&agent.join("sessions"), days, Local::now()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    /// 固定的「现在」：2026-09-16 12:00 本地时区（测试里所有时间都由它派生）。
    fn now() -> DateTime<Local> {
        Local.with_ymd_and_hms(2026, 9, 16, 12, 0, 0).single().expect("本地时间应唯一")
    }

    fn ts(y: i32, m: u32, d: u32, h: u32) -> i64 {
        Local.with_ymd_and_hms(y, m, d, h, 0, 0).single().expect("本地时间应唯一").timestamp_millis()
    }

    fn tmp_root(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("omp-usage-test-{}-{}", std::process::id(), tag));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn line_session(id: &str, cwd: &str) -> String {
        serde_json::json!({
            "type": "session", "version": 3, "id": id,
            "timestamp": "2026-09-15T10:00:00.000Z", "cwd": cwd
        })
        .to_string()
    }

    fn line_title() -> String {
        serde_json::json!({"type": "title", "title": "会话标题"}).to_string()
    }

    fn usage_json(input: u64, output: u64, cache_read: u64) -> serde_json::Value {
        serde_json::json!({
            "input": input, "output": output, "cacheRead": cache_read, "cacheWrite": 0,
            "totalTokens": input + output + cache_read, "reasoningTokens": 7,
            "cost": {"input": 0.001, "output": 0.002, "cacheRead": 0.0001, "cacheWrite": 0.0, "total": 0.0031}
        })
    }

    fn line_assistant(ts_ms: i64, usage: Option<serde_json::Value>) -> String {
        let mut m = serde_json::json!({
            "role": "assistant", "content": [], "provider": "anthropic", "model": "sonnet",
            "timestamp": ts_ms, "duration": 1500
        });
        if let Some(u) = usage {
            m["usage"] = u;
        }
        serde_json::json!({"type": "message", "message": m}).to_string()
    }

    fn line_user(ts_ms: i64) -> String {
        serde_json::json!({
            "type": "message",
            "message": {"role": "user", "content": [{"type": "text", "text": "你好"}], "timestamp": ts_ms}
        })
        .to_string()
    }

    /// 在临时目录里落一个会话文件：`sessions/<slug>/<file>.jsonl`。
    fn write_session(root: &Path, slug: &str, file: &str, lines: &[String]) {
        let dir = root.join(slug);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(file), lines.join("\n") + "\n").unwrap();
    }

    // ---------- 行解析 ----------

    #[test]
    fn parse_line_reads_usage_and_timestamp() {
        let line = line_assistant(ts(2026, 9, 16, 9), Some(usage_json(100, 20, 300)));
        let msg = parse_message_line(&line).expect("assistant 行应被解析");
        assert_eq!(msg.ts_ms, ts(2026, 9, 16, 9));
        assert_eq!(msg.model, "sonnet", "模型名原样带出（热力图按模型拆读数）");
        let u = msg.usage.expect("有 usage");
        assert_eq!((u.input, u.output, u.cache_read, u.cache_write, u.total), (100, 20, 300, 0, 420));

        // 缺 totalTokens 的老数据按四段之和兜底；ISO 顶层时间戳也能兜
        let old = serde_json::json!({
            "type": "message", "timestamp": "2026-09-16T01:00:00.000Z",
            "message": {"role": "assistant", "content": [], "usage": {"input": 5, "output": 6, "cacheRead": 7, "cacheWrite": 8}}
        })
        .to_string();
        let msg = parse_message_line(&old).expect("老数据也要认");
        assert_eq!(msg.usage.unwrap().total, 26, "totalTokens 缺失时按四段之和");
        // 退回的是顶层 ISO 串本身：断言该 UTC 时刻的毫秒值，**不能**用本地时区构造的
        // `ts(…)`（CI 跑在 UTC、开发机在 UTC+8，那样断言会随机器差 8 小时）
        let iso_ms = DateTime::parse_from_rfc3339("2026-09-16T01:00:00.000Z")
            .unwrap()
            .timestamp_millis();
        assert_eq!(msg.ts_ms, iso_ms, "退回顶层 ISO 时间戳");

        // 没有 usage 的 assistant 行认，但用量为空
        assert!(parse_message_line(&line_assistant(ts(2026, 9, 16, 9), None)).unwrap().usage.is_none());
        // 非 assistant / 非 message / 无时间的行一律不认
        assert!(parse_message_line(&line_user(ts(2026, 9, 16, 9))).is_none());
        assert!(parse_message_line("{\"type\":\"custom\",\"customType\":\"tool_execution_start\"}").is_none());
        assert!(parse_message_line("不是 JSON").is_none());
        let no_ts = serde_json::json!({"type": "message", "message": {"role": "assistant", "content": [], "usage": {"input": 1}}})
            .to_string();
        assert!(parse_message_line(&no_ts).is_none(), "没有时间就无法归档到某一天");
    }

    // ---------- 聚合 ----------

    #[test]
    fn scan_aggregates_totals_and_active_days() {
        let root = tmp_root("agg");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_title(),
                line_session("sid-1", "/tmp/demo"),
                line_user(ts(2026, 9, 16, 9)),
                line_assistant(ts(2026, 9, 16, 9), Some(usage_json(100, 20, 300))),
                line_assistant(ts(2026, 9, 16, 15), Some(usage_json(200, 30, 0))),
                // 没有 usage 的 assistant 行：既不计请求也不计活跃
                line_assistant(ts(2026, 9, 16, 15), None),
            ],
        );
        write_session(
            &root,
            "--tmp-other--",
            "s2.jsonl",
            &[
                line_session("sid-2", "/tmp/other"),
                line_assistant(ts(2026, 9, 15, 10), Some(usage_json(50, 10, 0))),
            ],
        );
        let stats = scan_usage_with(&root, None, now(), Budget::default());
        assert_eq!(stats.scanned_files, 2);
        assert!(!stats.truncated);
        assert_eq!(stats.totals.bucket.input, 350);
        assert_eq!(stats.totals.bucket.output, 60);
        assert_eq!(stats.totals.bucket.cache_read, 300);
        assert_eq!(stats.totals.bucket.total, 710, "total = input+output+cacheRead");
        assert_eq!(stats.totals.bucket.calls, 3);
        assert_eq!(stats.totals.active_days, 2);
        assert_eq!(stats.totals.current_streak, 2, "今天与昨天连成 2 天");
        assert_eq!(stats.totals.longest_streak, 2);
        // 热力图：53 周窗口从周日开始、补零到今天（2026-09-16 是周三 → 368 格）
        assert_eq!(stats.heat[0].date, "2025-09-14");
        assert_eq!(stats.heat.len(), 365 + 3);
        assert_eq!(stats.heat.last().unwrap().date, "2026-09-16");
        assert_eq!(stats.heat.last().unwrap().total, 650);
        assert_eq!(stats.heat[stats.heat.len() - 2].total, 60, "昨天 50+10");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn heat_window_is_one_year_from_sunday_and_range_independent() {
        let root = tmp_root("heat");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo"),
                // 窗口外的旧数据：日历里没有，但「全部」范围仍计入总览
                line_assistant(ts(2025, 9, 1, 8), Some(usage_json(7777, 0, 0))),
                // 一年内、远在 7 日窗口外：日历要留着
                line_assistant(ts(2026, 1, 5, 8), Some(usage_json(120, 0, 0))),
                line_assistant(ts(2026, 9, 16, 8), Some(usage_json(10, 0, 0))),
            ],
        );
        let week = scan_usage_with(&root, Some(7), now(), Budget::default());
        assert_eq!(week.totals.bucket.total, 10, "总览仍只看 7 日窗口");
        let jan = week.heat.iter().find(|h| h.date == "2026-01-05").expect("日历覆盖一年");
        assert_eq!(jan.total, 120, "热力图不随范围裁剪");
        assert!(week.heat.iter().all(|h| h.date != "2025-09-01"), "一年前的旧数据不进日历");
        // 周日对齐：53 列的列首都是周日（最后一块可能不满 7 格）
        for (i, chunk) in week.heat.chunks(7).enumerate() {
            let d = NaiveDate::parse_from_str(&chunk[0].date, "%Y-%m-%d").unwrap();
            assert_eq!(d.weekday().num_days_from_sunday(), 0, "第 {} 列的列首应是周日", i + 1);
        }
        assert_eq!(week.heat.chunks(7).count(), HEAT_WEEKS as usize);

        let all = scan_usage_with(&root, None, now(), Budget::default());
        assert_eq!(all.totals.bucket.total, 7777 + 120 + 10, "全部范围不受日历窗口影响");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn heat_rows_carry_per_model_breakdown() {
        let root = tmp_root("heat-models");
        // 同一天两个模型：格子的读数要按 token 降序列出各自用量
        let mut gpt = serde_json::json!({
            "role": "assistant", "content": [], "model": "gpt-5", "timestamp": ts(2026, 9, 16, 10)
        });
        gpt["usage"] = usage_json(10, 0, 0);
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo"),
                line_assistant(ts(2026, 9, 16, 9), Some(usage_json(100, 20, 300))), // sonnet 420
                serde_json::json!({"type": "message", "message": gpt}).to_string(), // gpt-5 10
                line_assistant(ts(2026, 9, 15, 9), Some(usage_json(7, 0, 0))),      // 昨天 sonnet 7
            ],
        );
        let stats = scan_usage_with(&root, Some(1), now(), Budget::default());
        let today = stats.heat.last().unwrap();
        assert_eq!(today.date, "2026-09-16");
        assert_eq!(today.total, 430, "合计 = 各模型之和");
        let models: Vec<(&str, u64)> =
            today.models.iter().map(|m| (m.model.as_str(), m.total)).collect();
        assert_eq!(models, vec![("sonnet", 420), ("gpt-5", 10)], "按 token 降序");
        // 只有 sonnet 的那天不带 gpt-5；没跑的日子没有明细
        let yesterday = &stats.heat[stats.heat.len() - 2];
        assert_eq!(yesterday.models.len(), 1);
        assert_eq!(yesterday.models[0].model, "sonnet");
        assert!(stats.heat[0].models.is_empty(), "补零的格子没有模型明细");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn range_filter_drops_old_days_and_keeps_today_boundary() {
        let root = tmp_root("range");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo"),
                line_assistant(ts(2026, 9, 16, 8), Some(usage_json(1000, 0, 0))),
                // 昨天（近 7 日内）
                line_assistant(ts(2026, 9, 15, 8), Some(usage_json(100, 0, 0))),
                // 10 天前（窗口外）
                line_assistant(ts(2026, 9, 6, 8), Some(usage_json(9999, 0, 0))),
            ],
        );
        let week = scan_usage_with(&root, Some(7), now(), Budget::default());
        assert_eq!(week.totals.bucket.total, 1100, "窗口外的 9999 不能计入");
        assert_eq!(week.totals.bucket.calls, 2);
        assert_eq!(week.totals.active_days, 2);
        assert_eq!(week.totals.current_streak, 2);
        assert_eq!(week.totals.longest_streak, 2);

        // 「今日」= 只有今天
        let today = scan_usage_with(&root, Some(1), now(), Budget::default());
        assert_eq!(today.totals.bucket.total, 1000);
        assert_eq!(today.totals.bucket.calls, 1);
        assert_eq!(today.totals.active_days, 1);
        assert_eq!(today.totals.longest_streak, 1);

        // 全部：含窗口外
        let all = scan_usage_with(&root, None, now(), Budget::default());
        assert_eq!(all.totals.bucket.total, 11099);
        assert_eq!(all.totals.active_days, 3);
        assert_eq!(all.totals.current_streak, 2, "中间断了 7 天，当前连的只有今天与昨天");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn derived_stats_cover_cache_rate_and_streaks() {
        let root = tmp_root("derived");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo"),
                // 连续三天（今天 / 昨天 / 前天）+ 五天前断一天
                line_assistant(ts(2026, 9, 16, 9), Some(usage_json(100, 10, 300))),
                line_assistant(ts(2026, 9, 15, 9), Some(usage_json(100, 10, 0))),
                line_assistant(ts(2026, 9, 14, 9), Some(usage_json(100, 10, 0))),
                line_assistant(ts(2026, 9, 11, 9), Some(usage_json(100, 10, 0))),
            ],
        );
        let stats = scan_usage_with(&root, None, now(), Budget::default());
        let t = &stats.totals;
        assert_eq!(t.active_days, 4);
        assert_eq!(t.current_streak, 3, "今天 / 昨天 / 前天连成 3 天");
        assert_eq!(t.longest_streak, 3);
        // 命中率 = cacheRead / (input + cacheRead) = 300 / 700
        assert!((t.cache_hit_rate.unwrap() - 300.0 / 700.0).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn cache_hit_rate_is_null_without_denominator() {
        let root = tmp_root("rate");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo"),
                // 只有输出 token：命中率没有分母（界面显示 —），但用量本身有效
                line_assistant(ts(2026, 9, 16, 9), Some(usage_json(0, 50, 0))),
            ],
        );
        let stats = scan_usage_with(&root, Some(1), now(), Budget::default());
        assert_eq!(stats.totals.bucket.calls, 1);
        assert_eq!(stats.totals.bucket.total, 50);
        assert_eq!(stats.totals.cache_hit_rate, None);
        let _ = std::fs::remove_dir_all(&root);
    }

    // ---------- 预算与异常 ----------

    #[test]
    fn budget_exhaustion_sets_truncated() {
        let root = tmp_root("budget");
        for i in 0..3 {
            write_session(
                &root,
                "--tmp-demo--",
                &format!("s{i}.jsonl"),
                &[
                    line_session(&format!("sid-{i}"), "/tmp/demo"),
                    line_assistant(ts(2026, 9, 16, 9), Some(usage_json(10, 0, 0))),
                ],
            );
        }
        let cut = scan_usage_with(&root, None, now(), Budget { max_files: 1, ..Budget::default() });
        assert!(cut.truncated, "文件数超预算要明说可能不全");
        assert_eq!(cut.scanned_files, 1);
        assert_eq!(cut.totals.bucket.calls, 1);

        let tiny_bytes = scan_usage_with(&root, None, now(), Budget { max_bytes: 1, ..Budget::default() });
        assert!(tiny_bytes.truncated);
        assert_eq!(tiny_bytes.totals.bucket.calls, 0, "预算到点即停，不硬扫");

        let no_time = scan_usage_with(&root, None, now(), Budget { max_ms: 0, ..Budget::default() });
        assert!(no_time.truncated, "时间预算到点也要说可能不全");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn malformed_lines_and_missing_dir_are_ignored() {
        let root = tmp_root("bad");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                "这不是 JSON".to_string(),
                line_session("sid-1", "/tmp/demo"),
                "{\"type\":\"message\",\"message\":{\"role\":\"assistant\",\"content\":[],\"usage\":{\"input\":9}".to_string(),
                line_assistant(ts(2026, 9, 16, 9), Some(usage_json(10, 5, 0))),
            ],
        );
        let stats = scan_usage_with(&root, None, now(), Budget::default());
        assert_eq!(stats.totals.bucket.calls, 1, "坏行跳过，好行照算");
        assert_eq!(stats.totals.bucket.total, 15);
        // sessions 目录不存在：返回空统计而不是报错
        let empty = scan_usage_with(Path::new("/tmp/omp-usage-definitely-missing"), None, now(), Budget::default());
        assert_eq!(empty.totals.bucket.calls, 0);
        assert_eq!(empty.scanned_files, 0);
        assert_eq!(empty.totals.active_days, 0);
        assert_eq!(empty.totals.cache_hit_rate, None);
        assert_eq!(empty.totals.current_streak, 0);
        // 热力图即使一条数据都没有，也给出完整日历（全零格）
        assert_eq!(empty.heat.last().unwrap().date, "2026-09-16");
        assert!(empty.heat.iter().all(|h| h.total == 0));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn non_jsonl_files_and_lock_files_are_skipped() {
        let root = tmp_root("extra");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[line_session("sid-1", "/tmp/demo"), line_assistant(ts(2026, 9, 16, 9), Some(usage_json(1, 1, 0)))],
        );
        std::fs::write(root.join("--tmp-demo--/.s1.jsonl.lock.os"), "lock").unwrap();
        std::fs::write(root.join("--tmp-demo--/notes.txt"), "非 jsonl").unwrap();
        let stats = scan_usage_with(&root, None, now(), Budget::default());
        assert_eq!(stats.scanned_files, 1, "只扫 .jsonl");
        assert_eq!(stats.totals.bucket.calls, 1);
        let _ = std::fs::remove_dir_all(&root);
    }

    /// 真机数据基准（默认跳过，避免 CI 依赖本机数据）：
    /// `OMP_BENCH=1 cargo test --manifest-path src-tauri/Cargo.toml scans_real -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn scans_real_agent_dir_for_bench() {
        if std::env::var("OMP_BENCH").ok().as_deref() != Some("1") {
            return;
        }
        let agent = crate::session_scan::resolve_agent_dir(None);
        let started = std::time::Instant::now();
        let stats = scan_usage_in(&agent.join("sessions"), None, Local::now());
        println!(
            "扫描 {} 个文件，耗时 {}ms，truncated={}；token 合计 {}（输入 {} / 输出 {} / 缓存读 {}），请求 {}，活跃 {} 天（连续 {} / 最长 {}），命中率 {:?}",
            stats.scanned_files,
            started.elapsed().as_millis(),
            stats.truncated,
            stats.totals.bucket.total,
            stats.totals.bucket.input,
            stats.totals.bucket.output,
            stats.totals.bucket.cache_read,
            stats.totals.bucket.calls,
            stats.totals.active_days,
            stats.totals.current_streak,
            stats.totals.longest_streak,
            stats.totals.cache_hit_rate,
        );
        assert!(stats.scanned_files > 0, "本机应有会话数据（没有就跑不出基准）");
    }
}
