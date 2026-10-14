// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { TopBar } from "./TopBar";

/**
 * 聊天 TopBar 的会话名编辑（点名字改名）：
 * - **回显当前显示名**再让用户改（用户口径：「重命名会话时，原来的内容应该先回显到输入框内」）——
 *   没有备注的会话此前开出来是空输入框，得对着上方看到的标题重打一遍；
 * - 原样回车 = 没改名：不写 omp（V40 起改名 = `set_session_name` 写 jsonl 真名）；
 * - 顶栏右端 = 只剩右面板开关（上下文容量环与供应商用量 2026-10-14 搬进输入卡工具行）。
 */

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({
 renameSession: vi.fn(async () => null),
 openSession: vi.fn(async () => {
  throw new Error("本用例不覆盖会话回读");
 }),
}));
vi.mock("@shared/api", () => ({
 api: {
  renameSession: mock.renameSession,
  openSession: mock.openSession,
 },
}));

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const TITLE = "删除内容（src/components/settings/）";

const session = (over: Partial<SessionView> = {}): SessionView => ({
 id: "s1",
 projectId: null,
 title: TITLE,
 cwd: "/w/alpha",
 timestamp: 0,
 archived: false,
 corrupt: false,
 note: null,
 running: false,
 ...over,
});

beforeEach(() => {
 mock.renameSession.mockClear();
 useApp.setState({
  sessions: [],
  activeSessionId: null,
  eventsBySession: {},
  currentRuntime: null,
  providerUsageOpen: false,
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

const noteInput = () => container.querySelector<HTMLInputElement>("header input");

function render() {
 act(() => root.render(<TopBar />));
}

function openEditor() {
 act(() => container.querySelector<HTMLButtonElement>('header button[aria-label^="会话标题"]')?.click());
}

function pressEnter(el: HTMLElement) {
 act(() => {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
 });
}

describe("聊天 TopBar 会话名编辑", () => {
 it("没有备注时回显 omp 原标题，而不是空输入框", () => {
  useApp.setState({ sessions: [session()], activeSessionId: "s1" });
  render();
  openEditor();
  expect(noteInput()?.value).toBe(TITLE);
 });

 it("有备注时回显备注（备注优先与后端 display_title 同口径）", () => {
  useApp.setState({ sessions: [session({ note: "设置提示改动" })], activeSessionId: "s1" });
  render();
  openEditor();
  expect(noteInput()?.value).toBe("设置提示改动");
 });

 it("原样回车 = 没改名：不写 omp，只关闭输入框", async () => {
  useApp.setState({ sessions: [session()], activeSessionId: "s1" });
  render();
  openEditor();
  pressEnter(noteInput()!);
  await act(async () => { });
  expect(mock.renameSession).not.toHaveBeenCalled();
  expect(noteInput()).toBeNull();
 });

 it("改过再回车：以新文本写 omp 真名（set_session_name）", async () => {
  useApp.setState({ sessions: [session()], activeSessionId: "s1" });
  render();
  openEditor();
  const input = noteInput()!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
   setter?.call(input, "设置提示语改动");
   input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  pressEnter(input);
  await act(async () => { });
  expect(mock.renameSession).toHaveBeenCalledWith("s1", "设置提示语改动");
 });

 it("顶栏右端只剩右面板开关：上下文容量环与供应商用量都在输入卡工具行", () => {
  useApp.setState({ contextPanelOpen: false });
  render();
  // 2026-10-14 起右上角不再有这两个入口（搬进 Composer 工具行，见 Composer.test.tsx）
  expect(container.querySelector('header button[aria-label="供应商用量"]')).toBeNull();
  expect(container.querySelector('header button[aria-label^="上下文容量"]')).toBeNull();
  const panel = container.querySelector<HTMLButtonElement>('header button[aria-label^="上下文面板"]');
  expect(panel).not.toBeNull();
  act(() => panel?.click());
  expect(useApp.getState().contextPanelOpen).toBe(true);
 });
});
