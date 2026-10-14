import { useCallback, useEffect, useState } from "react";
import { Gauge, Loader, Refresh } from "reicon-react";
import type { UsageLimit } from "@shared/types";
import { fmt, type Text } from "../../lib/locale";
import {
 formatAgo,
 formatDuration,
 latestFetchedAt,
 levelOf,
 limitReading,
 loadProviderUsage,
 providersWithoutUsage,
 useProviderUsage,
 windowNames,
} from "../../lib/providerUsage";
import { useDropdown } from "../../lib/useDropdown";
import { USAGE_REFRESH_MS, entryGlance, hasUsageEntry, usageEntryDisabled } from "../../lib/usageLimits";
import { useText } from "../../lib/useText";
import { useApp } from "../../stores/app";

/**
 * 供应商用量（**输入框工具行右端**，2026-10-14 与上下文容量环一起从顶栏右端搬进输入卡）：
 * 供应商侧的配额进度条 + 点开的明细浮层。
 *
 * 这里看的是 **opencode 网站那种 5 小时 / 每周 / 每月限额**（供应商配额），不是本地 token 统计
 * （那个在 设置 › 使用统计），也不是上下文窗口占用（那个是同排的 `ContextMeter`）。
 * 数据只由 omp 拿得到：后端跑 `omp usage --json` 解析后返回（与供应商页走 `omp auth-broker` 同款），
 * 壳侧不直连配额 API、不碰凭证库，也不做任何聚合。
 *
 * - 口径（2026-10-14 用户口径）：看的是**我配置的供应商**，与当前会话在用哪个模型无关——
 *   不再按 `currentModel` 的供应商过滤/排序；
 * - 收起态：**只有一个图标**（`Gauge`），读数不铺在工具行上；最紧的窗口到 warn / danger 档时
 *   图标换色（读数在悬停提示与浮层里，颜色不作唯一信号）；
 * - 展开态：按供应商分段列出全部窗口（上游顺序）+ 读数 + 重置倒计时 + 更新时间；
 *   读数口径与设置页弹窗共用 `limitReading`——有比例的显示百分比、余额型窗口显示「$X 剩余」。
 * - 一份配额都拿不到（一个供应商都没配）时**整块不渲染**；但「配了供应商、上游却拿不到用量」
 *   （如 omp 未实现探针的 `commandcode`）会**显式列出**并写明原因，不静默少一块；
 * - 刷新：启动拉一次、页面可见时每 5 分钟一次、打开浮层强制一次（失败保留旧值 + 一行错误）。
 */

/** 「配了但拿不到用量」最多列几个，其余折叠成一行（供应商多时不把浮层撑长）。 */
const MISSING_MAX = 4;

export function UsageLimits() {
 const t = useText();
 const locale = useApp((s) => s.locale);
 // 数据层统一在 lib/providerUsage.ts（模块级快照；设置页「供应商用量」弹窗同一份）
 const { data: usage, error, loading } = useProviderUsage();
 const composerMenu = useApp((s) => s.composerMenu);
 const open = composerMenu === "usage";
 const setOpen = useCallback((v: boolean) => useApp.setState({ composerMenu: v ? "usage" : null }), []);
 const ref = useDropdown(open, () => setOpen(false));
 // 「现在」走 state：相对时间（更新于 N 前 / N 后重置）不在 render 里读时钟，
 // 每 30 秒推进一次——浮层开着时读数自己会走，`0` 表示还没校准过（首帧不显示相对时间）。
 const [now, setNow] = useState(0);

 useEffect(() => {
  const tick = () => setNow(Date.now());
  const first = window.setTimeout(tick, 0);
  const timer = window.setInterval(tick, 30_000);
  return () => {
   window.clearTimeout(first);
   window.clearInterval(timer);
  };
 }, []);

 // 打开即拉最新（看到的就是当下的额度，而不是上次关浮层时的旧值）
 useEffect(() => {
  if (open) void loadProviderUsage(true);
 }, [open]);

 // 常驻：挂载拉一次 + 每 5 分钟一次（页面不可见时跳过，切回来再补一次）
 useEffect(() => {
  void loadProviderUsage();
  const tick = () => {
   if (document.visibilityState === "visible") void loadProviderUsage();
  };
  const timer = window.setInterval(tick, USAGE_REFRESH_MS);
  document.addEventListener("visibilitychange", tick);
  return () => {
   window.clearInterval(timer);
   document.removeEventListener("visibilitychange", tick);
  };
 }, []);

 // 没有任何可显示内容时不占位（配额是可选面：一个供应商都没配、也没出过错就没有入口）；
 // 但「配了供应商、上游却没给用量」与查询失败都要渲染——沉默比一个置灰按钮糟得多
 if (!hasUsageEntry(usage, error)) return null;

 // 全都按上游顺序直出：不按当前模型重排、不按当前模型过滤（那是 2026-10-14 修掉的老口径）
 const { level, items } = entryGlance(usage);
 const reports = usage?.reports ?? [];
 const missing = providersWithoutUsage(usage);
 const resetIn = (at: number | null): string =>
  now && at ? fmt(t.usageLimitsResets, formatDuration(at - now, locale)) : "";
 const fetched = latestFetchedAt(usage);
 const updated = now && fetched ? fmt(t.usageLimitsUpdatedAgo, formatAgo(now - fetched, locale)) : "";
 /** 一眼摘要（悬停提示 / 读屏）：家名 + 窗口 + 读数，全部供应商的窗口都列上。 */
 const summary = items
  .map(({ provider, limit }) => `${provider} ${windowName(t, limit)} ${limitReading(t, limit).text}`)
  .join("、");
 // 置灰口径：一次都没拿到数据且最近一次查询失败（某一家没探针不影响别家，不置灰）
 const disabledReason = usageEntryDisabled(usage, error);
 const unavailable = disabledReason !== null;
 const aria = summary ? fmt(t.usageLimitsAriaAll, summary) : t.usageLimitsTitle;
 const title = unavailable ? fmt(t.usageLimitsFailedTitle, error ?? "") : aria;
 // 图标配色：最紧的窗口到哪一档（<80% 中性、≥80% warn、用尽 danger）
 const iconTone = level === "danger" ? "text-danger" : level === "warn" ? "text-warn" : "";

 return (
  <div className="relative" ref={ref}>
   <button
    onClick={() => setOpen(!open)}
    disabled={unavailable}
    className={`flex shrink-0 items-center justify-center rounded-md p-1.5 transition-colors duration-100 ${unavailable ? "cursor-default opacity-40" : "cursor-pointer hover:bg-hover hover:text-foreground"
     }`}
    aria-label={unavailable ? title : aria}
    aria-expanded={open}
    title={title}
   >
    {/* 2026-10-14 用户口径：收起态只画图标，读数在浮层里（到阈值才换色，颜色不是唯一信号） */}
    <Gauge size={16} aria-hidden className={iconTone || "text-muted"} />
   </button>
   {open && (
    <div className="absolute right-0 bottom-full z-10 mb-1 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-elevated p-2 shadow-pop">
     <div className="flex items-center gap-2 px-1 pb-1.5">
      <span className="flex-1 truncate text-[11px] text-muted" title={updated || t.usageLimitsTitle}>
       {t.usageLimitsTitle}
       {updated && ` · ${updated}`}
      </span>
      <button
       onClick={() => void loadProviderUsage(true)}
       disabled={loading}
       className="cursor-pointer rounded p-1 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50"
       aria-label={t.refresh}
       title={t.refresh}
      >
       {loading ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      </button>
     </div>
     {error && (
      <p role="alert" className="mb-1 rounded bg-danger/10 px-2 py-1 text-[12px] text-danger">
       {error}
      </p>
     )}
     {loading && !usage && <p className="px-1 py-2 text-[13px] text-muted">{t.usageLimitsLoading}</p>}
     {reports.map((r) => {
      // 窗口名整组一起算（同一份报告里重名时补区分），与设置页卡片同口径
      const names = windowNames(t, r.limits);
      return (
       <div key={r.provider} className="mb-1 last:mb-0">
        <div className="flex items-baseline gap-1.5 px-1 pb-0.5">
         <span className="min-w-0 truncate text-[13px]" title={r.provider}>
          {r.planType ?? r.provider}
         </span>
         {r.planType && <span className="min-w-0 truncate font-mono text-[11px] text-faint">{r.provider}</span>}
        </div>
        {r.limits.map((l, i) => {
         // 读数口径与设置页弹窗同源（`limitReading`）：百分比窗口画条 + 百分比，
         // 余额型窗口只给金额（「$X 剩余」），计数型给数量原文——percent 缺省 0 不是读数。
         const reading = limitReading(t, l);
         return (
          <div key={l.id} className="flex items-center gap-2 rounded-md px-1 py-1 hover:bg-hover/60">
           <span className="w-20 shrink-0 truncate text-[12px] text-muted" title={names[i]}>
            {names[i]}
           </span>
           {reading.bar && <LimitBar limit={l} className="min-w-0 flex-1" />}
           <span
            className={`shrink-0 font-mono text-[12px] tabular-nums ${reading.bar ? "" : "ml-auto"}`}
            title={reading.title}
           >
            {reading.text}
           </span>
           <span className="w-32 shrink-0 whitespace-nowrap text-right text-[11px] text-faint">{resetIn(l.resetsAt)}</span>
          </div>
         );
        })}
       </div>
      );
     })}
     {/* 配了供应商、但 omp 拿不到它的用量（没实现探针）：显式列出来 + 讲清原因，
         否则用户只会看到「我配的那个供应商不见了」。最多列 4 个，其余折叠成一行。 */}
     {missing.slice(0, MISSING_MAX).map((p) => (
      <div key={p} className="rounded-md px-1 py-1 hover:bg-hover/60">
       <div className="flex items-baseline gap-1.5">
        <span className="min-w-0 truncate font-mono text-[12px] text-muted" title={p}>
         {p}
        </span>
        <span className="shrink-0 text-[11px] text-faint">{t.usageLimitsNoData}</span>
       </div>
       <p className="pt-0.5 text-[11px] text-faint">{t.usageLimitsNoDataHint}</p>
      </div>
     ))}
     {missing.length > MISSING_MAX && (
      <p className="px-1 pt-0.5 text-[11px] text-faint">
       {fmt(t.usageLimitsNoDataMore, missing.length - MISSING_MAX)}
      </p>
     )}
     {usage && usage.accountsWithoutUsage.length > 0 && (
      <p className="px-1 pt-1 text-[11px] text-faint">
       {fmt(t.usageLimitsAccountsWithout, usage.accountsWithoutUsage.length)}
      </p>
     )}
     <p className="px-1 pt-1.5 text-[11px] text-faint">{t.usageLimitsFoot}</p>
    </div>
   )}
  </div>
 );
}

/** 窗口名：已知窗口走字典（本应用的口径），未知窗口回退上游原文。 */
function windowName(t: Text, l: UsageLimit): string {
 if (l.windowId === "5h") return t.usageLimitsWindow5h;
 if (l.windowId === "7d") return t.usageLimitsWindow7d;
 if (l.windowId === "monthly") return t.usageLimitsWindowMonthly;
 return l.windowLabel || l.label;
}

/**
 * 一根配额进度条：底槽 + 实心段（纯 CSS，不引图表库）。
 * 配色走语义色并**只在超阈值时才换色**：<80% `accent`、≥80% `warn`、用尽 `danger`
 * ——颜色之外还有百分比数字，颜色不作唯一信号。
 */
function LimitBar({ limit, className }: { limit: UsageLimit; className?: string }) {
 const level = levelOf(limit);
 const fill = level === "danger" ? "bg-danger" : level === "warn" ? "bg-warn" : "bg-accent";
 // 超限（>100%）时条仍然铺满，不溢出容器
 const width = Math.min(100, Math.max(0, limit.usedFraction * 100));
 return (
  <span className={`h-1.5 shrink-0 overflow-hidden rounded-sm bg-accent/15 ${className ?? ""}`} aria-hidden>
   <span className={`block h-full rounded-sm transition-[width] duration-150 ${fill}`} style={{ width: `${width}%` }} />
  </span>
 );
}
