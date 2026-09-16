import { describe, expect, it } from "vitest";
import type { ProviderUsage, ProviderUsageReport, UsageLimit } from "@shared/types";
import {
 formatAgo,
 formatDuration,
 hasLimits,
 hasUsageEntry,
 levelOf,
 orderedReports,
 primaryLimit,
 providerOf,
 providersWithoutUsage,
 reportFor,
 usageEntryDisabled,
} from "./usageLimits";

/** 造一个窗口（只写关心的字段，其余给中性值）。 */
const limit = (windowId: string, usedFraction: number, status = "ok"): UsageLimit => ({
 id: windowId === "5h" ? "rolling-5h" : windowId,
 label: windowId,
 windowId,
 windowLabel: windowId,
 usedFraction,
 percent: usedFraction * 100,
 status,
 resetsAt: null,
 durationMs: null,
});

const report = (provider: string, limits: UsageLimit[]): ProviderUsageReport => ({
 provider,
 planType: null,
 fetchedAt: 0,
 limits,
});

describe("providerOf", () => {
 it("从模型 selector 取供应商前缀", () => {
  expect(providerOf("opencode-go/deepseek-v4.1-flash")).toBe("opencode-go");
  expect(providerOf("anthropic/claude-sonnet-4")).toBe("anthropic");
 });

 it("裸 selector / 空值不当成供应商（前导斜杠按无前缀处理）", () => {
  expect(providerOf("deepseek-v4")).toBe("deepseek-v4");
  expect(providerOf("/weird")).toBe("/weird");
  expect(providerOf("")).toBeNull();
  expect(providerOf(null)).toBeNull();
  expect(providerOf(undefined)).toBeNull();
 });
});

describe("报告选择与排序", () => {
 const usage: ProviderUsage = {
  generatedAt: 1,
  reports: [report("a", [limit("5h", 0.1)]), report("b", [limit("5h", 0.2)]), report("c", [])],
  accountsWithoutUsage: 0,
  disabledCredentials: 0,
  configuredProviders: [],
 };

 it("reportFor 只在有该供应商时命中", () => {
  expect(reportFor(usage, "b")?.provider).toBe("b");
  expect(reportFor(usage, "zzz")).toBeNull();
  expect(reportFor(usage, null)).toBeNull();
 });

 it("orderedReports 把当前供应商提到最前，其余保持原序", () => {
  expect(orderedReports(usage, "b").map((r) => r.provider)).toEqual(["b", "a", "c"]);
  // 已在首位 / 没命中：顺序原样不动
  expect(orderedReports(usage, "a").map((r) => r.provider)).toEqual(["a", "b", "c"]);
  expect(orderedReports(usage, "zzz").map((r) => r.provider)).toEqual(["a", "b", "c"]);
  expect(orderedReports(null, "a")).toEqual([]);
 });
});

describe("primaryLimit", () => {
 it("优先 5 小时窗（最先撞墙），没有就取第一个", () => {
  expect(primaryLimit(report("p", [limit("monthly", 0.1), limit("5h", 0.2)]))?.windowId).toBe("5h");
  expect(primaryLimit(report("p", [limit("monthly", 0.1), limit("7d", 0.2)]))?.windowId).toBe("monthly");
 });

 it("没有窗口时给 null（入口不画条）", () => {
  expect(primaryLimit(report("p", []))).toBeNull();
  expect(primaryLimit(null)).toBeNull();
 });
});

describe("levelOf", () => {
 it("对齐 omp 的阈值：≥80% 警告、≥100% 或用尽为 danger", () => {
  expect(levelOf(limit("5h", 0.26))).toBe("ok");
  expect(levelOf(limit("5h", 0.79))).toBe("ok");
  expect(levelOf(limit("5h", 0.8))).toBe("warn");
  expect(levelOf(limit("5h", 0.99))).toBe("warn");
  expect(levelOf(limit("5h", 1))).toBe("danger");
  expect(levelOf(limit("5h", 1.2))).toBe("danger");
  // 上游说用尽就按用尽（哪怕比例看起来不高）
  expect(levelOf(limit("5h", 0.1, "exhausted"))).toBe("danger");
 });
});

describe("hasLimits 与入口渲染", () => {
 const base = { generatedAt: 1, accountsWithoutUsage: 0, disabledCredentials: 0 };

 it("一个窗口都没有时 hasLimits 为 false", () => {
  expect(hasLimits(null)).toBe(false);
  expect(hasLimits({ ...base, reports: [], configuredProviders: [] })).toBe(false);
  expect(hasLimits({ ...base, reports: [report("p", [])], configuredProviders: [] })).toBe(false);
  expect(hasLimits({ ...base, reports: [report("p", [limit("5h", 0.1)])], configuredProviders: [] })).toBe(true);
 });

 it("入口：有窗口数据、配了供应商，或查询失败都要渲染", () => {
  expect(hasUsageEntry(null, null)).toBe(false);
  expect(hasUsageEntry({ ...base, reports: [], configuredProviders: [] }, null)).toBe(false);
  // 只配了 commandcode 这种没探针的供应商：入口仍在（点开能看到「无用量数据」的解释）
  expect(hasUsageEntry({ ...base, reports: [], configuredProviders: ["commandcode"] }, null)).toBe(true);
  expect(hasUsageEntry({ ...base, reports: [report("p", [limit("5h", 0.1)])], configuredProviders: ["p"] }, null)).toBe(true);
  // 从未成功过且失败：也要渲染（一个置灰的按钮，比什么都没有更容易理解）
  expect(hasUsageEntry(null, "读取用量限额失败：omp 命令超时")).toBe(true);
 });
});

describe("usageEntryDisabled", () => {
 const opencode: ProviderUsage = {
  generatedAt: 1,
  reports: [report("opencode-go", [limit("5h", 0.41)])],
  accountsWithoutUsage: 0,
  disabledCredentials: 0,
  configuredProviders: ["commandcode", "opencode-go"],
 };

 it("当前模型的供应商有数据 → 可点", () => {
  expect(usageEntryDisabled(opencode, "opencode-go", null)).toBeNull();
 });

 it("当前模型的供应商没有查询路径 → 置灰（unsupported）", () => {
  expect(usageEntryDisabled(opencode, "commandcode", null)).toBe("unsupported");
 });

 it("没有在用的模型（没会话）→ 可点（看全部供应商）", () => {
  expect(usageEntryDisabled(opencode, null, null)).toBeNull();
 });

 it("从未查到过 + 查询失败 → 置灰（failed）；有旧数据时不收走", () => {
  expect(usageEntryDisabled(null, "opencode-go", "读取用量限额失败：omp 命令超时")).toBe("failed");
  expect(usageEntryDisabled(opencode, "opencode-go", "刷新失败")).toBeNull();
  expect(usageEntryDisabled(null, null, null)).toBeNull();
 });

 it("供应商未知（旧后端没有 configuredProviders）时不误判为 unsupported", () => {
  expect(usageEntryDisabled({ ...opencode, configuredProviders: [] }, "commandcode", null)).toBeNull();
 });
});

describe("providersWithoutUsage", () => {
 const usage: ProviderUsage = {
  generatedAt: 1,
  reports: [report("opencode-go", [limit("5h", 0.41)])],
  accountsWithoutUsage: 0,
  disabledCredentials: 0,
  configuredProviders: ["commandcode", "opencode-go"],
 };

 it("已配置 − 有报告 = 配了但拿不到用量的供应商", () => {
  expect(providersWithoutUsage(usage, null)).toEqual(["commandcode"]);
 });

 it("当前会话的供应商排首位（最可能是「我明明在用」的那个）", () => {
  const many: ProviderUsage = {
   ...usage,
   configuredProviders: ["aaa", "commandcode", "opencode-go", "zzz"],
  };
  expect(providersWithoutUsage(many, "zzz")).toEqual(["zzz", "aaa", "commandcode"]);
  // 当前供应商有数据时顺序不动（无数据的仍按上游给的顺序）
  expect(providersWithoutUsage(many, "opencode-go")).toEqual(["aaa", "commandcode", "zzz"]);
 });

 it("旧后端没有该字段 / 没有数据源时给空数组（不炸、不乱说）", () => {
  expect(providersWithoutUsage(null, "x")).toEqual([]);
  expect(providersWithoutUsage({ ...usage, configuredProviders: [] }, "x")).toEqual([]);
  expect(
   providersWithoutUsage({ ...usage, configuredProviders: undefined as unknown as string[] }, null),
  ).toEqual([]);
 });
});

describe("相对时间文案", () => {
 it("中文：分钟 / 小时+分 / 天+小时，不足一分钟单独说", () => {
  expect(formatDuration(30_000, "zh-CN")).toBe("不到 1 分钟");
  expect(formatDuration(45 * 60_000, "zh-CN")).toBe("45 分钟");
  expect(formatDuration(2 * 3600_000, "zh-CN")).toBe("2 小时");
  expect(formatDuration(61 * 60_000, "zh-CN")).toBe("1 小时 1 分");
  expect(formatDuration(25 * 86400_000, "zh-CN")).toBe("25 天");
  expect(formatDuration((4 * 24 + 14) * 3600_000, "zh-CN")).toBe("4 天 14 小时");
 });

 it("英文：紧凑写法", () => {
  expect(formatDuration(30_000, "en")).toBe("<1m");
  expect(formatDuration(45 * 60_000, "en")).toBe("45m");
  expect(formatDuration(61 * 60_000, "en")).toBe("1h 1m");
  expect(formatDuration((4 * 24 + 14) * 3600_000, "en")).toBe("4d 14h");
 });

 it("负数（时钟偏差）按 0 处理，不显示负时长", () => {
  expect(formatDuration(-5000, "en")).toBe("<1m");
 });

 it("formatAgo 的本地化后缀", () => {
  expect(formatAgo(2 * 60_000, "zh-CN")).toBe("2 分钟前");
  expect(formatAgo(2 * 60_000, "en")).toBe("2m ago");
 });
});
