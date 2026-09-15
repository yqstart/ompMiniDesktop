// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "@shared/types";
import { useApp } from "../stores/app";

/**
 * 命令中心（⌘K，V41）：动作清单渲染、过滤、Enter 执行、会话切换、Esc 关闭。
 */
const sessionRow: SessionView = {
 id: "s1",
 projectId: "p1",
 title: "演示会话",
 cwd: "/tmp/demo",
 timestamp: 0,
 archived: false,
 corrupt: false,
 note: null,
 running: false,
};

const { apiMock } = vi.hoisted(() => ({
 apiMock: {
  listSessions: vi.fn(
   async (): Promise<{ sessions: SessionView[]; totalFiles: number; scannedFiles: number }> => ({
    sessions: [],
    totalFiles: 0,
    scannedFiles: 0,
   }),
  ),
  openSession: vi.fn(async () => null),
  getHistory: vi.fn(async () => ({ lines: [], truncated: false })),
  getSessionRuntime: vi.fn(async () => null),
 },
}));
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));

import { CommandPalette } from "./CommandPalette";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 vi.clearAllMocks();
 apiMock.listSessions.mockResolvedValue({ sessions: [sessionRow], totalFiles: 1, scannedFiles: 1 });
 useApp.setState({
  paletteOpen: true,
  activeSessionId: "s1",
  sessions: [sessionRow],
  statsOpen: false,
  locale: "zh-CN",
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

const mount = async () => {
 act(() => root.render(<CommandPalette />));
 await act(async () => { });
 return container.querySelector<HTMLInputElement>("input")!;
};

const type = async (input: HTMLInputElement, text: string) => {
 const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
 act(() => {
  setter?.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
 });
 await act(async () => { });
};

const press = async (el: HTMLElement, init: KeyboardEventInit) => {
 await act(async () => {
  el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
 });
};

const options = () => [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];

describe("CommandPalette（⌘K 命令中心）", () => {
 it("渲染动作组和会话组（动作全列 + list_sessions 拉到的会话）", async () => {
  await mount();
  const text = container.textContent ?? "";
  expect(text).toContain("动作");
  expect(text).toContain("新建会话");
  expect(text).toContain("会话统计");
  expect(text).toContain("会话");
  expect(text).toContain("演示会话");
  expect(options().length).toBeGreaterThan(10);
 });

 it("过滤：输入「统计」只剩匹配项", async () => {
  const input = await mount();
  await type(input, "统计");
  expect(options()).toHaveLength(1);
  expect(options()[0].textContent).toContain("会话统计");
 });

 it("Enter 执行动作：会话统计 → statsOpen", async () => {
  const input = await mount();
  await type(input, "统计");
  await press(input, { key: "Enter" });
  expect(useApp.getState().statsOpen).toBe(true);
  expect(useApp.getState().paletteOpen).toBe(false);
 });

 it("搜索会话并 Enter：走 open_session 切过去", async () => {
  const input = await mount();
  await type(input, "演示");
  expect(options()[0].textContent).toContain("演示会话");
  await press(input, { key: "Enter" });
  await act(async () => { });
  expect(apiMock.openSession).toHaveBeenCalledWith("s1");
  expect(useApp.getState().paletteOpen).toBe(false);
 });

 it("Esc 关闭；↑↓ 移动高亮（不执行）", async () => {
  const input = await mount();
  await press(input, { key: "ArrowDown" });
  await press(input, { key: "ArrowUp" });
  expect(useApp.getState().statsOpen).toBe(false);
  await press(input, { key: "Escape" });
  expect(useApp.getState().paletteOpen).toBe(false);
 });
});
