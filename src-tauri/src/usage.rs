//! 使用统计（Usage）：把 omp 本地会话记录里的 token / 费用 / 工具调用聚合成设置页的统计面。
//!
//! 上游事实（omp 18.x 实测，明细见 `docs/v5-schedule.md`）：
//! - 用量真值只在 jsonl 的 **assistant 消息**里：`message.usage` =
//!   `{input, output, cacheRead, cacheWrite, totalTokens, reasoningTokens, cost{input,output,cacheRead,cacheWrite,total}}`，
//!   且实测逐条满足 `totalTokens = input + output + cacheRead + cacheWrite`
//!   （`input` 是**未缓存**输入，缓存读 / 写单独成项）。
//! - `message.timestamp` 是**毫秒数字**（不是 ISO 串）；`message.duration`（毫秒）是这次请求的模型耗时。
//! - 工具调用在 `message.content` 的 `{type:"toolCall", name}` 块里——按请求计数，不需要再读 custom 行。
//! - 会话 cwd 在 jsonl 的 `session` 行（实测在文件第 2 行附近，**不在首行**），归属项目仍走
//!   [`owner_project`]（与左栏 / 归档面同一条规则），所以统计的「按项目」与界面分组一致。
//! - `cost` 是 omp 按模型定价算出的美元值；本地模型 / 无定价时恒为 0（界面据此整块隐藏费用展示）。
//!
//! 扫描是**全量**的：时间范围内的每一条 assistant 消息都要计入，所以不能像列表那样只看文件头尾。
//! 保护手段与 `search_sessions` 同款——文件数 / 字节 / 墙钟三道预算，任何一道到点即停并把
//! `truncated` 置 true（**宁可说「可能不全」，不假装统计完了**）。行级预筛（先看原始行里有没有
//! `"usage"` / `"toolCall"` 再解析 JSON）让真实目录（29MB）的整轮扫描保持在百毫秒级。
//!
//! 纯逻辑（行解析、按日 / 模型 / 工具 / 时段聚合、范围过滤、连续天数、补零天）与真实文件行为
//! （扫描临时目录、预算截断、缺失目录）都有单测。

use chrono::{DateTime, Days, Local, NaiveDate};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use tauri::State;

use crate::commands::{owner_project, AppState, CmdError};

/// 扫描文件数上限（按 mtime 取最近的一批，旧的先放弃）。
const SCAN_MAX_FILES: usize = 3000;
/// 读取字节上限。真实 sessions 目录 ~29MB，留足余量；到点即停并置 `truncated`。
const SCAN_MAX_BYTES: u64 = 256 * 1024 * 1024;
/// 墙钟时间上限（毫秒）。
const SCAN_MAX_MS: u64 = 5000;
/// 「按工具」最多返回多少项（长尾折叠，前端只需 Top N）。
const TOOLS_MAX: usize = 20;
/// 每日趋势最多补多少天（一年以上历史只画最近这一段，避免柱子密到不可读）。
const CHART_MAX_DAYS: usize = 120;
/// 读会话 cwd 时只看文件头这么多字节（`session` 行就在开头几行）。
const META_HEAD_BYTES: u64 = 32 * 1024;

// ---------- 视图类型 ----------

/// 一组用量数字（总量 / 单日 / 单模型共用同一形状，前端一套渲染）。
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageBucket {
    /// 未缓存输入 token。
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    /// 推理 token（是 `output` 的子集，只作展示，不参与 `total`）。
    pub reasoning: u64,
    /// omp 的 `totalTokens` 累加（= input + output + cacheRead + cacheWrite）。
    pub total: u64,
    /// 费用（美元）；omp 没给定价时为 0。
    pub cost: f64,
    /// 请求数（带 usage 的 assistant 消息条数）。
    pub calls: u64,
}

impl UsageBucket {
    fn add(&mut self, u: &MsgUsage) {
        self.input += u.input;
        self.output += u.output;
        self.cache_read += u.cache_read;
        self.cache_write += u.cache_write;
        self.reasoning += u.reasoning;
        self.total += u.total;
        self.cost += u.cost;
        self.calls += 1;
    }
}

/// 一天的量（`date` = 本地日期 `YYYY-MM-DD`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDayRow {
    pub date: String,
    #[serde(flatten)]
    pub bucket: UsageBucket,
}

/// 一个模型的量（`provider` / `model` 原样来自 jsonl）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageModelRow {
    pub provider: String,
    pub model: String,
    #[serde(flatten)]
    pub bucket: UsageBucket,
}

/// 一个项目的量（归属规则与左栏一致；未归属的 `projectId` 为 null）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageProjectRow {
    pub project_id: Option<String>,
    /// 会话 cwd（读不到为 null）。
    pub path: Option<String>,
    /// 展示名：命中覆盖层项目取项目名，否则路径末段；都没有为空串（前端兜「未归属」）。
    pub name: String,
    pub sessions: u64,
    pub calls: u64,
    pub total: u64,
    pub cost: f64,
}

/// 一个工具的调用次数。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageToolRow {
    pub name: String,
    pub count: u64,
}

/// 一个本地小时的量（0–23）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageHourRow {
    pub hour: u32,
    pub calls: u64,
    pub tokens: u64,
}

/// 用量最多的模型（`share` = 占全部 token 的比例，0–1）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTopModel {
    pub provider: String,
    pub model: String,
    pub tokens: u64,
    pub share: f64,
}

/// 范围总览。派生指标（命中率 / 活跃天数 / 连续天数 / 日均 / 峰值时段 / 最常用模型）
/// 一律在**后端**算好——前端只做格式化，不自算统计（与 `omp-state` 同一条口径）。
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageTotals {
    #[serde(flatten)]
    pub bucket: UsageBucket,
    /// 有请求的会话数。
    pub sessions: u64,
    pub tool_calls: u64,
    /// 模型耗时合计（毫秒，omp `duration` 原值累加）。
    pub duration_ms: u64,
    /// 范围内有请求的天数。
    pub active_days: u64,
    /// 连续活跃天数（今天还没跑但昨天跑了不断签，GitHub 口径）。
    pub current_streak: u64,
    /// 范围内最长连续活跃天数。
    pub longest_streak: u64,
    /// 缓存命中率 = cacheRead / (input + cacheRead)；分母为 0 时 null。
    pub cache_hit_rate: Option<f64>,
    /// 日均 token（按活跃天数摊）。
    pub avg_daily_tokens: u64,
    /// token 最多的本地小时（0–23）；范围内无数据时 null。
    pub peak_hour: Option<u32>,
    pub peak_hour_tokens: u64,
    pub top_model: Option<UsageTopModel>,
}

/// 使用统计整体回包。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageStats {
    pub totals: UsageTotals,
    /// 每日趋势（按日期升序、**补零天**，最多 `chartDays` 天）。
    pub by_day: Vec<UsageDayRow>,
    pub by_model: Vec<UsageModelRow>,
    pub by_project: Vec<UsageProjectRow>,
    pub by_tool: Vec<UsageToolRow>,
    pub by_hour: Vec<UsageHourRow>,
    pub scanned_files: usize,
    pub scanned_sessions: usize,
    /// 因预算提前收手（文件数 / 字节 / 时间任一），统计可能不全。
    pub truncated: bool,
    /// 本次范围天数（null = 全部）。
    pub range_days: Option<u32>,
    /// 每日趋势实际覆盖的天数（`by_day.len()`，前端文案用它）。
    pub chart_days: usize,
}

// ---------- 行解析（纯函数，可测） ----------

/// 一条 assistant 消息里的用量（omp `message.usage` 原值；缺失字段按 0）。
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct MsgUsage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write: u64,
    pub reasoning: u64,
    pub total: u64,
    pub cost: f64,
}

/// 一行 jsonl 里我们关心的东西。
#[derive(Debug, Clone, PartialEq)]
pub struct ParsedMsg {
    /// 消息时间（毫秒）。
    pub ts_ms: i64,
    /// 模型来源（jsonl 原值；缺失为空串，聚合时归入「未知模型」组）。
    pub provider: String,
    pub model: String,
    /// 有 usage 才有（没有 usage 的 assistant 消息只贡献工具计数）。
    pub usage: Option<MsgUsage>,
    /// 本条消息里的工具调用名（按顺序）。
    pub tools: Vec<String>,
    /// 模型耗时（毫秒，`message.duration`）。
    pub duration_ms: u64,
}

fn u64_of(v: Option<&serde_json::Value>) -> u64 {
    v.and_then(|x| x.as_u64()).unwrap_or(0)
}

fn f64_of(v: Option<&serde_json::Value>) -> f64 {
    v.and_then(|x| x.as_f64()).unwrap_or(0.0)
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
    MsgUsage {
        input,
        output,
        cache_read,
        cache_write,
        reasoning: u64_of(v.get("reasoningTokens")),
        total,
        cost: f64_of(v.get("cost").and_then(|c| c.get("total"))),
    }
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
    let mut tools = vec![];
    if let Some(blocks) = m.get("content").and_then(|c| c.as_array()) {
        for b in blocks {
            if b.get("type").and_then(|t| t.as_str()) == Some("toolCall") {
                if let Some(n) = b.get("name").and_then(|n| n.as_str()) {
                    tools.push(n.to_string());
                }
            }
        }
    }
    Some(ParsedMsg {
        ts_ms,
        provider: m.get("provider").and_then(|p| p.as_str()).unwrap_or("").to_string(),
        model: m.get("model").and_then(|p| p.as_str()).unwrap_or("").to_string(),
        usage: m.get("usage").map(parse_usage),
        tools,
        duration_ms: u64_of(m.get("duration")),
    })
}

/// 本地日期（`YYYY-MM-DD`）——按用户所在时区归档，与界面上的「今天」一致。
fn local_date(ms: i64) -> Option<String> {
    let dt = DateTime::from_timestamp_millis(ms)?;
    Some(dt.with_timezone(&Local).format("%Y-%m-%d").to_string())
}

fn local_hour(ms: i64) -> Option<u32> {
    let dt = DateTime::from_timestamp_millis(ms)?;
    Some(dt.with_timezone(&Local).format("%H").to_string().parse().ok()?)
}

// ---------- 会话头（cwd / id） ----------

/// 读 jsonl 头部，取 `session` 行的 `(id, cwd)`。
///
/// 会话行不在首行（实测前面还有一条 `title` 行），所以按行扫前 [`META_HEAD_BYTES`]：
/// 只读这一小段，避免为拿一个 cwd 去读整个几十 MB 的文件。
pub fn read_session_meta(path: &Path) -> Option<(String, String)> {
    use std::io::{BufRead, BufReader, Read};
    let f = std::fs::File::open(path).ok()?;
    let mut head = Vec::new();
    f.take(META_HEAD_BYTES).read_to_end(&mut head).ok()?;
    for line in BufReader::new(&head[..]).lines() {
        let Ok(line) = line else { break };
        let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) else { continue };
        if v.get("type").and_then(|t| t.as_str()) == Some("session") {
            return Some((
                v.get("id").and_then(|i| i.as_str()).unwrap_or("").to_string(),
                v.get("cwd").and_then(|c| c.as_str()).unwrap_or("").to_string(),
            ));
        }
    }
    None
}

// ---------- 扫描 ----------

/// 一个项目分组的聚合中间态（`key` = 项目 id，未归属时是 cwd 本身）。
#[derive(Debug, Default)]
struct ProjectAgg {
    sessions: HashSet<String>,
    calls: u64,
    total: u64,
    cost: f64,
    name: String,
    path: Option<String>,
    project_id: Option<String>,
}

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
pub fn scan_usage_in(
    root: &Path,
    projects: &[(String, String)],
    days: Option<u32>,
    now: DateTime<Local>,
) -> UsageStats {
    scan_usage_with(root, projects, days, now, Budget::default())
}

fn scan_usage_with(
    root: &Path,
    projects: &[(String, String)],
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
    let mut by_model: HashMap<(String, String), UsageBucket> = HashMap::new();
    let mut by_tool: HashMap<String, u64> = HashMap::new();
    let mut by_hour: Vec<(u64, u64)> = vec![(0, 0); 24];
    let mut sessions: HashSet<String> = HashSet::new();
    let mut by_project: HashMap<String, ProjectAgg> = HashMap::new();

    for (_mtime, path) in files.into_iter().take(budget.max_files) {
        if bytes_read >= budget.max_bytes || started.elapsed().as_millis() as u64 >= budget.max_ms {
            truncated = true;
            break;
        }
        let Ok(file) = std::fs::File::open(&path) else { continue };
        scanned_files += 1;
        // 会话归属只在真有命中行的文件上取一次头（懒加载，预算用在刀刃上）
        let mut group: Option<String> = None;
        let reader = std::io::BufReader::new(file);
        for line in std::io::BufRead::lines(reader) {
            let Ok(line) = line else { break };
            bytes_read += line.len() as u64 + 1;
            if bytes_read > budget.max_bytes {
                truncated = true;
                break;
            }
            // 行级预筛：绝大多数行（用户消息 / 工具结果 / 标题变更）连解析都不用做
            if !line.contains("\"usage\"") && !line.contains("\"toolCall\"") {
                continue;
            }
            let Some(msg) = parse_message_line(&line) else { continue };
            let Some(date) = local_date(msg.ts_ms) else { continue };
            if let Some(c) = &cutoff {
                if &date < c {
                    continue;
                }
            }
            if group.is_none() {
                group = Some(register_session(&path, projects, &mut sessions, &mut by_project));
            }
            totals.tool_calls += msg.tools.len() as u64;
            for t in &msg.tools {
                *by_tool.entry(t.clone()).or_insert(0) += 1;
            }
            totals.duration_ms += msg.duration_ms;
            let Some(u) = msg.usage else { continue };
            totals.bucket.add(&u);
            by_day.entry(date.clone()).or_default().add(&u);
            by_model
                .entry((msg.provider.clone(), msg.model.clone()))
                .or_default()
                .add(&u);
            if let Some(g) = group.as_ref().and_then(|k| by_project.get_mut(k)) {
                g.calls += 1;
                g.total += u.total;
                g.cost += u.cost;
            }
            if let Some(h) = local_hour(msg.ts_ms) {
                let slot = &mut by_hour[h as usize];
                slot.0 += 1;
                slot.1 += u.total;
            }
        }
        if started.elapsed().as_millis() as u64 >= budget.max_ms {
            truncated = true;
            break;
        }
    }

    let day_rows = fill_days(&by_day, days, today);
    let models = model_rows(by_model);
    let top_model = models
        .first()
        .filter(|r| r.bucket.total > 0)
        .map(|r| UsageTopModel {
            provider: r.provider.clone(),
            model: r.model.clone(),
            tokens: r.bucket.total,
            share: r.bucket.total as f64 / totals.bucket.total.max(1) as f64,
        });
    let mut totals = finish_totals(totals, &by_day, &by_hour, sessions.len() as u64, today);
    totals.top_model = top_model;
    UsageStats {
        totals,
        chart_days: day_rows.len(),
        by_day: day_rows,
        by_model: models,
        by_project: project_rows(by_project),
        by_hour: hour_rows(&by_hour),
        by_tool: tool_rows(by_tool),
        scanned_files,
        scanned_sessions: sessions.len(),
        truncated,
        range_days: days,
    }
}

/// 第一次在某个文件里命中统计行时登记它的会话与项目分组（返回分组键）。
fn register_session(
    path: &Path,
    projects: &[(String, String)],
    sessions: &mut HashSet<String>,
    by_project: &mut HashMap<String, ProjectAgg>,
) -> String {
    let meta = read_session_meta(path);
    let sid = meta
        .as_ref()
        .map(|m| m.0.clone())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| {
            path.file_stem().and_then(|s| s.to_str()).unwrap_or("unknown").to_string()
        });
    sessions.insert(sid.clone());
    let cwd = meta.as_ref().map(|m| m.1.clone()).filter(|c| !c.is_empty());
    let pid = cwd.as_deref().and_then(|c| owner_project(projects, c));
    let key = pid.clone().unwrap_or_else(|| cwd.clone().unwrap_or_default());
    let entry = by_project.entry(key.clone()).or_insert_with(|| ProjectAgg {
        name: project_name(projects, pid.as_deref(), cwd.as_deref()),
        project_id: pid.clone(),
        path: cwd.clone(),
        ..Default::default()
    });
    entry.sessions.insert(sid);
    key
}

/// 项目展示名：命中覆盖层项目 → 项目名（路径末段）；否则 cwd 末段；都没有空串。
fn project_name(projects: &[(String, String)], pid: Option<&str>, cwd: Option<&str>) -> String {
    if let Some(id) = pid {
        if let Some((_, path)) = projects.iter().find(|(p, _)| p == id) {
            return base_name(path);
        }
    }
    cwd.map(base_name).unwrap_or_default()
}

fn base_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn model_rows(by_model: HashMap<(String, String), UsageBucket>) -> Vec<UsageModelRow> {
    let mut rows: Vec<UsageModelRow> = by_model
        .into_iter()
        .map(|((provider, model), bucket)| UsageModelRow { provider, model, bucket })
        .collect();
    rows.sort_by(|a, b| {
        b.bucket.total.cmp(&a.bucket.total).then_with(|| a.model.cmp(&b.model))
    });
    rows
}

fn project_rows(by_project: HashMap<String, ProjectAgg>) -> Vec<UsageProjectRow> {
    let mut rows: Vec<UsageProjectRow> = by_project
        .into_values()
        .map(|g| UsageProjectRow {
            project_id: g.project_id,
            path: g.path,
            name: g.name,
            sessions: g.sessions.len() as u64,
            calls: g.calls,
            total: g.total,
            cost: g.cost,
        })
        .collect();
    rows.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.name.cmp(&b.name)));
    rows
}

fn tool_rows(by_tool: HashMap<String, u64>) -> Vec<UsageToolRow> {
    let mut rows: Vec<UsageToolRow> = by_tool
        .into_iter()
        .map(|(name, count)| UsageToolRow { name, count })
        .collect();
    rows.sort_by(|a, b| b.count.cmp(&a.count).then_with(|| a.name.cmp(&b.name)));
    rows.truncate(TOOLS_MAX);
    rows
}

fn hour_rows(by_hour: &[(u64, u64)]) -> Vec<UsageHourRow> {
    by_hour
        .iter()
        .enumerate()
        .map(|(h, (calls, tokens))| UsageHourRow {
            hour: h as u32,
            calls: *calls,
            tokens: *tokens,
        })
        .collect()
}

/// 每日趋势：范围内**补零天**（没跑的日子也要有柱子，趋势才连续）；
/// 下界取范围起点，`all` 取最早有数据的一天；最多 [`CHART_MAX_DAYS`] 天（保留最近的一段）。
fn fill_days(by_day: &BTreeMap<String, UsageBucket>, days: Option<u32>, today: NaiveDate) -> Vec<UsageDayRow> {
    // 一条数据都没有（且不限范围）时不造「今天」这根空柱——空态交给前端说
    if days.is_none() && by_day.is_empty() {
        return vec![];
    }
    let mut from = match days {
        Some(d) => today - Days::new(d.saturating_sub(1) as u64),
        None => by_day
            .keys()
            .next()
            .and_then(|k| NaiveDate::parse_from_str(k, "%Y-%m-%d").ok())
            .unwrap_or(today),
    };
    let min_from = today - Days::new(CHART_MAX_DAYS as u64 - 1);
    if from < min_from {
        from = min_from;
    }
    let mut out = vec![];
    let mut cur = from;
    while cur <= today {
        let key = cur.format("%Y-%m-%d").to_string();
        let bucket = by_day.get(&key).cloned().unwrap_or_default();
        out.push(UsageDayRow { date: key, bucket });
        cur = cur + Days::new(1);
    }
    out
}

/// 收尾：从 by_day / by_hour 派生连续天数、峰值时段、命中率、日均与最常用模型。
fn finish_totals(
    mut totals: UsageTotals,
    by_day: &BTreeMap<String, UsageBucket>,
    by_hour: &[(u64, u64)],
    sessions: u64,
    today: NaiveDate,
) -> UsageTotals {
    totals.sessions = sessions;
    let active: Vec<NaiveDate> = by_day
        .iter()
        .filter(|(_, b)| b.calls > 0)
        .filter_map(|(k, _)| NaiveDate::parse_from_str(k, "%Y-%m-%d").ok())
        .collect();
    totals.active_days = active.len() as u64;
    totals.longest_streak = longest_streak(&active);
    totals.current_streak = current_streak(&active, today);
    let denom = totals.bucket.input + totals.bucket.cache_read;
    totals.cache_hit_rate =
        if denom > 0 { Some(totals.bucket.cache_read as f64 / denom as f64) } else { None };
    totals.avg_daily_tokens =
        if totals.active_days > 0 { totals.bucket.total / totals.active_days } else { 0 };
    if let Some((idx, (_, tokens))) = by_hour
        .iter()
        .enumerate()
        .filter(|(_, (_, t))| *t > 0)
        .max_by_key(|(_, (_, t))| *t)
    {
        totals.peak_hour = Some(idx as u32);
        totals.peak_hour_tokens = *tokens;
    }
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

// ---------- 命令 ----------

/// 使用统计：扫会话 jsonl 聚合用量（范围可选：1 / 7 / 30 天，null = 全部）。
#[tauri::command]
pub async fn get_usage_stats(
    state: State<'_, AppState>,
    days: Option<u32>,
) -> Result<UsageStats, CmdError> {
    let agent = state.agent_dir.lock().await.clone();
    let projects: Vec<(String, String)> = {
        let ov = state.overlay.lock().await;
        ov.projects.iter().map(|p| (p.id.clone(), p.path.clone())).collect()
    };
    let days = days.map(|d| d.clamp(1, 3650));
    Ok(scan_usage_in(&agent.join("sessions"), &projects, days, Local::now()))
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

    fn line_assistant(
        ts_ms: i64,
        provider: &str,
        model: &str,
        usage: Option<serde_json::Value>,
        tools: &[&str],
    ) -> String {
        let content: Vec<serde_json::Value> = tools
            .iter()
            .map(|n| serde_json::json!({"type": "toolCall", "id": "c1", "name": n, "arguments": {}}))
            .collect();
        let mut m = serde_json::json!({
            "role": "assistant", "content": content, "provider": provider, "model": model,
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

    fn projects(list: &[(&str, &str)]) -> Vec<(String, String)> {
        list.iter().map(|(id, p)| (id.to_string(), p.to_string())).collect()
    }

    // ---------- 行解析 ----------

    #[test]
    fn parse_line_reads_usage_tools_and_timestamp() {
        let line = line_assistant(
            ts(2026, 9, 16, 9),
            "anthropic",
            "claude-sonnet-4",
            Some(usage_json(100, 20, 300)),
            &["read", "edit"],
        );
        let msg = parse_message_line(&line).expect("assistant 行应被解析");
        assert_eq!(msg.ts_ms, ts(2026, 9, 16, 9));
        assert_eq!(msg.duration_ms, 1500);
        assert_eq!(msg.tools, vec!["read".to_string(), "edit".to_string()]);
        let u = msg.usage.expect("有 usage");
        assert_eq!((u.input, u.output, u.cache_read, u.total, u.reasoning), (100, 20, 300, 420, 7));
        assert!((u.cost - 0.0031).abs() < 1e-9);

        // 缺 totalTokens 的老数据按四段之和兜底；ISO 顶层时间戳也能兜
        let old = serde_json::json!({
            "type": "message", "timestamp": "2026-09-16T01:00:00.000Z",
            "message": {"role": "assistant", "content": [], "usage": {"input": 5, "output": 6, "cacheRead": 7, "cacheWrite": 8}}
        })
        .to_string();
        let msg = parse_message_line(&old).expect("老数据也要认");
        assert_eq!(msg.usage.unwrap().total, 26, "totalTokens 缺失时按四段之和");
        assert_eq!(msg.ts_ms, ts(2026, 9, 16, 9), "退回顶层 ISO 时间戳");

        // 非 assistant / 非 message / 无时间的行一律不认
        assert!(parse_message_line(&line_user(ts(2026, 9, 16, 9))).is_none());
        assert!(parse_message_line("{\"type\":\"custom\",\"customType\":\"tool_execution_start\"}").is_none());
        assert!(parse_message_line("不是 JSON").is_none());
        let no_ts = serde_json::json!({"type": "message", "message": {"role": "assistant", "content": [], "usage": {"input": 1}}})
            .to_string();
        assert!(parse_message_line(&no_ts).is_none(), "没有时间就无法归档到某一天");
    }

    #[test]
    fn session_meta_reads_cwd_from_head_after_title_line() {
        let root = tmp_root("meta");
        let f = root.join("a.jsonl");
        std::fs::write(
            &f,
            format!("{}\n{}\n", line_title(), line_session("sid-1", "/tmp/proj")),
        )
        .unwrap();
        assert_eq!(read_session_meta(&f), Some(("sid-1".to_string(), "/tmp/proj".to_string())));
        // 没有 session 行的文件（损坏 / 空）不报错，交给调用方兜文件名
        std::fs::write(root.join("b.jsonl"), "无关行\n").unwrap();
        assert_eq!(read_session_meta(&root.join("b.jsonl")), None);
        let _ = std::fs::remove_dir_all(&root);
    }

    // ---------- 聚合 ----------

    #[test]
    fn scan_aggregates_totals_days_models_tools_and_hours() {
        let root = tmp_root("agg");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_title(),
                line_session("sid-1", "/tmp/demo"),
                line_user(ts(2026, 9, 16, 9)),
                line_assistant(ts(2026, 9, 16, 9), "anthropic", "sonnet", Some(usage_json(100, 20, 300)), &["read"]),
                line_assistant(ts(2026, 9, 16, 15), "anthropic", "sonnet", Some(usage_json(200, 30, 0)), &["bash", "read"]),
                // 没有 usage 的 assistant 行：只贡献工具计数
                line_assistant(ts(2026, 9, 16, 15), "anthropic", "sonnet", None, &["grep"]),
            ],
        );
        write_session(
            &root,
            "--tmp-other--",
            "s2.jsonl",
            &[
                line_session("sid-2", "/tmp/other"),
                line_assistant(ts(2026, 9, 15, 10), "openai", "gpt-5", Some(usage_json(50, 10, 0)), &[]),
            ],
        );
        let stats = scan_usage_with(&root, &[], None, now(), Budget::default());
        assert_eq!(stats.scanned_files, 2);
        assert_eq!(stats.scanned_sessions, 2);
        assert!(!stats.truncated);
        assert_eq!(stats.totals.bucket.input, 350);
        assert_eq!(stats.totals.bucket.output, 60);
        assert_eq!(stats.totals.bucket.cache_read, 300);
        assert_eq!(stats.totals.bucket.total, 710, "total = input+output+cacheRead");
        assert_eq!(stats.totals.bucket.calls, 3);
        assert_eq!(stats.totals.tool_calls, 4, "含没有 usage 的那条消息里的工具调用");
        assert_eq!(stats.totals.duration_ms, 6000, "4 条 assistant 消息 × 1500ms（含没有 usage 的那条）");
        assert_eq!(stats.totals.active_days, 2);
        // 模型按 token 倒序：anthropic/sonnet 在前
        assert_eq!(stats.by_model.len(), 2);
        assert_eq!(stats.by_model[0].model, "sonnet");
        assert_eq!(stats.by_model[0].bucket.calls, 2);
        assert_eq!(stats.by_model[0].bucket.total, 650);
        // 工具按次数倒序
        assert_eq!(stats.by_tool[0].name, "read");
        assert_eq!(stats.by_tool[0].count, 2);
        assert_eq!(stats.by_tool.len(), 3);
        // 时段：按带 usage 的请求计数（没有 usage 的消息不进时段分布）
        assert_eq!(stats.by_hour[15].calls, 1);
        assert_eq!(stats.by_hour[9].calls, 1);
        let hour_calls: u64 = stats.by_hour.iter().map(|h| h.calls).sum();
        assert_eq!(hour_calls, stats.totals.bucket.calls, "时段分布的请求数应与总请求数一致");
        assert_eq!(stats.totals.peak_hour, Some(9), "9 点 420 token 多于 15 点的 230");
        assert_eq!(stats.totals.peak_hour_tokens, 420);
        // 每日趋势补到今天（9-15 起两天）
        assert_eq!(stats.by_day.len(), 2);
        assert_eq!(stats.by_day[0].date, "2026-09-15");
        assert_eq!(stats.by_day[1].date, "2026-09-16");
        assert_eq!(stats.by_day[1].bucket.total, 650);
        assert_eq!(stats.chart_days, 2);
        assert_eq!(stats.range_days, None);
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
                line_assistant(ts(2026, 9, 16, 8), "anthropic", "sonnet", Some(usage_json(1000, 0, 0)), &[]),
                // 昨天（近 7 日内）
                line_assistant(ts(2026, 9, 15, 8), "anthropic", "sonnet", Some(usage_json(100, 0, 0)), &[]),
                // 10 天前（窗口外）
                line_assistant(ts(2026, 9, 6, 8), "anthropic", "sonnet", Some(usage_json(9999, 0, 0)), &[]),
            ],
        );
        let stats = scan_usage_with(&root, &[], Some(7), now(), Budget::default());
        assert_eq!(stats.totals.bucket.total, 1100, "窗口外的 9999 不能计入");
        assert_eq!(stats.totals.bucket.calls, 2);
        assert_eq!(stats.by_day.len(), 7, "近 7 日要补满 7 天");
        assert_eq!(stats.by_day[0].date, "2026-09-10");
        assert_eq!(stats.by_day.last().unwrap().date, "2026-09-16");
        assert_eq!(stats.totals.active_days, 2);
        assert_eq!(stats.range_days, Some(7));

        // 「今日」= 只有今天
        let today = scan_usage_with(&root, &[], Some(1), now(), Budget::default());
        assert_eq!(today.totals.bucket.total, 1000);
        assert_eq!(today.by_day.len(), 1);

        // 全部：含窗口外，趋势仍只画最近 CHART_MAX_DAYS 天
        let all = scan_usage_with(&root, &[], None, now(), Budget::default());
        assert_eq!(all.totals.bucket.total, 11099);
        assert_eq!(all.by_day.len(), 11, "9-06 到 9-16 共 11 天");
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn derived_stats_cover_cache_rate_streaks_and_top_model() {
        let root = tmp_root("derived");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo"),
                // 连续三天（今天 / 昨天 / 前天）+ 五天前断一天
                line_assistant(ts(2026, 9, 16, 9), "anthropic", "sonnet", Some(usage_json(100, 10, 300)), &[]),
                line_assistant(ts(2026, 9, 15, 9), "anthropic", "sonnet", Some(usage_json(100, 10, 0)), &[]),
                line_assistant(ts(2026, 9, 14, 9), "openai", "gpt-5", Some(usage_json(100, 10, 0)), &[]),
                line_assistant(ts(2026, 9, 11, 9), "openai", "gpt-5", Some(usage_json(100, 10, 0)), &[]),
            ],
        );
        let stats = scan_usage_with(&root, &[], None, now(), Budget::default());
        let t = &stats.totals;
        assert_eq!(t.active_days, 4);
        assert_eq!(t.current_streak, 3, "今天 / 昨天 / 前天连成 3 天");
        assert_eq!(t.longest_streak, 3);
        // 命中率 = cacheRead / (input + cacheRead) = 300 / 700
        assert!((t.cache_hit_rate.unwrap() - 300.0 / 700.0).abs() < 1e-9);
        assert_eq!(t.avg_daily_tokens, t.bucket.total / 4);
        let top = t.top_model.as_ref().unwrap();
        assert_eq!(top.model, "sonnet");
        assert_eq!(top.tokens, 410 + 110, "sonnet 两次请求的 token 合计");
        assert!((top.share - top.tokens as f64 / t.bucket.total as f64).abs() < 1e-9);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn project_rows_use_cwd_attribution_and_group_unowned() {
        let root = tmp_root("project");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[
                line_session("sid-1", "/tmp/demo/sub"),
                line_assistant(ts(2026, 9, 16, 9), "anthropic", "sonnet", Some(usage_json(100, 0, 0)), &[]),
            ],
        );
        write_session(
            &root,
            "--tmp-demo--",
            "s2.jsonl",
            &[
                line_session("sid-2", "/tmp/demo"),
                line_assistant(ts(2026, 9, 16, 10), "anthropic", "sonnet", Some(usage_json(300, 0, 0)), &[]),
            ],
        );
        write_session(
            &root,
            "--tmp-elsewhere--",
            "s3.jsonl",
            &[
                // 没有 cwd（会话行缺失）→ 未归属
                line_assistant(ts(2026, 9, 16, 11), "anthropic", "sonnet", Some(usage_json(50, 0, 0)), &[]),
            ],
        );
        let ps = projects(&[("p-demo", "/tmp/demo")]);
        let stats = scan_usage_with(&root, &ps, None, now(), Budget::default());
        assert_eq!(stats.by_project.len(), 2, "命中项目 + 未归属，共两组");
        let demo = stats.by_project.iter().find(|r| r.project_id.is_some()).unwrap();
        assert_eq!(demo.project_id.as_deref(), Some("p-demo"));
        assert_eq!(demo.name, "demo", "展示名取项目路径末段");
        assert_eq!(demo.sessions, 2, "子目录会话也算同一项目");
        assert_eq!(demo.total, 400);
        assert_eq!(demo.calls, 2);
        let orphan = stats.by_project.iter().find(|r| r.project_id.is_none()).unwrap();
        assert_eq!(orphan.path, None);
        assert_eq!(orphan.name, "", "没有 cwd 就没有展示名，由前端兜「未归属」");
        assert_eq!(orphan.sessions, 1);
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
                    line_assistant(ts(2026, 9, 16, 9), "anthropic", "sonnet", Some(usage_json(10, 0, 0)), &[]),
                ],
            );
        }
        let cut = scan_usage_with(
            &root,
            &[],
            None,
            now(),
            Budget { max_files: 1, ..Budget::default() },
        );
        assert!(cut.truncated, "文件数超预算要明说可能不全");
        assert_eq!(cut.scanned_files, 1);
        assert_eq!(cut.totals.bucket.calls, 1);

        let tiny_bytes = scan_usage_with(
            &root,
            &[],
            None,
            now(),
            Budget { max_bytes: 1, ..Budget::default() },
        );
        assert!(tiny_bytes.truncated);
        assert_eq!(tiny_bytes.totals.bucket.calls, 0, "预算到点即停，不硬扫");

        let no_time = scan_usage_with(
            &root,
            &[],
            None,
            now(),
            Budget { max_ms: 0, ..Budget::default() },
        );
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
                line_assistant(ts(2026, 9, 16, 9), "anthropic", "sonnet", Some(usage_json(10, 5, 0)), &[]),
            ],
        );
        let stats = scan_usage_with(&root, &[], None, now(), Budget::default());
        assert_eq!(stats.totals.bucket.calls, 1, "坏行跳过，好行照算");
        assert_eq!(stats.totals.bucket.total, 15);
        // sessions 目录不存在：返回空统计而不是报错
        let empty = scan_usage_with(
            Path::new("/tmp/omp-usage-definitely-missing"),
            &[],
            None,
            now(),
            Budget::default(),
        );
        assert_eq!(empty.totals.bucket.calls, 0);
        assert_eq!(empty.scanned_files, 0);
        assert!(empty.by_day.is_empty(), "没有数据就不补零天");
        assert_eq!(empty.totals.cache_hit_rate, None);
        assert_eq!(empty.totals.current_streak, 0);
        assert!(empty.totals.top_model.is_none());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn non_jsonl_files_and_lock_files_are_skipped() {
        let root = tmp_root("extra");
        write_session(
            &root,
            "--tmp-demo--",
            "s1.jsonl",
            &[line_session("sid-1", "/tmp/demo"), line_assistant(ts(2026, 9, 16, 9), "a", "m", Some(usage_json(1, 1, 0)), &[])],
        );
        std::fs::write(root.join("--tmp-demo--/.s1.jsonl.lock.os"), "lock").unwrap();
        std::fs::write(root.join("--tmp-demo--/notes.txt"), "非 jsonl").unwrap();
        let stats = scan_usage_with(&root, &[], None, now(), Budget::default());
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
        let stats = scan_usage_in(&agent.join("sessions"), &[], None, Local::now());
        println!(
            "扫描 {} 个文件 / {} 个会话，耗时 {}ms，truncated={}；token 合计 {}（输入 {} / 输出 {} / 缓存读 {}），请求 {}，工具 {}，费用 ${:.4}，最常用模型 {:?}",
            stats.scanned_files,
            stats.scanned_sessions,
            started.elapsed().as_millis(),
            stats.truncated,
            stats.totals.bucket.total,
            stats.totals.bucket.input,
            stats.totals.bucket.output,
            stats.totals.bucket.cache_read,
            stats.totals.bucket.calls,
            stats.totals.tool_calls,
            stats.totals.bucket.cost,
            stats.totals.top_model.as_ref().map(|m| format!("{}/{}", m.provider, m.model)),
        );
        assert!(stats.scanned_files > 0, "本机应有会话数据（没有就跑不出基准）");
    }
}
