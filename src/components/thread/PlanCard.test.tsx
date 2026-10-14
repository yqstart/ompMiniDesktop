// @vitest-environment jsdom
/**
 * 任务清单浮卡（v2）渲染与开合回归：
 * - 无清单 / 隐藏态不渲染；展开态列出阶段与任务（状态符号 + 比例 + 阻塞说明）；
 * - 收起为徽标、点徽标展开、X 隐藏（写 store 的 `planCardBySession`）；
 * - 全部完成自动折叠为 ✓ 徽标（同一份清单只折一次——手动再展开不被再次折叠）。
 */
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TodoPhase } from "@shared/types";
import { useApp } from "../../stores/app";
import { PlanCard } from "./PlanCard";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const roots: Root[] = [];
afterEach(() => {
 act(() => {
  roots.splice(0).forEach((r) => r.unmount());
 });
 document.body.innerHTML = "";
});

const PHASES: TodoPhase[] = [
 {
  name: "实现",
  tasks: [
   { content: "已完成的项", status: "completed" },
   { content: "进行中的项", status: "in_progress" },
   { content: "待办项", status: "pending" },
  ],
 },
];

function mount() {
 const container = document.createElement("div");
 document.body.appendChild(container);
 const root = createRoot(container);
 roots.push(root);
 act(() => {
  root.render(createElement(PlanCard));
 });
 return container;
}

function seed(plans: Record<string, TodoPhase[]>, card: Record<string, "expanded" | "collapsed" | "hidden">) {
 act(() => {
  useApp.setState({ activeSessionId: "s1", locale: "zh-CN", plansBySession: plans, planCardBySession: card });
 });
}

describe("任务清单浮卡（PlanCard）", () => {
 it("无清单 / 隐藏态不渲染", () => {
  seed({}, {});
  expect(mount().textContent).toBe("");
  seed({ s1: PHASES }, { s1: "hidden" });
  expect(mount().textContent).toBe("");
 });

 it("展开态列出任务、比例与阻塞说明", () => {
  seed(
   {
    s1: [{ name: "阶段", tasks: [{ content: "卡住项", status: "blocked", blocker: "等上游修复" }] }],
   },
   { s1: "expanded" },
  );
  const c = mount();
  expect(c.textContent).toContain("任务清单");
  expect(c.textContent).toContain("卡住项");
  expect(c.textContent).toContain("等上游修复");
  expect(c.textContent).toContain("0/1");
  expect(c.textContent).toContain("⊘");
 });

 it("收起为徽标（n/m）、点徽标再展开、X 隐藏", () => {
  seed({ s1: PHASES }, { s1: "collapsed" });
  const c = mount();
  // 折叠态：只有徽标（进度 + 点击展开的 aria 文案），没有清单行
  expect(c.textContent).toContain("1/3");
  expect(c.textContent).not.toContain("已完成的项");
  const badge = c.querySelector<HTMLButtonElement>('button[aria-label="任务清单 1/3，点击展开"]')!;
  act(() => {
   badge.click();
  });
  expect(useApp.getState().planCardBySession["s1"]).toBe("expanded");
  expect(c.textContent).toContain("已完成的项");
  // X = 隐藏（本次计划不再出现）
  const hide = c.querySelector<HTMLButtonElement>('button[aria-label="隐藏任务清单"]')!;
  act(() => {
   hide.click();
  });
  expect(useApp.getState().planCardBySession["s1"]).toBe("hidden");
  expect(c.textContent).toBe("");
 });

 it("全部完成自动折叠为 ✓ 徽标；手动再展开不被再次折叠", () => {
  seed(
   {
    s1: [{ name: "阶段", tasks: [{ content: "甲", status: "completed" }, { content: "乙", status: "completed" }] }],
   },
   { s1: "expanded" },
  );
  const c = mount();
  expect(useApp.getState().planCardBySession["s1"]).toBe("collapsed");
  expect(c.textContent).toContain("2/2");
  expect(c.textContent).not.toContain("甲");
  // 用户手动再展开看完成清单：不再被自动折叠打扰
  const badge = c.querySelector("button")!;
  act(() => {
   badge.click();
  });
  expect(useApp.getState().planCardBySession["s1"]).toBe("expanded");
  expect(c.textContent).toContain("甲");
 });
});
