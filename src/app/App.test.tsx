// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { useApp } from "../stores/app";
import { topDialog } from "../lib/useDropdown";
import { isMacKeyboard } from "../lib/platform";
import { TEXT } from "../lib/locale";
import { api } from "@shared/api";
import { IPC } from "@shared/ipc";
import type { CheckoutView, ModelInfo, SessionView } from "@shared/types";

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
  createSession: vi.fn(async () => ({
   id: "new-1",
   projectId: "p1",
   title: "未命名会话",
   cwd: "/a/main",
   timestamp: 1,
   archived: false,
   corrupt: false,
   note: null,
   running: false,
  })),
  openSession: vi.fn(async () => ({
   id: "s-1",
   projectId: "p1",
   title: "会话",
   cwd: "/a",
   timestamp: 1,
   archived: false,
   corrupt: false,
   note: null,
   running: false,
  })),
  listProjects: vi.fn(async () => []),
  listCheckouts: vi.fn(async () => []),
  listWorkspaces: vi.fn(async () => []),
  listSessions: vi.fn(async () => ({ sessions: [], totalFiles: 0, scannedFiles: 0 })),
  listProjectFiles: vi.fn(async () => []),
  getWorkspaceGitState: vi.fn(async () => []),
  getGitInfo: vi.fn(async () => ({
   isRepo: false,
   branch: null,
   detached: false,
   branches: [],
   dirty: null,
   added: null,
   removed: null,
   error: null,
  })),
  syncTitlePrompt: vi.fn(async () => ({ path: "/tmp/TITLE_SYSTEM.md", action: "written" as const })),
  // 启动水合执行模式真值（覆盖层的本会话覆盖 + omp 全局默认档）：App 一起手就会读
  getOverlay: vi.fn(async () => ({
   version: 1 as const,
   projects: [],
   archived: {},
   notes: {},
   session_approval: {},
  })),
  getGlobalApproval: vi.fn(async () => "yolo"),
 },
}));
vi.mock("@tauri-apps/api/event", () => ({
 listen: vi.fn(async (event: string, handler: (e: { payload: unknown }) => void) => {
  eventListeners.set(event, handler);
  return () => eventListeners.delete(event);
 }),
}));
vi.mock("../components/sidebar/ChatSidebar", () => ({
 ChatSidebar: () => <div data-testid="chat-sidebar">chat-sidebar</div>,
}));
vi.mock("../components/thread/ChatView", () => ({
 ChatView: ({ visible }: { visible?: boolean }) => (
  <div data-testid="chat" data-visible={String(visible ?? true)}>
   chat
  </div>
 ),
}));
vi.mock("../components/SettingsPage", () => ({
 SettingsPage: ({ visible }: { visible?: boolean }) => (
  <div data-testid="settings" data-visible={String(visible ?? true)}>
   settings
  </div>
 ),
}));
vi.mock("../components/CommandPalette", () => ({
 CommandPalette: () => <div data-testid="palette">palette</div>,
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

const CHECKOUT: CheckoutView = {
 projectId: "p1",
 projectName: "Alpha",
 path: "/a/main",
 branch: "main",
 head: null,
 isMain: true,
 missing: false,
};

const SESSION: SessionView = {
 id: "s-1",
 projectId: "p1",
 title: "会话",
 cwd: "/a/main",
 timestamp: 1,
 archived: false,
 corrupt: false,
 note: null,
 running: false,
};

/** 快捷键的修饰键按平台分叉（与 `useHotkeys` 的判定同源）。 */
const mod = isMacKeyboard() ? { metaKey: true } : { ctrlKey: true };

beforeEach(() => {
 vi.clearAllMocks();
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
  checkouts: [CHECKOUT],
  settingsTabOpen: false,
  settingsTabActive: false,
  settingsSearchOpen: false,
  sidebarOpen: false,
  providerUsageOpen: false,
  refPickerTarget: null,
  paletteOpen: false,
  activeSessionId: null,
  sessions: [],
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

describe("应用外壳：左栏、设置视图与快捷键", () => {
 it("左栏常驻聊天侧栏（不再有形态切换）", () => {
  expect(container.querySelectorAll('[data-testid="chat-sidebar"]').length).toBe(1);
  expect(container.querySelector('[data-testid="chat"]')?.getAttribute("data-visible")).toBe("true");
 });

 it("⌘W 关设置视图（返回聊天）；设置开着时主区仍保住聊天视图", () => {
  act(() => useApp.getState().openSettingsTab());
  expect(container.querySelector('[data-testid="settings"]')?.getAttribute("data-visible")).toBe("true");
  expect(container.querySelector('[data-testid="chat"]')?.getAttribute("data-visible")).toBe("false");
  press({ key: "w", ...mod });
  expect(useApp.getState().settingsTabActive).toBe(false);
  expect(useApp.getState().settingsTabOpen).toBe(false);
  expect(container.querySelector('[data-testid="chat"]')?.getAttribute("data-visible")).toBe("true");
 });

 it("设置视图激活时聊天列整体退场（两个 flex-1 兄弟会平分主区，顶部凭空留白）", () => {
  const chatColumn = () =>
   (container.querySelector('[data-testid="chat"]') as HTMLElement).parentElement as HTMLElement;
  expect(chatColumn().className).toContain("flex-1");
  act(() => useApp.getState().openSettingsTab());
  expect(chatColumn().className).toContain("hidden");
  expect(chatColumn().className).not.toContain("flex-1");
  act(() => useApp.getState().closeSettingsTab());
  expect(chatColumn().className).toContain("flex-1");
  expect(chatColumn().className).not.toContain("hidden");
 });

 it("⌘, 打开设置视图并复位搜索；设置内 ⌘F 展开设置搜索、⌘W 关闭时一并复位", () => {
  press({ key: ",", ...mod });
  expect(useApp.getState().settingsTabOpen).toBe(true);
  expect(useApp.getState().settingsTabActive).toBe(true);
  press({ key: "f", ...mod });
  expect(useApp.getState().settingsSearchOpen).toBe(true);
  // 已打开时再按 ⌘, 不发生 toggle（只切过去，与系统惯例一致）
  press({ key: ",", ...mod });
  expect(useApp.getState().settingsTabActive).toBe(true);
  press({ key: "w", ...mod });
  expect(useApp.getState().settingsTabActive).toBe(false);
  expect(useApp.getState().settingsSearchOpen).toBe(false);
 });

 it("聊天视图 ⌘F 打开会话内查找（设置搜索不展开）", () => {
  useApp.setState({ activeSessionId: "s-1", sessions: [SESSION] });
  press({ key: "f", ...mod });
  expect(useApp.getState().findOpen).toBe(true);
  expect(useApp.getState().settingsSearchOpen).toBe(false);
 });

 it("⌘T 在第一个可用主目录新建聊天", async () => {
  press({ key: "t", ...mod });
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(vi.mocked(api.createSession)).toHaveBeenCalledWith("/a/main");
 });

 it("⌘K 切换命令中心（再按一次收起）", () => {
  press({ key: "k", ...mod });
  expect(useApp.getState().paletteOpen).toBe(true);
  expect(container.querySelector('[data-testid="palette"]')).not.toBeNull();
  press({ key: "k", ...mod });
  expect(useApp.getState().paletteOpen).toBe(false);
 });
});

describe("引用工作区文件快捷键（V22）", () => {
 it("⌘⇧P：目标 = 当前聊天会话（浮层注入 Composer 草稿）", async () => {
  act(() => {
   useApp.setState({ activeSessionId: "s-1", sessions: [SESSION] });
  });
  press({ key: "p", ...mod, shiftKey: true });
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(useApp.getState().refPickerTarget).toEqual({ sessionId: "s-1" });
  expect(container.textContent).toContain(TEXT["zh-CN"].refPickTitle);
 });

 it("输入框聚焦时 ⌘⇧P 照常打开（typing 守卫放行引用键）", () => {
  act(() => {
   useApp.setState({ activeSessionId: "s-1", sessions: [SESSION], refPickerTarget: null });
  });
  const ta = document.createElement("textarea");
  document.body.append(ta);
  act(() => ta.focus());
  expect(document.activeElement).toBe(ta);
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().refPickerTarget).toEqual({ sessionId: "s-1" });
  ta.remove();
 });

 it("设置视图激活时 ⌘⇧P 不触发", () => {
  act(() => {
   useApp.setState({ activeSessionId: "s-1", sessions: [SESSION], settingsTabActive: true });
  });
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().refPickerTarget).toBeNull();
 });

 it("没有打开会话时 ⌘⇧P 不触发；⌘P（不带 shift）不触发", () => {
  act(() => useApp.setState({ activeSessionId: null }));
  press({ key: "p", ...mod, shiftKey: true });
  expect(useApp.getState().refPickerTarget).toBeNull();
  act(() => useApp.setState({ activeSessionId: "s-1", sessions: [SESSION] }));
  press({ key: "p", ...mod });
  expect(useApp.getState().refPickerTarget).toBeNull();
 });

 it("浮层打开时 ⌘T 被对话框守卫挡住（不新建会话、不叠加浮层）", async () => {
  act(() => {
   useApp.setState({ activeSessionId: "s-1", sessions: [SESSION] });
  });
  press({ key: "p", ...mod, shiftKey: true });
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(topDialog(), "浮层应作为可见模态弹窗挂上").not.toBeNull();
  press({ key: "t", ...mod });
  press({ key: "p", ...mod, shiftKey: true });
  expect(vi.mocked(api.createSession)).not.toHaveBeenCalled();
  expect(useApp.getState().refPickerTarget).toEqual({ sessionId: "s-1" });
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
