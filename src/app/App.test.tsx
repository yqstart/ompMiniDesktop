// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useApp } from "../stores/app";
import { isMacKeyboard } from "../lib/termInput";
import { TEXT } from "../lib/locale";
import { api } from "@shared/api";
import { IPC } from "@shared/ipc";
import type { ModelInfo, TerminalView } from "@shared/types";

/** 事件监听注册表（mock 的 `listen` 把回调存这里，测试直接触发）。 */
const eventListeners = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>());

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@shared/api", () => ({
 api: {
  getModels: vi.fn(async () => ({ models: [], fetchedAt: 0 })),
  getHealth: vi.fn(async () => ({
   omp: { ompPath: "/usr/bin/omp", ompVersion: "18.2.2", agentDir: "/tmp", errors: [] },
   modelsError: null,
   ok: true,
  })),
  ptySpawn: vi.fn(async () => undefined),
  ptyWrite: vi.fn(async () => undefined),
  ptyResize: vi.fn(async () => undefined),
  ptyKill: vi.fn(async () => undefined),
  listProjects: vi.fn(async () => []),
  listCheckouts: vi.fn(async () => []),
  listWorkspaces: vi.fn(async () => []),
  listProjectFiles: vi.fn(async () => []),
  getWorkspaceGitState: vi.fn(async () => []),
  syncTitlePrompt: vi.fn(async () => ({ path: "/tmp/TITLE_SYSTEM.md", action: "written" as const })),
 },
}));
vi.mock("@tauri-apps/api/event", () => ({
 listen: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
  eventListeners.set(event, handler);
  return () => eventListeners.delete(event);
 }),
}));
vi.mock("../components/sidebar/WorkspaceSidebar", () => ({
 WorkspaceSidebar: ({ visible = true }: { visible?: boolean }) => (
  <div data-testid="sidebar" data-visible={String(visible)}>
   sidebar
  </div>
 ),
}));
vi.mock("../components/sidebar/ChatSidebar", () => ({
 ChatSidebar: ({ visible = true }: { visible?: boolean }) => (
  <div data-testid="chat-sidebar" data-visible={String(visible)}>
   chat-sidebar
  </div>
 ),
}));
vi.mock("../components/terminal/TerminalView", () => ({
 TerminalView: () => <div data-testid="terminals">terminals</div>,
}));
vi.mock("../components/thread/ChatView", () => ({
 ChatView: ({ visible }: { visible?: boolean }) => (
  <div data-testid="chat" data-visible={String(visible ?? true)}>
   chat
  </div>
 ),
}));
vi.mock("../components/git/CommitTaskPanel", () => ({
 CommitTaskPanel: () => null,
}));
vi.mock("../components/update/UpdateDialog", () => ({
 UpdateDialog: () => null,
}));

let container: HTMLDivElement;
let root: Root;

function press(options: KeyboardEventInit) {
 act(() => {
  window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...options }));
 });
}

const makeTerm = (id: string, cwd: string): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status: "running", exitCode: null, resume: null, collab: [], spawnSeq: 0, createdAt: 1 });

/** 快捷键的修饰键按平台分叉（与 `useTerminalHotkeys` 的判定同源）。 */
const mod = isMacKeyboard() ? { metaKey: true } : { ctrlKey: true };

beforeEach(() => {
 Object.defineProperty(window, "matchMedia", {
  value: (query: string) => ({
   matches: query.includes("767") ? false : true,
   media: query,
   addEventListener: () => undefined,
   removeEventListener: () => undefined,
   addListener: () => undefined,
   removeListener: () => undefined,
   dispatchEvent: () => false,
  }),
  configurable: true,
 });
 useApp.setState({
  terminals: [makeTerm("t-1", "/a")],
  activeTerminalId: "t-1",
  selection: { kind: "checkout", path: "/a" },
  closingTerminalId: null,
  settingsTabOpen: false,
  settingsTabActive: false,
  sidebarOpen: false,
  quickSwitcherOpen: false,
  refPickerTarget: null,
  terminalFocusSeq: 0,
  localeMode: "system",
  locale: "zh-CN",
  appMode: "terminal",
  chatFormUsed: false,
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
 act(() => {
  root.render(<App />);
 });
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

describe("会话标题语言同步", () => {
 it("健康检查落定后按界面语言写标题 prompt，切语言再写一次", async () => {
  // 挂载时 health 还没落定（mock 是异步的）——等一次宏任务把 getHealth → set → effect 走完
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(vi.mocked(api.syncTitlePrompt)).toHaveBeenCalledWith("zh");
  const before = vi.mocked(api.syncTitlePrompt).mock.calls.length;
  act(() => useApp.getState().setLocaleMode("en"));
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(vi.mocked(api.syncTitlePrompt)).toHaveBeenLastCalledWith("en");
  expect(vi.mocked(api.syncTitlePrompt).mock.calls.length).toBeGreaterThan(before);
 });
});

describe("应用外壳快捷键与侧栏", () => {
 it("输入框聚焦时不切换后台终端，只阻断默认行为", () => {
  const input = document.createElement("input");
  document.body.append(input);
  act(() => input.focus());
  const before = useApp.getState().activeTerminalId;
  press({ key: "1", metaKey: true });
  expect(useApp.getState().activeTerminalId).toBe(before);
  input.remove();
 });

 it("桌面只挂载一份侧栏", () => {
  expect(container.querySelectorAll('[data-testid="sidebar"]').length).toBe(1);
  // 聊天侧栏懒挂载：纯终端形态下不挂（不白付聊天侧的读盘调用）
  expect(container.querySelectorAll('[data-testid="chat-sidebar"]').length).toBe(0);
 });

 it("形态切换：左栏随形态互换（聊天侧栏首次用到才挂载，两栏都只切显隐）", () => {
  act(() => useApp.getState().setAppMode("chat"));
  expect(container.querySelector('[data-testid="sidebar"]')?.getAttribute("data-visible")).toBe("false");
  expect(container.querySelector('[data-testid="chat-sidebar"]')?.getAttribute("data-visible")).toBe("true");
  act(() => useApp.getState().setAppMode("terminal"));
  expect(container.querySelector('[data-testid="sidebar"]')?.getAttribute("data-visible")).toBe("true");
  expect(container.querySelector('[data-testid="chat-sidebar"]')?.getAttribute("data-visible")).toBe("false");
 });

 it("⌘1..9 只在当前选中范围的终端里编号", () => {
  act(() => {
   useApp.setState({
    terminals: [makeTerm("t-a", "/a"), makeTerm("t-b1", "/b"), makeTerm("t-b2", "/b")],
    activeTerminalId: "t-b1",
    selection: { kind: "checkout", path: "/b" },
   });
  });
  // /b 的第一个标签是 t-b1（全局列表里的第一个是别的范围的 t-a）
  press({ key: "1", ...mod });
  expect(useApp.getState().activeTerminalId).toBe("t-b1");
  press({ key: "2", ...mod });
  expect(useApp.getState().activeTerminalId).toBe("t-b2");
 });
});

describe("引用工作区文件快捷键（V22）", () => {
 it("⌘⇧P 在终端标签上打开引用浮层并快照目标终端", async () => {
  press({ key: "p", ...mod, shiftKey: true });
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(useApp.getState().refPickerTarget).toEqual({ kind: "terminal", id: "t-1" });
  expect(container.textContent).toContain(TEXT["zh-CN"].refPickTitle);
 });

 it("聊天形态 ⌘⇧P：目标 = 当前聊天会话（浮层注入 Composer 草稿）", async () => {
  act(() => {
   useApp.setState({
    appMode: "chat",
    activeSessionId: "s-1",
    sessions: [
     { id: "s-1", projectId: "p1", title: "会话", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: null, running: false },
    ],
   });
  });
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().refPickerTarget).toEqual({ kind: "chat", sessionId: "s-1" });
  expect(container.textContent).toContain(TEXT["zh-CN"].refPickTitle);
 });

 it("聊天形态输入框聚焦时 ⌘⇧P 照常打开（typing 守卫放行引用键）", () => {
  act(() => {
   useApp.setState({
    appMode: "chat",
    activeSessionId: "s-1",
    sessions: [
     { id: "s-1", projectId: "p1", title: "会话", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: null, running: false },
    ],
    refPickerTarget: null,
   });
  });
  const ta = document.createElement("textarea");
  document.body.append(ta);
  act(() => ta.focus());
  expect(document.activeElement).toBe(ta);
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().refPickerTarget).toEqual({ kind: "chat", sessionId: "s-1" });
  ta.remove();
 });
 it("设置标签激活时 ⌘⇧P 不触发", () => {
  act(() => useApp.setState({ settingsTabActive: true }));
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().refPickerTarget).toBeNull();
 });

 it("⌘P（不带 shift）不触发引用浮层", () => {
  press({ key: "p", ...mod });
  expect(useApp.getState().refPickerTarget).toBeNull();
 });

 it("浮层打开时 ⌘T / ⌘⇧P 被对话框守卫挡住（不新建终端、不叠加浮层）", async () => {
  press({ key: "p", ...mod, shiftKey: true });
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const before = useApp.getState().terminals.length;
  press({ key: "t", ...mod });
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().terminals.length).toBe(before);
  expect(useApp.getState().refPickerTarget).toEqual({ kind: "terminal", id: "t-1" });
 });
});

describe("模型目录快照事件", () => {
 it("后端广播的新快照直接换掉 store.models", async () => {
  // 等挂载期的异步落定（listen 注册是 promise 链）
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const handler = eventListeners.get(IPC.modelsRefreshed);
  expect(handler, "App 应订阅 omp-models://catalog").toBeTruthy();
  const model: ModelInfo = {
   provider: "demo",
   id: "one",
   selector: "demo/one",
   name: "One",
   contextWindow: null,
   maxTokens: null,
   reasoning: null,
   thinking: null,
   input: null,
  };
  act(() => {
   handler!({ payload: { models: [model], fetchedAt: 123 } });
  });
  expect(useApp.getState().models).toEqual({ models: [model], fetchedAt: 123 });
 });
});
