// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useApp } from "../stores/app";
import { isMacKeyboard } from "../lib/termInput";
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
 WorkspaceSidebar: () => <div data-testid="sidebar">sidebar</div>,
}));
vi.mock("../components/terminal/TerminalView", () => ({
 TerminalView: () => <div data-testid="terminals">terminals</div>,
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
  terminalFocusSeq: 0,
  localeMode: "system",
  locale: "zh-CN",
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
