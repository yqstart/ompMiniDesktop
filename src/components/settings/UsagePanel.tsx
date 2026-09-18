import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ChartBar, Loader, Refresh } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { HEAT_MODES, heatLevel, heatThresholds, heatValues, monthTicks, type HeatMode } from "../../lib/usageHeat";
import type { UsageHeatRow, UsageStats } from "@shared/types";

/** 统计范围：与 ZCode 的「使用统计」同档（今日 / 近 7 日 / 近 30 日 / 全部）。 */
type RangeKey = "today" | "7d" | "30d" | "all";

const RANGES: { key: RangeKey; days: number | null }[] = [
 { key: "today", days: 1 },
 { key: "7d", days: 7 },
 { key: "30d", days: 30 },
 { key: "all", days: null },
];

/** token 数：过万转 K / M / B（密集表格里可读性优先），小数字走千分位。 */
function fmtTokens(n: number, locale: string): string {
 if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
 if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
 if (n >= 10_000) return `${(n / 1000).toFixed(1)}K`;
 return n.toLocaleString(locale);
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

/** 热力图色档：0 档空格 + 4 档 accent 由浅到深（单强调色靠透明度分级，不引第二配色）。 */
const HEAT_LEVEL_CLASS = ["bg-active", "bg-accent/20", "bg-accent/45", "bg-accent/70", "bg-accent"];

/**
 * 「Token 活动」热力图：一列一周（周日在最上）、一行一天，颜色越重用量越多。
 *
 * 数据是后端给的最近 53 周（**不随上方范围切换**）；右上三档只换每个格子的取值口径
 * （每日 = 当天 / 每周 = 整周合计 / 累计 = 窗口起点到当天），格子与布局完全不变——
 * 切换不发请求、不重扫。格子随面板宽度自适应（53 列铺满一行），底部是按列对齐的月份刻度。
 */
function Heatmap({ cells, numLocale }: { cells: UsageHeatRow[]; numLocale: string }) {
 const t = useText();
 const [mode, setMode] = useState<HeatMode>("day");
 const values = useMemo(() => heatValues(cells, mode), [cells, mode]);
 const thresholds = useMemo(() => heatThresholds(values), [values]);
 const months = useMemo(() => monthTicks(cells, numLocale), [cells, numLocale]);
 const cols = Math.ceil(cells.length / 7);
 const labels: Record<HeatMode, string> = {
  day: t.usageHeatDay,
  week: t.usageHeatWeek,
  cumulative: t.usageHeatCumulative,
 };

 /** 格子读数：三档各自说清这个数字是什么（原生 title，悬停即见）。 */
 const cellTitle = (i: number): string => {
  const value = fmtTokens(values[i], numLocale);
  if (mode === "week") {
   const head = cells[Math.floor(i / 7) * 7].date;
   const tail = cells[Math.min(Math.floor(i / 7) * 7 + 6, cells.length - 1)].date;
   return fmt(t.usageHeatCellWeek, head, tail, value);
  }
  if (mode === "cumulative") return fmt(t.usageHeatCellCumulative, cells[i].date, value);
  return fmt(t.usageHeatCellDay, cells[i].date, value);
 };

 return (
  <section aria-label={t.usageHeatTitle} className="mt-6 rounded-lg border border-border-soft p-3">
   <div className="flex flex-wrap items-center gap-2">
    <h3 className="text-[13px] font-medium">{t.usageHeatTitle}</h3>
    <div role="radiogroup" aria-label={t.usageHeatModeAria} className="ml-auto flex gap-1 rounded-md bg-background p-1">
     {HEAT_MODES.map((m) => (
      <button
       key={m}
       role="radio"
       aria-checked={mode === m}
       onClick={() => setMode(m)}
       className={`min-h-7 cursor-pointer rounded-md px-2.5 py-1 text-[12px] transition-colors duration-100 ${mode === m ? "bg-active font-medium text-accent" : "text-muted hover:bg-hover hover:text-foreground"
        }`}
      >
       {labels[m]}
      </button>
     ))}
    </div>
   </div>
   <div
    role="img"
    aria-label={fmt(t.usageHeatAria, labels[mode])}
    className="mt-3 grid gap-1"
    style={{
     gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
     gridTemplateRows: "repeat(7, auto)",
     gridAutoFlow: "column",
     alignItems: "start",
    }}
   >
    {cells.map((c, i) => (
     <span
      key={c.date}
      title={cellTitle(i)}
      className={`aspect-square rounded-xs ${HEAT_LEVEL_CLASS[heatLevel(values[i], thresholds)]}`}
     />
    ))}
   </div>
   <div className="relative mt-2 h-4">
    {months.map((m) => {
     const pct = ((m.col + 2.5) / cols) * 100;
     return (
      <span
       key={m.col}
       className={`absolute top-0 whitespace-nowrap text-[10px] leading-4 text-faint ${pct < 6 ? "" : pct > 94 ? "-translate-x-full" : "-translate-x-1/2"
        }`}
       style={{ left: `${pct}%` }}
      >
       {m.label}
      </span>
     );
    })}
   </div>
  </section>
 );
}

/**
 * 设置 ›「使用统计」：把 omp 本地会话记录里的用量聚合成一页只读统计。
 *
 * 口径（与 ZCode 的「使用统计」对齐，数据源换成 omp）：
 * - 总览三项指标：tokens 用量 / Cache 命中率 / 活跃天数（**默认看「今日」**）；
 * - 「Token 活动」热力图：最近 53 周的逐日日历，**不随范围切换**，右上三档换取值口径；
 * - 数据来自会话 jsonl 里每条 assistant 消息的 `usage`，含已归档会话；
 * - 全部数字（含命中率 / 连续天数）由后端算好，前端只做格式化；
 * - 扫描有预算，超出时明说「统计可能不全」（后端 `truncated`），不假装统计完了；
 * - **只读**：不写 omp 配置、不写覆盖层、不落盘（刷新即重扫）。
 */
export function UsagePanel() {
 const { locale } = useApp();
 const t = useText();
 const [range, setRange] = useState<RangeKey>("today");
 const [data, setData] = useState<UsageStats | null>(null);
 const [error, setError] = useState<string | null>(null);
 /** 已拿到数据的请求键（`range#reloadKey`）：与当前请求键不一致 = 正在拉。 */
 const [loadedKey, setLoadedKey] = useState<string | null>(null);
 /** 自增即重拉（挂载 / 点刷新）；切换范围也走 effect。 */
 const [reloadKey, setReloadKey] = useState(0);

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
       className={`min-h-8 cursor-pointer rounded-md px-2.5 py-1 text-[12px] transition-colors duration-100 ${range === r.key
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
   ) : (
    <>
     {!totals || totals.calls === 0 ? (
      <p className="mt-4 rounded-lg bg-background px-4 py-8 text-center text-[13px] leading-relaxed text-muted">
       {t.usageEmpty}
      </p>
     ) : (
      /* 总览三张卡：tokens 用量（含未缓存输入 / 输出 / 缓存读·写）/ Cache 命中率 / 活跃天数 */
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
        label={t.usageCacheHit}
        value={totals.cacheHitRate === null ? "—" : fmtPercent(totals.cacheHitRate)}
        sub={fmt(t.usageCacheReadSub, fmtTokens(totals.cacheRead, numLocale))}
       />
       <Tile
        label={t.usageActiveDays}
        value={String(totals.activeDays)}
        sub={fmt(t.usageActiveDaysSub, totals.currentStreak, totals.longestStreak)}
       />
      </div>
     )}
     <Heatmap cells={data.heat} numLocale={numLocale} />
    </>
   )}
  </section>
 );
}
