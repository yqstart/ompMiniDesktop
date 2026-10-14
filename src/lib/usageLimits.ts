import type { ProviderUsage, UsageLimit } from "@shared/types";
import { levelOf } from "./providerUsage";

/**
 * 供应商配额·**入口侧**的判定（输入框工具行右端的 `Gauge` 键）：一眼摘要 / 渲染 / 置灰。
 *
 * 口径（2026-10-14 用户口径）：
 * - 看的是**我配置的供应商**，与当前会话在用哪个模型**无关**（别按 `currentModel` 过滤 / 排序 / 置灰）；
 * - 收起态**只画图标**，点开才看内容（浮层里是全部供应商的全部窗口）；
 * - 图标配色档由最紧的一个窗口决定（`warn` / `danger`），读数一律在浮层与悬停提示里。
 *
 * 数据层已统一在 `lib/providerUsage.ts`（模块级快照 + 节流单飞 + 设置页「供应商用量」弹窗共用）——
 * 本模块不自己拉取，只保留入口自己的纯函数。
 */

/** 自动刷新间隔（页面可见时才走；omp 自身也有报告缓存，频率再高也是白跑）。 */
export const USAGE_REFRESH_MS = 5 * 60_000;

/**
 * 入口的一眼摘要：全部已配置供应商的**全部窗口**（上游顺序）+ 最紧的一档（图标配色用）。
 * 收起态只画图标，读数在浮层里——items 供悬停提示与读屏播报，不做布局决策。
 */
export function entryGlance(usage: ProviderUsage | null): {
 level: "ok" | "warn" | "danger";
 items: { provider: string; limit: UsageLimit }[];
} {
 const items = (usage?.reports ?? []).flatMap((r) => r.limits.map((limit) => ({ provider: r.provider, limit })));
 let level: "ok" | "warn" | "danger" = "ok";
 for (const { limit } of items) {
  const l = levelOf(limit);
  if (l === "danger") return { level: "danger", items };
  if (l === "warn") level = "warn";
 }
 return { level, items };
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
 * 只有一种置灰：一次都没拿到数据、且最近一次查询失败（有旧数据时不算——那继续显示旧值，
 * 浮层里给一行错误就够了，不该把已能看到的东西收走）。**不再**按当前模型的供应商置灰：
 * 入口看的是全部已配置供应商，某一家没探针不影响别家。
 */
export function usageEntryDisabled(usage: ProviderUsage | null, error: string | null): "failed" | null {
 return !usage && error ? "failed" : null;
}
