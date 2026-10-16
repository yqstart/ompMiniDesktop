// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";

/**
 * 右栏工作台外壳（V42）：两个页签、停靠显隐、终端目录保留表。
 * 两个页签内容各自有测试（`FileTree.test.tsx` / `TerminalPane` 依赖真实 xterm，这里整块替换）。
 */
vi.mock("./TerminalPane", () => ({
 TerminalPane: ({ id, cwd }: { id: string; cwd: string }) => (
  <div data-testid="term" data-id={id}>
   {cwd}
  </div>
 ),
}));
vi.mock("./FileTree", () => ({
 FileTree: ({ root }: { root: string }) => <div data-testid="files">{root}</div>,
}));

import { WorkbenchPanel } from "./WorkbenchPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zh = TEXT["zh-CN"];

const session = (over: Partial<SessionView> = {}): SessionView => ({
 id: "s1",
 projectId: null,
 title: "会话",
 cwd: "/w/alpha",
 timestamp: 0,
 archived: false,
 corrupt: false,
 note: null,
 running: false,
 ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({
  locale: "zh-CN",
  sessions: [session()],
  activeSessionId: "s1",
  projects: [],
  workbenchOpen: true,
  workbenchTab: "files",
  workbenchWidth: 300,
  terminalCwds: [],
  settingsTabActive: false,
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

function render() {
 act(() => {
  root.render(<WorkbenchPanel />);
 });
}

/** 按文案找一个按钮（页签 / 关闭键）。 */
function buttonByText(text: string): HTMLButtonElement | null {
 return (
  [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text) ?? null
 );
}

describe("WorkbenchPanel", () => {
 it("默认页签是文件：以当前会话 cwd 为根渲染目录树", () => {
  render();
  expect(container.querySelector('[data-testid="files"]')?.textContent).toBe("/w/alpha");
  expect(container.querySelector('[data-testid="term"]')).toBeNull();
 });

 it("切到终端页签：渲染终端并把 cwd 记进保留表", () => {
  render();
  act(() => buttonByText(zh.workbenchTerminal)?.click());
  expect(useApp.getState().workbenchTab).toBe("terminal");
  const term = container.querySelector('[data-testid="term"]');
  expect(term?.textContent).toBe("/w/alpha");
  // 终端 id 由 cwd 派生（后端进程表按它寻址）
  expect(term?.getAttribute("data-id")).toBe("term:/w/alpha");
  expect(useApp.getState().terminalCwds).toEqual(["/w/alpha"]);
 });

 it("收起时整栏隐藏但仍挂载（终端进程与树的位置不丢）", () => {
  render();
  act(() => buttonByText(zh.workbenchTerminal)?.click());
  act(() => useApp.getState().setWorkbenchOpen(false));
  const aside = container.querySelector("aside");
  expect(aside?.className).toContain("hidden");
  expect(container.querySelector('[data-testid="term"]')).not.toBeNull();
 });

 it("没有会话时两个页签都给空态文案，不起终端", () => {
  useApp.setState({ sessions: [], activeSessionId: null, workbenchTab: "terminal" });
  render();
  expect(container.textContent).toContain(zh.workbenchNoSession);
  expect(container.querySelector('[data-testid="term"]')).toBeNull();
  expect(useApp.getState().terminalCwds).toEqual([]);
 });

 it("关闭键收起整栏", () => {
  render();
  act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${zh.workbenchCloseAria}"]`)?.click());
  expect(useApp.getState().workbenchOpen).toBe(false);
 });
});

describe("WorkbenchPanel 宽度", () => {
 /** jsdom 不做布局：给右缘一个真实坐标，「指针到右缘的距离」才算得出来。 */
 function stubRect(aside: HTMLElement, right: number) {
  aside.getBoundingClientRect = () =>
   ({ right, left: right - 300, top: 0, bottom: 600, width: 300, height: 600, x: right - 300, y: 0, toJSON: () => ({}) }) as DOMRect;
 }

 it("宽度来自 store，手柄带完整 aria 读数", () => {
  render();
  const aside = container.querySelector<HTMLElement>("aside");
  expect(aside?.style.width).toBe("300px");
  const handle = container.querySelector<HTMLElement>('[role="separator"]');
  expect(handle).not.toBeNull();
  expect(handle?.getAttribute("aria-valuenow")).toBe("300");
  expect(handle?.getAttribute("aria-valuemin")).toBe("260");
  expect(handle?.getAttribute("aria-label")).toBe(zh.workbenchResizeAria);
 });

 it("手柄聚焦后 ← 变宽、→ 变窄（每次 8px）", () => {
  render();
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(useApp.getState().workbenchWidth).toBe(308);
  act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
  expect(useApp.getState().workbenchWidth).toBe(300);
 });

 it("拖动左缘：宽度 = 指针到右栏右缘的距离（不看主区外边距）", () => {
  render();
  const aside = container.querySelector<HTMLElement>("aside")!;
  stubRect(aside, 1000);
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  act(() => {
   handle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
   window.dispatchEvent(new MouseEvent("pointermove", { clientX: 720 }));
  });
  expect(useApp.getState().workbenchWidth).toBe(280);
  act(() => window.dispatchEvent(new MouseEvent("pointerup")));
  // 松手后再动指针不再改宽度
  act(() => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500 })));
  expect(useApp.getState().workbenchWidth).toBe(280);
 });

 it("窗口约束：向左扩不过「给中列留 420px」的线", () => {
  // jsdom 视口 1024 - 左栏 292 - 中列 420 = 312 是当前上限
  render();
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  act(() => useApp.getState().setWorkbenchWidth(312));
  act(() => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true })));
  expect(useApp.getState().workbenchWidth).toBe(312);
 });
});
