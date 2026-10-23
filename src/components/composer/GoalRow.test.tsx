// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Goal } from "@shared/types";
import { useApp } from "../../stores/app";
import { GoalRow } from "./GoalRow";

/**
 * 目标条的状态映射（2026-10-23 用户实测）：omp 的 GoalStatus 有
 * `active / paused / budget-limited / complete / dropped`，此前只认 paused，
 * 其余一律「进行中」——已完成的目标看着还在跑、清除后的目标条不消失。
 * `dropped` 由 `goalFromWire` 归一成 null（不在 store 里出现），这里锁组件对
 * 另外四档的呈现与操作面。
 */

vi.mock("@shared/api", () => ({
 api: { goalCommand: vi.fn(async () => ({ goal: null, state: null })) },
}));

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

const base: Goal = { id: "g1", objective: "跑通目标模式", status: "active", tokensUsed: 1, timeUsedSeconds: 0 };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({ activeSessionId: "s1", goalBySession: { s1: { ...base } }, locale: "zh-CN" });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

const render = (goal: Goal) => {
 useApp.setState({ goalBySession: { s1: goal } });
 act(() => {
  root.render(<GoalRow onEdit={() => undefined} />);
 });
};

const button = (label: string) => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

describe("目标条状态", () => {
 it("active：进行中 + 暂停键", () => {
  render(base);
  expect(container.textContent ?? "").toContain("进行中");
  expect(button("暂停")).not.toBeNull();
 });

 it("paused：已暂停 + 继续键", () => {
  render({ ...base, status: "paused" });
  expect(container.textContent ?? "").toContain("已暂停");
  expect(button("继续")).not.toBeNull();
 });

 it("complete：已完成，不再摆暂停键", () => {
  render({ ...base, status: "complete" });
  expect(container.textContent ?? "").toContain("已完成");
  expect(container.textContent ?? "").not.toContain("进行中");
  expect(button("暂停")).toBeNull();
  expect(button("继续")).toBeNull();
 });

 it("budget-limited：已达预算，仍可暂停", () => {
  render({ ...base, status: "budget-limited" });
  expect(container.textContent ?? "").toContain("已达预算");
  expect(button("暂停")).not.toBeNull();
 });
});
