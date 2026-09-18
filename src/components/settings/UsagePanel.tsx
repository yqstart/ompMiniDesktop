import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartBar, Loader, Refresh } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { heatLevel, heatThresholds, monthTicks } from "../../lib/usageHeat";
import type { UsageDayRow, UsageHeatRow, UsageStats } from "@shared/types";

/** 统计范围：与 ZCode 的「使用统计」同档（今日 / 近 7 日 / 近 30 日 / 全部）。 */
type RangeKey = "today" | "7d" | "30d" | "all";

const RANGES: { key: RangeKey; days: number | null }[] = [
  { key: "today", days: 1 },
  { key: "7d", days: 7 },
  { key: "30d", days: 30 },
  { key: "all", days: null },
];

/** 趋势图最多补多少天——与后端 `usage.rs` 的 `CHART_MAX_DAYS` 对齐。 */
const CHART_MAX_DAYS = 120;

/** token 数：过万转 K / M / B（密集表格里可读性优先），小数字走千分位。 */
function fmtTokens(n: number, locale: string): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
  return n.toLocaleString(locale);
}

/** 费用（美元，omp 定价估算）：满 1 元两位小数，小额给四位，避免显示成 $0.00。 */
function fmtCost(cost: number): string {
  if (cost <= 0) return "$0";
  return cost >= 1 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`;
}

/** 比例：≥10% 取整，小比例留一位小数。 */
function fmtPercent(x: number): string {
  return x >= 0.1 ? `${Math.round(x * 100)}%` : `${(x * 100).toFixed(1)}%`;
}

/** 一张总览卡：标签（11px faint）+ 数值（mono）+ 可选副行（过长换行，不截断关键数字）。 */
function Tile({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div className="min-w-0 rounded-lg bg-background p-4">
      <div className="text-[11px] leading-4 text-faint">{label}</div>
      <div className="mt-2 truncate font-mono text-[18px] font-medium tabular-nums" title={value}>
        {value}
      </div>
      {sub && <div className="mt-2 text-[11px] leading-relaxed text-muted">{sub}</div>}
    </div>
  );
}

/** 比例条（模型 / 工具 / 项目行共用）：细底槽 + accent 实心段。 */
function ShareBar({ ratio }: { ratio: number }) {
  return (
    <span className="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-active @min-[600px]/panel:w-20" aria-hidden>
      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
    </span>
  );
}

/**
 * 一根堆叠柱：自下而上 未缓存输入（accent/25）/ 缓存读·写（accent/50）/ 输出（accent）。
 * 柱高按「占峰值日的比例」缩放，段高按「占当日总量的比例」铺满柱体。
 */
function DayBar({ row, max, label }: { row: UsageDayRow; max: number; label: string }) {
  const sum = Math.max(row.total, 1);
  const segs = [
    { key: "out", value: row.output, cls: "bg-accent" },
    { key: "cache", value: row.cacheRead + row.cacheWrite, cls: "bg-accent/50" },
    { key: "in", value: row.input, cls: "bg-accent/25" },
  ].filter((s) => s.value > 0);
  return (
    <div role="img" aria-label={label} title={label} className="flex h-full flex-1 flex-col justify-end">
      {row.total > 0 && (
        <div
          className="mx-auto flex w-full max-w-[28px] flex-col overflow-hidden rounded-sm"
          style={{ height: `${(row.total / max) * 100}%`, minHeight: 2 }}
        >
          {segs.map((s) => (
            <div key={s.key} className={s.cls} style={{ height: `${(s.value / sum) * 100}%` }} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 热力图体格：11px 方格 + 2px 缝隙（53 列 ≈ 690px，窄容器横向滚动）；0 档空格 + 4 档 accent 由浅到深。 */
const HEAT_CELL = 11;
const HEAT_GAP = 2;
const HEAT_WEEKDAY_WIDTH = 28;
const HEAT_LEVEL_CLASS = ["bg-active", "bg-accent/20", "bg-accent/45", "bg-accent/70", "bg-accent"];

/**
 * 每日用量热力图（GitHub 贡献图口径）：一列一周（周日在最上）、一行一个星期，颜色越重用量越多。
 * 数据是后端给的最近 53 周（**不随范围切换**），这里只摆格子、分档与读数。
 * 悬停格子时读数在标题行右侧（与每日趋势同款），格子的 title 也带同一条读数。
 */
function Heatmap({ cells, numLocale }: { cells: UsageHeatRow[]; numLocale: string }) {
  const t = useText();
  const [hover, setHover] = useState<number | null>(null);
  const thresholds = useMemo(() => heatThresholds(cells.map((c) => c.total)), [cells]);
  const months = useMemo(() => monthTicks(cells, numLocale), [cells, numLocale]);
  // 2024-01-01 是周一：Mon / Wed / Fri 落在第 1 / 3 / 5 行，其余行留空
  const fmtWeekday = new Intl.DateTimeFormat(numLocale, { weekday: "short", timeZone: "UTC" });
  const weekdays = Array.from({ length: 7 }, (_, r) =>
    r === 1 || r === 3 || r === 5 ? fmtWeekday.format(Date.UTC(2024, 0, r)) : "",
  );
  const cols = Math.ceil(cells.length / 7);
  const hovered = hover === null ? undefined : cells[hover];

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-[13px] font-medium">{t.usageHeatTitle}</h3>
        <span className="text-[11px] text-faint">{t.usageHeatNote}</span>
        <span className="ml-auto font-mono text-[11px] text-faint">
          {hovered
            ? fmt(t.usageDayTotal, hovered.date, fmtTokens(hovered.total, numLocale), hovered.calls)
            : ""}
        </span>
      </div>
      <div className="mt-3 overflow-x-auto" onMouseLeave={() => setHover(null)}>
        <div role="img" aria-label={t.usageHeatTitle} className="w-max">
          <div
            className="grid"
            style={{
              marginLeft: HEAT_WEEKDAY_WIDTH + HEAT_GAP,
              gridTemplateColumns: `repeat(${cols}, ${HEAT_CELL}px)`,
              gap: HEAT_GAP,
            }}
          >
            {Array.from({ length: cols }, (_, c) => (
              <span key={c} className="whitespace-nowrap text-[10px] leading-3 text-faint">
                {months.find((m) => m.col === c)?.label ?? ""}
              </span>
            ))}
          </div>
          <div className="mt-1 flex" style={{ gap: HEAT_GAP }}>
            <div
              className="grid shrink-0"
              style={{ width: HEAT_WEEKDAY_WIDTH, gridTemplateRows: `repeat(7, ${HEAT_CELL}px)`, gap: HEAT_GAP }}
            >
              {weekdays.map((label, r) => (
                <span key={r} className="text-right text-[10px] leading-[11px] text-faint">
                  {label}
                </span>
              ))}
            </div>
            <div
              className="grid"
              style={{ gridTemplateRows: `repeat(7, ${HEAT_CELL}px)`, gridAutoFlow: "column", gap: HEAT_GAP }}
            >
              {cells.map((c, i) => (
                <div
                  key={c.date}
                  title={fmt(t.usageDayTotal, c.date, fmtTokens(c.total, numLocale), c.calls)}
                  onMouseEnter={() => setHover(i)}
                  className={`rounded-xs ${HEAT_LEVEL_CLASS[heatLevel(c.total, thresholds)]} ${
                    hover === i ? "ring-1 ring-foreground/40" : ""
                  }`}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <span className="font-mono text-[11px] text-faint">
          {cells.length > 1 ? `${cells[0].date} → ${cells[cells.length - 1].date}` : ""}
        </span>
        <span className="flex items-center gap-1 text-[11px] text-faint">
          {t.usageHeatLess}
          {HEAT_LEVEL_CLASS.map((cls) => (
            <span key={cls} className={`h-2.5 w-2.5 rounded-xs ${cls}`} aria-hidden />
          ))}
          {t.usageHeatMore}
        </span>
      </div>
    </>
  );
}

/**
 * 设置 ›「使用统计」：把 omp 本地会话记录里的用量聚合成一页只读统计。
 *
 * 口径（与 ZCode 的「使用统计」对齐，数据源换成 omp）：
 * - 数据来自会话 jsonl 里每条 assistant 消息的 `usage`，含已归档会话；
 * - 全部数字（含命中率 / 连续天数 / 峰值时段 / 最常用模型）由后端算好，前端只做格式化与比例缩放；
 * - 费用是 omp 按模型定价给的估算值，本地模型 / 无定价时显示 $0；
 * - 扫描有预算，超出时明说「统计可能不全」（后端 `truncated`），不假装统计完了；
 * - **只读**：不写 omp 配置、不写覆盖层、不落盘（刷新即重扫）。
 */
export function UsagePanel() {
  const { locale } = useApp();
  const t = useText();
  const [range, setRange] = useState<RangeKey>("7d");
  const [data, setData] = useState<UsageStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 已拿到数据的请求键（`range#reloadKey`）：与当前请求键不一致 = 正在拉。 */
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  /** 自增即重拉（挂载 / 点刷新）；切换范围也走 effect。 */
  const [reloadKey, setReloadKey] = useState(0);
  /** 趋势图悬停的柱序号：读数行显示那一天，不悬停显示范围合计。 */
  const [hover, setHover] = useState<number | null>(null);

  const numLocale = locale === "zh-CN" ? "zh-CN" : "en-US";
  const reqKey = `${range}#${reloadKey}`;
  // 切范围 / 刷新时保留上一份数据显示（加个 spinner），避免整块闪空导致布局跳动
  const busy = loadedKey !== reqKey;

  useEffect(() => {
    const [key, seq] = reqKey.split("#");
    const days = RANGES.find((r) => r.key === key)?.days ?? null;
    let alive = true;
    void api
      .getUsageStats(days)
      .then((res) => {
        if (!alive) return;
        setData(res);
        setError(null);
        setHover(null);
        setLoadedKey(`${key}#${seq}`);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setData(null);
        setError(e instanceof Error ? e.message : t.usageLoadFailed);
        setLoadedKey(`${key}#${seq}`);
      });
    return () => {
      alive = false;
    };
  }, [reqKey, t]);

  const rangeLabel = (k: RangeKey): string =>
    k === "today"
      ? t.usageRangeToday
      : k === "7d"
        ? t.usageRange7d
        : k === "30d"
          ? t.usageRange30d
          : t.usageRangeAll;

  const totals = data?.totals;
  const byDay = data?.byDay ?? [];
  const maxDay = Math.max(...byDay.map((d) => d.total), 1);
  const maxModel = Math.max(...(data?.byModel ?? []).map((m) => m.total), 1);
  const hovered = hover !== null ? byDay[hover] : undefined;
  const readout = hovered
    ? fmt(t.usageDayTotal, hovered.date, fmtTokens(hovered.total, numLocale), hovered.calls)
    : totals
      ? `${fmtTokens(totals.total, numLocale)} tokens · ${fmt(t.usageColCalls, totals.calls)}`
      : "";

  return (
    <section aria-label={t.tabUsage} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <ChartBar size={16} aria-hidden className="text-muted" />
        <h2 className="text-sm font-semibold">{t.tabUsage}</h2>
        <div role="radiogroup" aria-label={t.usageRangeAria} className="order-last flex basis-full flex-wrap gap-1 rounded-md bg-background p-1 @min-[600px]/panel:order-none @min-[600px]/panel:basis-auto">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="radio"
              aria-checked={range === r.key}
              onClick={() => setRange(r.key)}
              className={`min-h-8 cursor-pointer rounded-md px-2.5 py-1 text-[12px] transition-colors duration-100 ${
                range === r.key
                  ? "bg-active font-medium text-accent"
                  : "text-muted hover:bg-hover hover:text-foreground"
              }`}
            >
              {rangeLabel(r.key)}
            </button>
          ))}
        </div>
        <button
          onClick={() => setReloadKey((k) => k + 1)}
          disabled={busy}
          className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
          aria-label={t.refresh}
        >
          {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
          {t.refresh}
        </button>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.usageHint}</p>
      {error && (
        <p role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      )}
      {data?.truncated && (
        <p className="mt-1.5 text-[13px] text-warn">{fmt(t.usageTruncated, data.scannedFiles)}</p>
      )}

      {data === null ? (
        <p className="mt-3 text-[13px] text-muted">{busy ? t.usageLoading : ""}</p>
      ) : !totals || totals.calls === 0 ? (
        <p className="mt-4 rounded-lg bg-background px-4 py-8 text-center text-[13px] leading-relaxed text-muted">
          {t.usageEmpty}
        </p>
      ) : (
        <>
          {/* 总览：token / 费用 / 请求 / 工具 / 命中率 / 活跃度 / 最常用模型 / 峰值时段 / 日均 */}
          <div className="mt-5 grid grid-cols-1 gap-3 @min-[360px]/panel:grid-cols-2 @min-[640px]/panel:grid-cols-3">
            <Tile
              label={t.usageTokens}
              value={fmtTokens(totals.total, numLocale)}
              sub={
                <span className="flex flex-wrap gap-x-2">
                  <span>
                    {t.usageSeriesIn} {fmtTokens(totals.input, numLocale)}
                  </span>
                  <span>
                    {t.usageSeriesOut} {fmtTokens(totals.output, numLocale)}
                  </span>
                  <span>
                    {t.usageSeriesCache} {fmtTokens(totals.cacheRead + totals.cacheWrite, numLocale)}
                  </span>
                </span>
              }
            />
            <Tile
              label={t.usageCostEst}
              value={fmtCost(totals.cost)}
              sub={totals.cost > 0 ? t.usageCostHint : t.usageNoCost}
            />
            <Tile
              label={t.usageRequests}
              value={totals.calls.toLocaleString(numLocale)}
              sub={fmt(t.usageSessions, totals.sessions)}
            />
            <Tile
              label={t.usageToolCalls}
              value={totals.toolCalls.toLocaleString(numLocale)}
              sub={fmt(t.usageToolKinds, totals.toolKinds)}
            />
            <Tile
              label={t.usageCacheHit}
              value={totals.cacheHitRate === null ? "—" : fmtPercent(totals.cacheHitRate)}
              sub={fmt(t.usageCacheReadSub, fmtTokens(totals.cacheRead, numLocale))}
            />
            <Tile
              label={t.usageActiveDays}
              value={String(totals.activeDays)}
              sub={fmt(t.usageActiveDaysSub, totals.currentStreak, totals.longestStreak)}
            />
            <Tile
              label={t.usageTopModel}
              value={totals.topModel ? totals.topModel.model || t.usageUnknownModel : "—"}
              sub={totals.topModel ? fmt(t.usageTopModelShare, fmtPercent(totals.topModel.share)) : undefined}
            />
            <Tile
              label={t.usagePeakHour}
              value={
                totals.peakHour === null
                  ? "—"
                  : `${String(totals.peakHour).padStart(2, "0")}:00 – ${String((totals.peakHour + 1) % 24).padStart(2, "0")}:00`
              }
              sub={
                totals.peakHour === null
                  ? undefined
                  : fmt(t.usagePeakHourSub, fmtTokens(totals.peakHourTokens, numLocale))
              }
            />
            <Tile
              label={t.usageAvgDaily}
              value={fmtTokens(totals.avgDailyTokens, numLocale)}
              sub={t.usageAvgDailySub}
            />
          </div>

          {/* 每日用量热力图：最近 53 周的日历（不随范围切换），悬停读数 */}
          <div className="mt-6 rounded-lg border border-border-soft p-3">
            <Heatmap cells={data.heat} numLocale={numLocale} />
          </div>

          {/* 每日趋势：补零天的堆叠柱，悬停读数 */}
          <div className="mt-6 rounded-lg border border-border-soft p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <h3 className="text-[13px] font-medium">{t.usageDailyTrend}</h3>
              <span className="font-mono text-[11px] text-faint">{readout}</span>
              {data.chartDays >= CHART_MAX_DAYS && (
                <span className="text-[11px] text-faint">
                  {fmt(t.usageDailyTrendCapped, data.chartDays)}
                </span>
              )}
            </div>
            <div className="mt-4 flex h-28 items-end gap-px" onMouseLeave={() => setHover(null)}>
              {byDay.map((d, i) => (
                <div
                  key={d.date}
                  className={`flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm ${hover === i ? "bg-hover" : ""}`}
                  onMouseEnter={() => setHover(i)}
                >
                  <DayBar
                    row={d}
                    max={maxDay}
                    label={fmt(t.usageDayTotal, d.date, fmtTokens(d.total, numLocale), d.calls)}
                  />
                </div>
              ))}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-faint">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-accent" aria-hidden />
                  {t.usageSeriesOut}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-accent/50" aria-hidden />
                  {t.usageSeriesCache}
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-accent/25" aria-hidden />
                  {t.usageSeriesIn}
                </span>
              </div>
              {byDay.length > 1 && (
                <span className="ml-auto font-mono text-[11px] text-faint">
                  {byDay[0].date} → {byDay[byDay.length - 1].date}
                </span>
              )}
            </div>
          </div>

          {/* 按模型 */}
          <div className="mt-6">
            <h3 className="text-[13px] font-medium">{t.usageByModel}</h3>
            {data.byModel.length === 0 ? (
              <p className="mt-1.5 text-[13px] text-faint">{t.usageByModelEmpty}</p>
            ) : (
              <div className="mt-1 space-y-px">
                {data.byModel.map((m, i) => (
                  <div
                    key={`${m.provider}/${m.model}/${i}`}
                    className="flex min-h-11 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-2 py-2 transition-colors duration-100 hover:bg-hover"
                  >
                    <span className="flex min-w-0 basis-full items-baseline gap-1.5 @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0">
                      <span className="min-w-0 truncate text-[13px]" title={m.model}>
                        {m.model || t.usageUnknownModel}
                      </span>
                      {m.provider && (
                        <span className="min-w-0 truncate font-mono text-[11px] text-faint">{m.provider}</span>
                      )}
                    </span>
                    <ShareBar ratio={m.total / maxModel} />
                    <span className="min-w-0 font-mono text-[11px] text-faint @min-[600px]/panel:w-16 @min-[600px]/panel:text-right">
                      {fmt(t.usageColCalls, m.calls)}
                    </span>
                    <span className="min-w-0 font-mono text-[12px] tabular-nums @min-[600px]/panel:w-20 @min-[600px]/panel:text-right">
                      {fmtTokens(m.total, numLocale)}
                    </span>
                    <span className="min-w-0 font-mono text-[11px] text-faint @min-[600px]/panel:w-16 @min-[600px]/panel:text-right">
                      {fmtCost(m.cost)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

        </>
      )}
    </section>
  );
}
