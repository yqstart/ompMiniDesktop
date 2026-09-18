import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderUsage, ProviderUsageReport, UsageLimit } from "@shared/types";
import {
 fmtAmount,
 fmtPercent,
 formatAgo,
 formatDuration,
 groupReports,
 hasBar,
 latestFetchedAt,
 levelOf,
 providersWithoutUsage,
 remainingText,
 usedLimitText,
 type ProviderUsageSnapshot,
} from "./providerUsage";

/** 造一个窗口（只写关心的字段，其余给中性值）。 */
const limit = (over: Partial<UsageLimit> = {}): UsageLimit => ({
 id: "rolling-5h",
 label: "5 Hour limit",
 windowId: "5h",
 windowLabel: "5 Hour",
 usedFraction: 0.5,
 percent: 50,
 status: "ok",
 resetsAt: null,
 durationMs: 18_000_000,
 notes: [],
 used: null,
 limit: null,
 remaining: null,
 unit: "percent",
 ...over,
});

const report = (provider: string, over: Partial<ProviderUsageReport> = {}): ProviderUsageReport => ({
 provider,
 planType: null,
 accountLabel: null,
 fetchedAt: 1000,
 limits: [],
 ...over,
});

const usage = (over: Partial<ProviderUsage> = {}): ProviderUsage => ({
 generatedAt: 2000,
 reports: [],
 accountsWithoutUsage: [],
 disabledCredentials: [],
 configuredProviders: [],
 extraFailures: [],
 ...over,
});

describe("groupReports", () => {
 it("按 provider 分组且保持上游顺序（同 provider 的多账号合并成一组）", () => {
  const groups = groupReports([
   report("opencode-go", { accountLabel: "a" }),
   report("anthropic"),
   report("opencode-go", { accountLabel: "b" }),
  ]);
  expect(groups.map((g) => g.provider)).toEqual(["opencode-go", "anthropic"]);
  expect(groups[0].reports.map((r) => r.accountLabel)).toEqual(["a", "b"]);
  expect(groups[1].reports).toHaveLength(1);
 });
});

describe("levelOf", () => {
 it("按比例分档：<80% 充足、≥80% 警告、≥100% 用尽", () => {
  expect(levelOf(limit({ usedFraction: 0.5 }))).toBe("ok");
  expect(levelOf(limit({ usedFraction: 0.79 }))).toBe("ok");
  expect(levelOf(limit({ usedFraction: 0.8 }))).toBe("warn");
  expect(levelOf(limit({ usedFraction: 1 }))).toBe("danger");
  expect(levelOf(limit({ usedFraction: 1.2, percent: 120 }))).toBe("danger");
 });
 it("上游 status 优先：exhausted 直接红、warning 直接黄（即使比例没到阈值）", () => {
  expect(levelOf(limit({ status: "exhausted", usedFraction: 0.3 }))).toBe("danger");
  expect(levelOf(limit({ status: "warning", usedFraction: 0.1 }))).toBe("warn");
 });
});

describe("latestFetchedAt", () => {
 it("取各报告里最新的抓取时刻；没有报告或全为 0 时给 null", () => {
  expect(latestFetchedAt(usage({ reports: [report("a", { fetchedAt: 100 }), report("b", { fetchedAt: 900 })] }))).toBe(900);
  expect(latestFetchedAt(usage())).toBeNull();
  expect(latestFetchedAt(null)).toBeNull();
 });
});

describe("providersWithoutUsage", () => {
 it("configured − reports（保持字母序）；没有模型目录数据时为空", () => {
  const u = usage({
   reports: [report("opencode-go")],
   configuredProviders: ["anthropic", "commandcode", "opencode-go"],
  });
  expect(providersWithoutUsage(u)).toEqual(["anthropic", "commandcode"]);
  expect(providersWithoutUsage(usage({ configuredProviders: [] }))).toEqual([]);
  expect(providersWithoutUsage(null)).toEqual([]);
 });
 it("补充探针失败的供应商不算「无用量数据」（它们走「查询失败」块）", () => {
  const u = usage({
   reports: [report("opencode-go")],
   configuredProviders: ["commandcode", "opencode-go"],
   extraFailures: [{ provider: "commandcode", message: "HTTP 401" }],
  });
  expect(providersWithoutUsage(u)).toEqual([]);
 });
 it("停用凭据的供应商也不算「无用量数据」（它们走「已停用的凭据」块）", () => {
  const u = usage({
   configuredProviders: ["opencode-go", "zai"],
   disabledCredentials: [
    { provider: "zai", kind: "oauth", email: "old@example.com", accountId: null, cause: "refresh failed", disabledAtMs: 1 },
   ],
  });
  expect(providersWithoutUsage(u)).toEqual(["opencode-go"]);
 });
});

describe("fmtPercent", () => {
 it("≥10% 取整，小比例留一位小数", () => {
  expect(fmtPercent(50)).toBe("50%");
  expect(fmtPercent(8.04)).toBe("8.0%");
  expect(fmtPercent(9.55)).toBe("9.6%");
  expect(fmtPercent(100)).toBe("100%");
  expect(fmtPercent(120.4)).toBe("120%");
 });
});

describe("金额窗口与余额窗口", () => {
 it("fmtAmount：已知货币走符号 + 两位小数；其它单位「数字 + 单位」", () => {
  expect(fmtAmount("usd", 14)).toBe("$14.00");
  expect(fmtAmount("USD", 0.306)).toBe("$0.31");
  expect(fmtAmount("cny", 110)).toBe("¥110.00");
  expect(fmtAmount("credits", 3)).toBe("3 credits");
  expect(fmtAmount("tokens", 1234.5)).toBe("1234.50 tokens");
 });
 it("usedLimitText / remainingText / hasBar：金额窗口、余额窗口、百分比窗口各走各的", () => {
  const money = limit({ used: 0.306, limit: 14, remaining: 13.69, unit: "usd", usedFraction: 0.0219, percent: 2.19 });
  expect(usedLimitText(money)).toBe("$0.31 / $14.00");
  expect(remainingText(money)).toBeNull();
  expect(hasBar(money)).toBe(true);

  const balance = limit({ id: "balance-cny", windowId: "balance", used: null, limit: null, remaining: 110, unit: "cny" });
  expect(usedLimitText(balance)).toBeNull();
  expect(remainingText(balance)).toBe("¥110.00");
  expect(hasBar(balance), "余额没有比例，不画条").toBe(false);

  const percent = limit();
  expect(usedLimitText(percent)).toBeNull();
  expect(remainingText(percent)).toBeNull();
  expect(hasBar(percent), "百分比窗口照旧画条").toBe(true);
 });
});

describe("相对时间文案", () => {
 it("formatDuration：分钟 / 小时+分 / 天+小时，负数与不足一分钟都钳到「不到 1 分钟」", () => {
  expect(formatDuration(30_000, "zh-CN")).toBe("不到 1 分钟");
  expect(formatDuration(-5000, "zh-CN")).toBe("不到 1 分钟");
  expect(formatDuration(5 * 60_000, "zh-CN")).toBe("5 分钟");
  expect(formatDuration(90 * 60_000, "zh-CN")).toBe("1 小时 30 分");
  expect(formatDuration(2 * 3_600_000, "zh-CN")).toBe("2 小时");
  expect(formatDuration(50 * 3_600_000, "zh-CN")).toBe("2 天 2 小时");
  expect(formatDuration(48 * 3_600_000, "zh-CN")).toBe("2 天");
  expect(formatDuration(90 * 60_000, "en")).toBe("1h 30m");
  expect(formatDuration(48 * 3_600_000, "en")).toBe("2d");
 });
 it("formatAgo：中文「N前」、英文 «N ago»", () => {
  expect(formatAgo(5 * 60_000, "zh-CN")).toBe("5 分钟前");
  expect(formatAgo(5 * 60_000, "en")).toBe("5m ago");
 });
});

// ---------- 模块级快照（拉取 / 节流 / 单飞 / 失败保留） ----------

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿一个能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({ getProviderUsage: vi.fn() }));
vi.mock("@shared/api", () => ({ api: { getProviderUsage: mock.getProviderUsage } }));

/**
 * 每个用例拿一份全新的模块实例——模块级快照是单例，用例间必须隔离。
 * 这里刻意用动态 import 触发模块重载（vitest 的模块加载边界测试场景）：
 * 静态 import 拿到的初态会被前一个用例污染。
 */
async function freshModule() {
 vi.resetModules();
 return await import("./providerUsage");
}

const data = (over: Partial<ProviderUsage> = {}) =>
 usage({ reports: [report("opencode-go", { planType: "OpenCode Go", limits: [limit()] })], ...over });

async function snapshotOf(m: { providerUsageSnapshot: () => ProviderUsageSnapshot }) {
 return m.providerUsageSnapshot();
}

beforeEach(() => {
 mock.getProviderUsage.mockReset();
});

describe("数据层：拉取与快照", () => {
 it("首次拉取填充快照；60s 内非强制调用走缓存不再请求，force 才重拉", async () => {
  const m = await freshModule();
  mock.getProviderUsage.mockResolvedValue(data());
  await m.loadProviderUsage();
  expect(mock.getProviderUsage).toHaveBeenCalledTimes(1);
  const snap = m.providerUsageSnapshot();
  expect(snap.data?.reports[0].planType).toBe("OpenCode Go");
  expect(snap.error).toBeNull();
  expect(snap.loading).toBe(false);

  await m.loadProviderUsage();
  expect(mock.getProviderUsage).toHaveBeenCalledTimes(1);

  await m.loadProviderUsage(true);
  expect(mock.getProviderUsage).toHaveBeenCalledTimes(2);
 });

 it("失败保留上一份数据并给出错误（界面显示旧值 + 错误行，不闪空）", async () => {
  const m = await freshModule();
  mock.getProviderUsage.mockResolvedValueOnce(data());
  await m.loadProviderUsage();
  mock.getProviderUsage.mockRejectedValueOnce(new Error("读取供应商用量失败：omp 命令超时"));
  await m.loadProviderUsage(true);
  const snap = m.providerUsageSnapshot();
  expect(snap.data?.reports).toHaveLength(1);
  expect(snap.error).toContain("超时");
  expect(snap.loading).toBe(false);
 });

 it("单飞：进行中的请求被并发调用复用（force 也等它）", async () => {
  const m = await freshModule();
  let release: (v: ProviderUsage) => void = () => { };
  mock.getProviderUsage.mockImplementationOnce(
   () => new Promise<ProviderUsage>((resolve) => {
    release = resolve;
   }),
  );
  const p1 = m.loadProviderUsage();
  const p2 = m.loadProviderUsage(true);
  expect(mock.getProviderUsage).toHaveBeenCalledTimes(1);
  release(data());
  await Promise.all([p1, p2]);
  expect(mock.getProviderUsage).toHaveBeenCalledTimes(1);
  expect((await snapshotOf(m)).data?.reports).toHaveLength(1);
 });
});
