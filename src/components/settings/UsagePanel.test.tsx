// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsageHeatRow, UsageStats } from "@shared/types";
import { useApp } from "../../stores/app";
import { UsagePanel } from "./UsagePanel";

/**
 * 使用统计页的热力图与区块口径：
 * - 热力图固定最近 53 周（后端给的 `heat`），不随范围切换；
 * - 「工具调用分布 / 时段分布 / 按项目」三块已删——工具种类数改走 totals.toolKinds。
 */

/** 368 天（2025-09-14 周日 → 2026-09-16），最后一天给一组好认的数字。 */
function makeHeat(): UsageHeatRow[] {
 const base = Date.UTC(2025, 8, 14);
 return Array.from({ length: 368 }, (_, i) => {
  const date = new Date(base + i * 86_400_000).toISOString().slice(0, 10);
  if (i === 367) return { date, total: 1_234_567, calls: 42 };
  const quiet = i % 5 === 0;
  return { date, total: quiet ? 0 : 1000 * (i + 1), calls: quiet ? 0 : 3 };
 });
}

const heat = makeHeat();

const usage: UsageStats = {
 totals: {
  input: 1000, output: 200, cacheRead: 300, cacheWrite: 0, reasoning: 0, total: 1500, cost: 0.5,
  calls: 12, sessions: 2, toolCalls: 30, toolKinds: 4, durationMs: 6000,
  activeDays: 5, currentStreak: 2, longestStreak: 3, cacheHitRate: 0.5,
  avgDailyTokens: 1000, peakHour: 15, peakHourTokens: 500, topModel: null,
 },
 byDay: heat.slice(-7).map((h) => ({
  date: h.date, input: 10, output: 20, cacheRead: 30, cacheWrite: 0, reasoning: 0,
  total: h.total, cost: 0.01, calls: h.calls,
 })),
 heat,
 byModel: [],
 scannedFiles: 2,
 truncated: false,
 rangeDays: 7,
 chartDays: 7,
};

vi.mock("@shared/api", () => ({ api: { getUsageStats: vi.fn(async () => usage) } }));

/** React 19 的 `act` 要求显式声明测试环境，否则每次调用都打警告。 */
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({ locale: "zh-CN" });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

const flush = async () => {
 await act(async () => {
  await delay(0);
  await delay(0);
 });
};

const render = async () => {
 act(() => {
  root.render(<UsagePanel />);
 });
 await flush();
};

const heatCells = (): Element[] => {
 const map = container.querySelector('[role="img"][aria-label="每日用量热力图"]');
 return map ? [...map.querySelectorAll("[title]")] : [];
};

describe("使用统计 › 热力图", () => {
 it("按后端给的 heat 逐日摆格子，并标出月份与图例", async () => {
  await render();
  expect(container.textContent).toContain("每日用量热力图");
  expect(container.textContent).toContain("最近 53 周");
  const cells = heatCells();
  expect(cells.length).toBe(heat.length);
  // 格子 title 就是那天的读数（与悬停读数同一口径）
  expect(cells.at(-1)!.getAttribute("title")).toContain("2026-09-16");
  // 月份刻度：2025-09-28 那一列含 10-01 → 「10月」；2026-09-08 那列含 09-01 → 「9月」
  expect(container.textContent).toContain("10月");
  expect(container.textContent).toContain("9月");
  // 图例两端
  expect(container.textContent).toContain("少");
  expect(container.textContent).toContain("多");
 });

 it("悬停某天时标题行显示那天的读数", async () => {
  await render();
  const cell = heatCells().at(-1)!;
  act(() => {
   cell.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
  expect(container.textContent).toContain("2026-09-16 · 1.23M tokens · 42 次请求");
 });
});

describe("使用统计 › 区块口径", () => {
 it("工具调用卡显示去重后的种类数，且不再渲染工具 / 时段 / 项目三块", async () => {
  await render();
  expect(container.textContent).toContain("4 种工具");
  expect(container.textContent).not.toContain("工具调用分布");
  expect(container.textContent).not.toContain("时段分布");
  expect(container.textContent).not.toContain("按项目");
  // 保留的区块仍在：每日趋势与按模型
  expect(container.textContent).toContain("每日 Token 趋势");
  expect(container.textContent).toContain("按模型");
 });
});
