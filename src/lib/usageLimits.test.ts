import { describe, expect, it } from "vitest";
import type { ProviderUsage, ProviderUsageReport, UsageLimit } from "@shared/types";
import {
 hasLimits,
 hasUsageEntry,
 orderedReports,
 primaryLimit,
 providerOf,
 providersWithoutUsage,
 reportFor,
 usageEntryDisabled,
} from "./usageLimits";

/**
 * 入口侧（输入框工具行「用量限额」）纯逻辑测试。
 *
 * 数据层的通用件（levelOf / 相对时间文案 / providersWithoutUsage 的基础口径）覆盖在
 * `providerUsage.test.ts`；这里只测入口自己的选择与渲染判定。
 */

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
 notes: [],
 used: null,
 limit: null,
 remaining: null,
 unit: "percent",
});

const report = (provider: string, limits: UsageLimit[]): ProviderUsageReport => ({
 provider,
 planType: null,
 accountLabel: null,
 fetchedAt: 0,
 limits,
});

/** 造一份用量快照（只写关心的字段）。 */
const usage = (partial: Partial<ProviderUsage>): ProviderUsage => ({
 generatedAt: 1,
 reports: [],
 accountsWithoutUsage: [],
 disabledCredentials: [],
 configuredProviders: [],
 extraFailures: [],
 ...partial,
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
 const base = usage({
  reports: [report("a", [limit("5h", 0.1)]), report("b", [limit("5h", 0.2)]), report("c", [])],
 });

 it("reportFor 只在有该供应商时命中", () => {
  expect(reportFor(base, "b")?.provider).toBe("b");
  expect(reportFor(base, "zzz")).toBeNull();
  expect(reportFor(base, null)).toBeNull();
 });

 it("orderedReports 把当前供应商提到最前，其余保持原序", () => {
  expect(orderedReports(base, "b").map((r) => r.provider)).toEqual(["b", "a", "c"]);
  // 已在首位 / 没命中：顺序原样不动
  expect(orderedReports(base, "a").map((r) => r.provider)).toEqual(["a", "b", "c"]);
  expect(orderedReports(base, "zzz").map((r) => r.provider)).toEqual(["a", "b", "c"]);
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

describe("hasLimits 与入口渲染", () => {
 it("一个窗口都没有时 hasLimits 为 false", () => {
  expect(hasLimits(null)).toBe(false);
  expect(hasLimits(usage({ reports: [] }))).toBe(false);
  expect(hasLimits(usage({ reports: [report("p", [])] }))).toBe(false);
  expect(hasLimits(usage({ reports: [report("p", [limit("5h", 0.1)])] }))).toBe(true);
 });

 it("入口：有窗口数据、配了供应商，或查询失败都要渲染", () => {
  expect(hasUsageEntry(null, null)).toBe(false);
  expect(hasUsageEntry(usage({ reports: [] }), null)).toBe(false);
  // 只配了 commandcode 这种没探针的供应商：入口仍在（点开能看到「无用量数据」的解释）
  expect(hasUsageEntry(usage({ configuredProviders: ["commandcode"] }), null)).toBe(true);
  expect(hasUsageEntry(usage({ reports: [report("p", [limit("5h", 0.1)])], configuredProviders: ["p"] }), null)).toBe(true);
  // 从未成功过且失败：也要渲染（一个置灰的按钮，比什么都没有更容易理解）
  expect(hasUsageEntry(null, "读取用量限额失败：omp 命令超时")).toBe(true);
 });
});

describe("usageEntryDisabled", () => {
 const opencode = usage({
  reports: [report("opencode-go", [limit("5h", 0.41)])],
  configuredProviders: ["commandcode", "opencode-go"],
 });

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
  expect(usageEntryDisabled(usage({ ...opencode, configuredProviders: [] }), "commandcode", null)).toBeNull();
 });
});

describe("providersWithoutUsage", () => {
 const base = usage({
  reports: [report("opencode-go", [limit("5h", 0.41)])],
  configuredProviders: ["commandcode", "opencode-go"],
 });

 it("已配置 − 有报告 = 配了但拿不到用量的供应商", () => {
  expect(providersWithoutUsage(base, null)).toEqual(["commandcode"]);
 });

 it("当前会话的供应商排首位（最可能是「我明明在用」的那个）", () => {
  const many = usage({ ...base, configuredProviders: ["aaa", "commandcode", "opencode-go", "zzz"] });
  expect(providersWithoutUsage(many, "zzz")).toEqual(["zzz", "aaa", "commandcode"]);
  // 当前供应商有数据时顺序不动（无数据的仍按上游给的顺序）
  expect(providersWithoutUsage(many, "opencode-go")).toEqual(["aaa", "commandcode", "zzz"]);
 });

 it("补充探针已报失败 / 凭据已停用的不列为「拿不到」（有更精确的提示位置）", () => {
  const withFailures = usage({
   configuredProviders: ["aa", "bb", "cc"],
   extraFailures: [{ provider: "aa", message: "timeout" }],
   disabledCredentials: [{ provider: "bb", kind: "api_key", email: null, accountId: null, cause: null, disabledAtMs: null }],
  });
  expect(providersWithoutUsage(withFailures, null)).toEqual(["cc"]);
 });

 it("旧后端没有该字段 / 没有数据源时给空数组（不炸、不乱说）", () => {
  expect(providersWithoutUsage(null, "x")).toEqual([]);
  expect(providersWithoutUsage(usage({ ...base, configuredProviders: [] }), "x")).toEqual([]);
 });
});
