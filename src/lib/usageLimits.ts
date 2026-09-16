import { api } from "@shared/api";
import type { ProviderUsage, ProviderUsageReport, UsageLimit } from "@shared/types";
import { useApp } from "../stores/app";
import type { Locale } from "./locale";

/**
 * 供应商配额（输入框上方「用量限额」入口）的数据层：拉取节流、当前供应商的主窗口选择、
 * 告警档与时间文案。
 *
 * 分工：`ctxUsage.ts` 是上下文窗口占用（token），`usage.rs` 是本地会话的 token 统计，
 * 这里是**供应商侧的限额窗口**（5 小时 / 每周 / 每月）——数据只能由 omp 拿到
 * （`omp usage --json`），壳侧不做任何聚合：比例、状态、重置时刻都是后端解析好的。
 */

/** 新鲜度阈值：距上次拉取不足这么久就不重复拉（切回会话 / 打开浮层时用）。 */
export const USAGE_FRESH_MS = 60_000;
/** 自动刷新间隔（页面可见时才走；omp 自身也有报告缓存，频率再高也是白跑）。 */
export const USAGE_REFRESH_MS = 5 * 60_000;

/**
 * 当前会话模型的供应商 id（`currentModel` 形如 `opencode-go/deepseek-v4.1-flash`）。
 * 裸 selector（没有 `/`）原样返回；空串按「没有」处理。
 */
export function providerOf(selector: string | null | undefined): string | null {
 if (!selector) return null;
 const i = selector.indexOf("/");
 const id = i > 0 ? selector.slice(0, i) : selector;
 return id || null;
}

/** 当前供应商的报告（没有配额数据时为 null）。 */
export function reportFor(usage: ProviderUsage | null, provider: string | null): ProviderUsageReport | null {
 if (!provider) return null;
 return usage?.reports.find((r) => r.provider === provider) ?? null;
}

/** 报告排序：当前供应商提到最前，其余保持上游给的顺序（原来的顺序有稳定含义）。 */
export function orderedReports(usage: ProviderUsage | null, provider: string | null): ProviderUsageReport[] {
 const reports = usage?.reports ?? [];
 if (!provider) return reports;
 const idx = reports.findIndex((r) => r.provider === provider);
 return idx <= 0 ? reports : [reports[idx], ...reports.slice(0, idx), ...reports.slice(idx + 1)];
}

/** 主窗口：优先 5 小时窗（最先撞墙），没有就取窗口列表的第一个。 */
export function primaryLimit(report: ProviderUsageReport | null): UsageLimit | null {
 if (!report || report.limits.length === 0) return null;
 return report.limits.find((l) => l.windowId === "5h") ?? report.limits[0];
}

/** 告警档：对齐 omp 自己的判定阈值（≥80% 警告、≥100% 或 `exhausted` 用尽）。 */
export function levelOf(limit: UsageLimit): "ok" | "warn" | "danger" {
 if (limit.status === "exhausted" || limit.usedFraction >= 1) return "danger";
 return limit.usedFraction >= 0.8 ? "warn" : "ok";
}

/** 有没有可显示的窗口（有配额数据的供应商）。 */
export function hasLimits(usage: ProviderUsage | null): boolean {
 return !!usage?.reports.some((r) => r.limits.length > 0);
}

/**
 * 入口该不该渲染：有窗口数据、配了供应商，或者最近一次查询失败。
 *
 * 后两种是必要的：`omp usage` 只对有探针的供应商报配额，配了没探针的供应商（本机实测
 * `commandcode`）时如果整块不渲染，用户看到的就是「我明明配了，界面却当它不存在」——
 * 沉默比一个置灰的按钮糟糕得多；查询失败同理（要有东西告诉用户"它挂了"）。
 */
export function hasUsageEntry(usage: ProviderUsage | null, error: string | null): boolean {
 if (usage && (hasLimits(usage) || (usage.configuredProviders?.length ?? 0) > 0)) return true;
 return !!error;
}

/**
 * 按钮该不该置灰、为什么（`null` = 可点）。
 *
 * - `"unsupported"`：当前会话的供应商**已知没有查询路径**（配了，但 omp 没有它的探针）；
 * - `"failed"`：一次都没拿到数据，且最近一次查询失败（有旧数据时不算——那继续显示旧值，
 *   浮层里给一行错误就够了，不该把已能看到的东西收走）；
 * - `null`：可点——当前供应商有数据，或者没有"在用的模型"（没会话时看全部供应商）。
 */
export function usageEntryDisabled(
 usage: ProviderUsage | null,
 provider: string | null,
 error: string | null,
): "unsupported" | "failed" | null {
 if (provider && providersWithoutUsage(usage, provider).includes(provider)) return "unsupported";
 if (!usage && error) return "failed";
 return null;
}

/**
 * 配了但上游没给用量的供应商（`configuredProviders` − `reports`）。
 * 当前会话的供应商排首位——它最可能是「我明明在用，为什么看不到额度」的那一个。
 */
export function providersWithoutUsage(usage: ProviderUsage | null, provider: string | null): string[] {
 const configured = usage?.configuredProviders ?? [];
 if (configured.length === 0) return [];
 const withData = new Set(usage?.reports.map((r) => r.provider));
 const missing = configured.filter((p) => !withData.has(p));
 if (provider && missing.includes(provider)) {
  return [provider, ...missing.filter((p) => p !== provider)];
 }
 return missing;
}

/**
 * 相对时长（中英文各一套写法）。粒度：<1 分钟 / 分钟 / 小时+分 / 天+小时。
 * 这属于数据层展示文本（同导出 Markdown、附件校验），不走字典。
 */
export function formatDuration(ms: number, locale: Locale): string {
 const zh = locale !== "en";
 const min = Math.max(0, Math.floor(ms / 60_000));
 if (min < 1) return zh ? "不到 1 分钟" : "<1m";
 if (min < 60) return zh ? `${min} 分钟` : `${min}m`;
 const h = Math.floor(min / 60);
 const m = min % 60;
 if (h < 24) {
  if (m === 0) return zh ? `${h} 小时` : `${h}h`;
  return zh ? `${h} 小时 ${m} 分` : `${h}h ${m}m`;
 }
 const d = Math.floor(h / 24);
 const rh = h % 24;
 if (rh === 0) return zh ? `${d} 天` : `${d}d`;
 return zh ? `${d} 天 ${rh} 小时` : `${d}d ${rh}h`;
}

/** 「N 前」：报告更新时间用（`formatDuration` + 本地化后缀）。 */
export function formatAgo(ms: number, locale: Locale): string {
 const d = formatDuration(ms, locale);
 return locale === "en" ? `${d} ago` : `${d}前`;
}

/** 同一时刻只允许一个请求在飞（打开浮层 + 定时刷新可能同时触发）。 */
let inflight: Promise<void> | null = null;

/**
 * 拉一次配额（带节流与单飞）。
 *
 * - `force = false` 且距上次成功拉取不到 [`USAGE_FRESH_MS`] 时直接跳过；
 * - 失败**保留上一份数据**（界面继续显示旧值 + 一行错误），不闪空。
 */
export function loadUsageLimits(force = false): Promise<void> {
 const st = useApp.getState();
 if (!force && st.providerUsage && Date.now() - st.providerUsage.generatedAt < USAGE_FRESH_MS) {
  return Promise.resolve();
 }
 if (inflight) return inflight;
 useApp.setState({ providerUsageLoading: true });
 inflight = api
  .getProviderUsage()
  .then((usage) => useApp.setState({ providerUsage: usage, providerUsageError: null }))
  .catch((e: unknown) =>
   useApp.setState({ providerUsageError: e instanceof Error ? e.message : String(e) }),
  )
  .finally(() => {
   inflight = null;
   useApp.setState({ providerUsageLoading: false });
  });
 return inflight;
}
