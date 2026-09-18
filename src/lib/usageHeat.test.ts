import { describe, expect, it } from "vitest";
import type { UsageHeatRow } from "@shared/types";
import { heatLevel, heatThresholds, monthTicks } from "./usageHeat";

/** 从 `start`（周日）起造一段连续日历，只关心日期。 */
function calendar(start: string, days: number): UsageHeatRow[] {
  const [y, m, d] = start.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d);
  return Array.from({ length: days }, (_, i) => {
    const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
    return { date, total: 0, calls: 0 };
  });
}

describe("热力图分档", () => {
  it("没用量永远是 0 档", () => {
    expect(heatLevel(0, [1, 2, 3])).toBe(0);
    expect(heatLevel(0, heatThresholds([]))).toBe(0);
  });

  it("按非零值的四分位分档（边界归入较浅一档）", () => {
    // 非零值 [1,2,3,4] → 阈值 p25=1 / p50=2 / p75=3
    const t = heatThresholds([0, 1, 2, 3, 4]);
    expect(t).toEqual([1, 2, 3]);
    expect([1, 2, 3, 4, 5].map((v) => heatLevel(v, t))).toEqual([1, 2, 3, 4, 4]);
  });

  it("零值不参与分位（长期空窗不拉低阈值）", () => {
    // 100 天里只有 4 天有量：阈值仍由这 4 天决定
    const t = heatThresholds([...Array(96).fill(0), 10, 20, 30, 40]);
    expect(t).toEqual([10, 20, 30]);
    expect(heatLevel(40, t)).toBe(4);
  });

  it("全部为零时没有参照：空格仍是 0 档，正数落最浅一档", () => {
    const t = heatThresholds([0, 0, 0]);
    expect(heatLevel(0, t)).toBe(0);
    expect(heatLevel(1, t)).toBe(1);
  });

  it("只有一个非零值时没有区分度，落在最浅一档", () => {
    const t = heatThresholds([0, 5, 0]);
    expect(heatLevel(5, t)).toBe(1);
  });
});

describe("热力图月份刻度", () => {
  it("月份标注在包含 1 号的那一列（53 周窗口）", () => {
    // 2025-09-14 是周日：9 月的第一周不在窗口里，第一个标签是 10 月（09-28 那列含 10-01）
    const ticks = monthTicks(calendar("2025-09-14", 368), "en-US");
    expect(ticks[0]).toEqual({ col: 2, label: "Oct" });
    // 最后一个标签是 2026-09（08-30 那列含 09-01）
    expect(ticks.at(-1)).toEqual({ col: 50, label: "Sep" });
    // 每个月只标一次（Oct 2025 与 Oct 2026 不会同时出现在一年窗口里）
    expect(new Set(ticks.map((t) => t.label)).size).toBe(ticks.length);
  });

  it("窗口起点落在月中时，起点列不标（那个月的第一周不在日历里）", () => {
    // 2025-09-28 起一周：那一列含 10-01，标的是 Oct（不是 Sep）
    expect(monthTicks(calendar("2025-09-28", 7), "en-US")).toEqual([{ col: 0, label: "Oct" }]);
    // 2025-09-21 起一周：整周都在 9 月且不含 1 号 → 没有标签
    expect(monthTicks(calendar("2025-09-21", 7), "en-US")).toEqual([]);
  });

  it("标签跟随界面语言", () => {
    const [tick] = monthTicks(calendar("2025-09-28", 7), "zh-CN");
    expect(tick.col).toBe(0);
    expect(tick.label).toMatch(/10/);
  });
});
