// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT, fmt } from "../../lib/locale";

/**
 * Composer 三件事：
 * 1. 工具行的构成：`+` 菜单 / 执行模式 / 排队徽标 / 模型·思考档 / 发送；
 *    卡底统计条（2026-10-16）= 会话统计 / Token 用量 / 上下文容量环 / 供应商用量
 *    （2026-10-14 容量环与用量从顶栏右端搬回输入卡，见 `docs/` 与 `design-system/MASTER.md`）；
 * 2. 发送语义（V39，对齐 omp 终端与 codex）：流式中 Enter = 插话（steer）、Tab / ⌘Ctrl+Enter = 排队
 *    （follow_up；运行中工具行的「排队」按钮 2026-10-13 按用户口径退场）；
 * 3. V40/V41 增量：Shift+Tab 执行模式循环、Esc 中断还原队列、待发区 = 队列真值（撤回 / 编辑 / 提升）、
 *    壳本地命令拦截（/goal /status …不进 omp）。
 * 执行模式的真值口径（覆盖层水合 / 写全局默认 + 本会话覆盖）另见 `lib/sessionApproval.test.ts`。
 */

/** 发送语义要断言 IPC 参数：spy 替身；其余命令给最小可用返回值。 */
const { apiMock } = vi.hoisted(() => ({
 apiMock: {
  sendMessage: vi.fn(async (_sid: string, _text: string, _images?: unknown) => undefined),
  steerMessage: vi.fn(async (_sid: string, _text: string, _images?: unknown) => undefined),
  followUpMessage: vi.fn(async (_sid: string, _text: string, _images?: unknown) => undefined),
  runSlash: vi.fn(async (_sid: string, _cmd: string) => undefined),
  stop: vi.fn(async (_sid: string) => undefined),
  checkPaths: vi.fn(
   async (_base: string, _paths: string[]): Promise<{ path: string; exists: boolean; isDir: boolean; resolved: string | null }[]> => [],
  ),
  completePath: vi.fn(
   async (_base: string, _prefix: string): Promise<{ path: string; real: string; isDir: boolean; label: string }[]> => [],
  ),
  removeQueuedMessage: vi.fn(async () => ({ removed: true })),
  promoteQueuedMessage: vi.fn(async () => ({ promoted: true })),
  abortAndRestoreQueue: vi.fn(async () => ({ steering: [] as { text: string }[], followUp: [] as { text: string }[] })),
  setSessionApproval: vi.fn(async (_id: string, _mode: string) => undefined),
  setGlobalApproval: vi.fn(async (_mode: string) => undefined),
  getGlobalApproval: vi.fn(async () => "write"),
  restartSessionRuntime: vi.fn(async () => null),
  // 供应商用量：入口侧按「全部已配置供应商」渲染（与当前模型无关），见下面的用例
  getProviderUsage: vi.fn(async () => ({
   generatedAt: 1,
   reports: [
    { provider: "aaa", planType: null, accountLabel: null, fetchedAt: 1, limits: [limit5h("aaa", 12)] },
    { provider: "bbb", planType: null, accountLabel: null, fetchedAt: 1, limits: [balance("bbb", 54.77)] },
    { provider: "ccc", planType: null, accountLabel: null, fetchedAt: 1, limits: [limit5h("ccc", 56)] },
    { provider: "ddd", planType: null, accountLabel: null, fetchedAt: 1, limits: [limit5h("ddd", 78)] },
   ],
   accountsWithoutUsage: [],
   disabledCredentials: [],
   configuredProviders: ["aaa", "bbb", "ccc", "ddd"],
   extraFailures: [],
  })),
  goalCommand: vi.fn(async (_id: string, _op: string, _obj?: string) => ({ goal: null, state: null })),
  forkSession: vi.fn(async () => null),
  savePaste: vi.fn(async (_text: string) => ({ path: "/tmp/paste/paste-1.txt" })),
  setFastMode: vi.fn(async (_id: string, _on: boolean) => ({ enabled: true, active: true })),
  setSlowMode: vi.fn(async (_id: string, _on: boolean) => ({ enabled: true })),
  exportSessionHtml: vi.fn(async (_id: string) => ({ path: "/tmp/demo/omp-session-x.html" })),
  runBash: vi.fn(async (_id: string, _cmd: string) => ({
   exitCode: 0,
   cancelled: false,
   workingDir: "/tmp/demo",
   output: "hello-shell\n",
   truncated: false,
   outputLines: 1,
   totalLines: 1,
  })),
 },
}));
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));

const { openerMock } = vi.hoisted(() => ({ openerMock: { openPath: vi.fn(async () => undefined) } }));
vi.mock("@tauri-apps/plugin-opener", () => openerMock);

import { Composer } from "./Composer";
import { pushHistory } from "../../lib/promptHistory";

/** 造一个 api 余额窗口（没有上限 → 读数应是金额，不是百分比）。 */
const balance = (id: string, remaining: number) => ({
 id: `balance-${id}`,
 label: "Balance",
 windowId: "balance",
 windowLabel: "Balance",
 usedFraction: 0,
 percent: 0,
 status: "ok",
 resetsAt: null,
 durationMs: null,
 notes: [],
 used: null,
 limit: null,
 remaining,
 unit: "usd",
});

/** 造一个 5 小时窗口（余额/百分比两种窗口都要能进浮层）。 */
const limit5h = (id: string, percent: number) => ({
 id: `rolling-5h-${id}`,
 label: "5h",
 windowId: "5h",
 windowLabel: "5h",
 usedFraction: percent / 100,
 percent,
 status: "ok",
 resetsAt: null,
 durationMs: null,
 notes: [],
 used: null,
 limit: null,
 remaining: null,
 unit: "percent",
});

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

const session = (over: Partial<SessionView> = {}): SessionView => ({
 id: "s1",
 projectId: null,
 title: "聊一聊",
 cwd: "/w/alpha",
 timestamp: 0,
 archived: false,
 corrupt: false,
 note: null,
 running: false,
 ...over,
});

beforeEach(() => {
 vi.clearAllMocks();
 // jsdom 没实现 scrollIntoView（`@` 补全浮层把高亮项滚进视野要用），给个空实现
 if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
 }
 useApp.setState({
  sessions: [],
  projects: [],
  activeSessionId: null,
  eventsBySession: {},
  statusBySession: {},
  drafts: {},
  attachmentsBySession: {},
  queuedBySession: {},
  goalBySession: {},
  sessionApprovals: {},
  approvalRestartBySession: {},
  globalApproval: "write",
  statsOpen: false,
  findOpen: false,
  currentRuntime: null,
  composerMenu: null,
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

/**
 * 挂载一个带草稿「你好」的会话（running 决定流式 / 就绪）。
 * 返回**草稿编辑器**（Lexical 的 contenteditable）：键盘 / 粘贴事件都派发到它，
 * 由 `Composer` 的 capture 处理器接管；改内容则走 store（编辑器由草稿同步 effect 跟进）。
 */
const mount = async (running: boolean) => {
 useApp.setState({
  sessions: [session()],
  activeSessionId: "s1",
  statusBySession: running ? { s1: { state: "running" } } : {},
  drafts: { s1: "你好" },
 });
 act(() => root.render(<Composer />));
 await act(async () => { });
 return container.querySelector<HTMLElement>('[contenteditable="true"]');
};

const press = async (el: HTMLElement | null, init: KeyboardEventInit) => {
 expect(el).not.toBeNull();
 await act(async () => {
  el!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
 });
};

describe("Composer 工具行（v2）", () => {
 it("卡底工具行 = + 菜单 + 执行模式菜单 + 模型·思考档 + 圆形发送键；统计条里有容量环", async () => {
  useApp.setState({
   sessions: [session()],
   activeSessionId: "s1",
   currentRuntime: {
    model: null,
    efforts: null,
    thinkingLevel: null,
    contextUsage: { tokens: 1300, contextWindow: 10000, percent: 13 },
   },
  });
  act(() => root.render(<Composer />));
  await act(async () => { });
  // 上下文容量环在卡底统计条（2026-10-16 从工具行搬下来，与 DH 的 composer dock 同位置）
  const meter = container.querySelector<HTMLButtonElement>('button[aria-label^="上下文容量"]');
  expect(meter).not.toBeNull();
  expect(meter?.textContent).toContain("13%");
  // 「+」菜单（v2）：点开占用互斥槽，菜单行 = 标题 + 说明（说明不再挤在标题里）
  const plus = container.querySelector<HTMLButtonElement>('button[aria-label="添加上下文"]');
  expect(plus).not.toBeNull();
  act(() => plus?.click());
  expect(useApp.getState().composerMenu).toBe("plus");
  expect(container.textContent).toContain(TEXT["zh-CN"].refPickTitle);
  expect(container.textContent).toContain(TEXT["zh-CN"].plusAddRefHint);
  act(() => plus?.click());
  expect(useApp.getState().composerMenu).toBeNull();
  // 执行模式菜单（v2）：行 = 名称 + 说明；作用域说明是「本会话 + 新会话默认」，勾选跟生效档
  const perm = container.querySelector<HTMLButtonElement>('button[aria-label^="权限："]');
  expect(perm).not.toBeNull();
  act(() => perm?.click());
  expect(useApp.getState().composerMenu).toBe("approval");
  expect(container.textContent).toContain(TEXT["zh-CN"].permAlwaysAskDesc);
  expect(container.textContent).toContain(TEXT["zh-CN"].permScopeNote);
  // 三档各一行，勾选在生效档（本用例 globalApproval = "write"）
  const rows = perm?.parentElement?.querySelectorAll("button[aria-pressed]") ?? [];
  expect(rows.length).toBe(3);
  expect([...rows].filter((b) => b.getAttribute("aria-pressed") === "true").length).toBe(1);
  expect(perm?.textContent).toContain(TEXT["zh-CN"].permWrite);
  act(() => perm?.click());
  // 模型 · 思考档合并键（aria-label = 选择模型）与圆形发送键
  expect(container.querySelector('button[aria-label="选择模型"]')).not.toBeNull();
  const sendBtn = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]');
  expect(sendBtn).not.toBeNull();
  expect(sendBtn?.className).toContain("rounded-full");
 });

 it("执行模式菜单选择：写全局默认（新会话档位）+ 本会话覆盖（idle 时立即重启换档）", async () => {
  await mount(false);
  const perm = container.querySelector<HTMLButtonElement>('button[aria-label^="权限："]');
  act(() => perm?.click());
  const rows = [...container.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")];
  const yolo = rows.find((r) => r.textContent?.includes(TEXT["zh-CN"].permYolo));
  expect(yolo).toBeDefined();
  await act(async () => {
   yolo!.click();
  });
  expect(apiMock.setGlobalApproval).toHaveBeenCalledWith("yolo");
  expect(apiMock.setSessionApproval).toHaveBeenCalledWith("s1", "yolo");
  expect(apiMock.restartSessionRuntime).toHaveBeenCalledWith("s1");
  // 选完即收浮层；触发键跟着真值走
  expect(useApp.getState().composerMenu).toBeNull();
  expect(perm?.textContent).toContain(TEXT["zh-CN"].permYolo);
 });

 it("供应商用量入口：条上只有图标，点开列**全部已配置供应商**（与当前模型无关）", async () => {
  // 当前模型属于一个根本没配的供应商 zzz：老口径下这里会一家都不显示
  useApp.setState({ currentModel: "zzz/some-model" });
  await mount(false);
  const usage = container.querySelector<HTMLButtonElement>('button[aria-label^="用量限额"]');
  expect(usage).not.toBeNull();
  // 2026-10-16 修订口径：条上**只有图标**——读数 / 窗口名 / 其余窗口数都不再铺在条上
  expect(usage!.textContent?.trim()).toBe("");
  expect(usage!.getAttribute("title")).toContain("78%");
  // 悬停提示（读屏同源）里带全部供应商的读数
  expect(usage!.getAttribute("title")).toContain("aaa");
  expect(usage!.getAttribute("title")).toContain("ddd");
  // 点开：4 家全在（浮层按上游顺序列全量），第 4 家也在
  await act(async () => {
   usage!.click();
  });
  const pop = usage!.parentElement?.querySelector('div[class*="shadow-pop"]');
  expect(pop).not.toBeNull();
  for (const p of ["aaa", "bbb", "ccc", "ddd"]) expect(pop!.textContent).toContain(p);
  // 余额型窗口（没有上限）显示金额，不显示 0.0% 假读数
  expect(pop!.textContent).not.toContain("0.0%");
 });
});

describe("Composer 发送语义（V39/V40：对齐 omp 终端与 codex）", () => {
 it("流式中 Enter = 插话：steer_message + 草稿清空（队列展示由 queue_update 驱动）", async () => {
  const ta = await mount(true);
  await press(ta, { key: "Enter" });
  expect(apiMock.steerMessage).toHaveBeenCalledTimes(1);
  expect(apiMock.steerMessage.mock.calls[0][0]).toBe("s1");
  expect(apiMock.steerMessage.mock.calls[0][1]).toBe("你好");
  expect(apiMock.followUpMessage).not.toHaveBeenCalled();
  expect(useApp.getState().drafts["s1"]).toBe("");
 });

 it("流式中 Tab = 排队（codex 的 Tab to queue）；Shift+Tab = 执行模式循环", async () => {
  const ta = await mount(true);
  await press(ta, { key: "Tab" });
  expect(apiMock.followUpMessage).toHaveBeenCalledTimes(1);
  expect(apiMock.followUpMessage.mock.calls[0][1]).toBe("你好");
  // 新一轮：Shift+Tab 走执行模式循环（V40），不排队；running 时挂起重启、不立即重启
  vi.clearAllMocks();
  useApp.setState({ drafts: { s1: "再来" } });
  await press(ta, { key: "Tab", shiftKey: true });
  expect(apiMock.followUpMessage).not.toHaveBeenCalled();
  expect(apiMock.setSessionApproval).toHaveBeenCalledWith("s1", "yolo");
  expect(useApp.getState().approvalRestartBySession["s1"]).toBe(true);
  expect(apiMock.restartSessionRuntime).not.toHaveBeenCalled();
 });

 it("Shift+Tab 在就绪时立即重启 runtime 生效（执行模式是启动参数）", async () => {
  const ta = await mount(false);
  await press(ta, { key: "Tab", shiftKey: true });
  expect(apiMock.setSessionApproval).toHaveBeenCalledWith("s1", "yolo");
  expect(apiMock.restartSessionRuntime).toHaveBeenCalledWith("s1");
 });

 it("运行中工具行不再渲染「排队」按钮（2026-10-13 用户口径）：排队只走 Tab / ⌘Ctrl+Enter，停止键照旧", async () => {
  await mount(true);
  expect(container.querySelector('button[aria-label="排队追问（本轮后执行）"]')).toBeNull();
  expect(container.querySelector('button[aria-label="停止"]')).not.toBeNull();
  expect(apiMock.followUpMessage).not.toHaveBeenCalled();
 });

 it("发送失败：草稿还回来", async () => {
  apiMock.followUpMessage.mockRejectedValueOnce(new Error("boom"));
  const ta = await mount(true);
  await press(ta, { key: "Tab" });
  // 发送是异步链路（展开引用 → 清空 → 失败回滚）：等回滚落定再断言
  await act(async () => {
   await vi.waitFor(() => expect(useApp.getState().drafts["s1"]).toBe("你好"));
  });
 });

 it("就绪时：Tab 不发送（照常移焦），Enter 走普通 send_message", async () => {
  const ta = await mount(false);
  await press(ta, { key: "Tab" });
  expect(apiMock.followUpMessage).not.toHaveBeenCalled();
  expect(apiMock.steerMessage).not.toHaveBeenCalled();
  await press(ta, { key: "Enter" });
  expect(apiMock.sendMessage).toHaveBeenCalledTimes(1);
  expect(apiMock.sendMessage.mock.calls[0][0]).toBe("s1");
  // 乐观回显：消息流里立刻有一条用户消息
  expect((useApp.getState().eventsBySession["s1"] ?? []).some((m) => m.kind === "user")).toBe(true);
 });

 it("Esc = 中断并交还队列：返回的插话 / 排队文本回输入框", async () => {
  apiMock.abortAndRestoreQueue.mockResolvedValueOnce({
   steering: [{ text: "插话一" }],
   followUp: [{ text: "排队二" }],
  });
  const ta = await mount(true);
  act(() => useApp.setState({ drafts: { s1: "" } }));
  await act(async () => { });
  await press(ta, { key: "Escape" });
  expect(apiMock.abortAndRestoreQueue).toHaveBeenCalledWith("s1");
  expect(useApp.getState().drafts["s1"]).toBe("插话一\n\n排队二");
 });

 it("待发区 = 队列真值：渲染 + 撤回 / 编辑 / 提升三个操作", async () => {
  useApp.setState({
   sessions: [session()],
   activeSessionId: "s1",
   drafts: { s1: "" },
   queuedBySession: { s1: { steering: ["先看一眼日志"], followUp: ["再跑测试"] } },
  });
  act(() => root.render(<Composer />));
  await act(async () => { });
  const lis = container.querySelectorAll('[role="status"] li');
  expect(lis).toHaveLength(2);
  expect(lis[0].textContent).toContain("插话");
  expect(lis[0].textContent).toContain("先看一眼日志");
  expect(lis[1].textContent).toContain("排队");
  expect(lis[1].textContent).toContain("再跑测试");
  // 排队行有「提升」（followUp → steering），插话行没有
  expect(lis[0].querySelector('button[aria-label="提升为插话（下一个边界生效）"]')).toBeNull();
  const promote = lis[1].querySelector<HTMLButtonElement>('button[aria-label="提升为插话（下一个边界生效）"]');
  expect(promote).not.toBeNull();
  await act(async () => {
   promote!.click();
  });
  expect(apiMock.promoteQueuedMessage).toHaveBeenCalledWith("s1", "再跑测试");
  // 编辑 = 撤回 + 退回输入框
  const edit = lis[0].querySelector<HTMLButtonElement>('button[aria-label="编辑这条（退回输入框）"]');
  await act(async () => {
   edit!.click();
  });
  expect(apiMock.removeQueuedMessage).toHaveBeenCalledWith("s1", "先看一眼日志", "steering");
  expect(useApp.getState().drafts["s1"]).toBe("先看一眼日志");
  // 撤回
  const remove = lis[1].querySelector<HTMLButtonElement>('button[aria-label="撤回这条"]');
  await act(async () => {
   remove!.click();
  });
  expect(apiMock.removeQueuedMessage).toHaveBeenCalledWith("s1", "再跑测试", "followUp");
 });

 it("壳本地命令：/goal 走 goalCommand（不进 omp），/status 开统计弹窗", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "/goal 修好所有类型错误" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(apiMock.goalCommand).toHaveBeenCalledWith("s1", "create", "修好所有类型错误");
  expect(apiMock.runSlash).not.toHaveBeenCalled();
  act(() => useApp.setState({ drafts: { s1: "/status" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(useApp.getState().statsOpen).toBe(true);
  expect(apiMock.runSlash).not.toHaveBeenCalled();
 });

 it("非本地命令仍走 run_slash（omp 命令面）", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "/compact" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(apiMock.runSlash).toHaveBeenCalledWith("s1", "/compact");
 });
});

describe("Composer 历史浏览（V41，codex 的 ↑↓ 调回）", () => {
 it("↑ 调出最近一条，再 ↑/↓ 浏览，↓ 到底还原浏览前草稿", async () => {
  localStorage.removeItem("omp.promptHistory.v1");
  pushHistory("s1", "第一条");
  pushHistory("s1", "第二条");
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "" } }));
  await act(async () => { });
  await press(ta, { key: "ArrowUp" });
  expect(useApp.getState().drafts["s1"]).toBe("第二条");
  await press(ta, { key: "ArrowUp" });
  expect(useApp.getState().drafts["s1"]).toBe("第一条");
  // 到顶再 ↑ 不动
  await press(ta, { key: "ArrowUp" });
  expect(useApp.getState().drafts["s1"]).toBe("第一条");
  await press(ta, { key: "ArrowDown" });
  expect(useApp.getState().drafts["s1"]).toBe("第二条");
  await press(ta, { key: "ArrowDown" });
  expect(useApp.getState().drafts["s1"]).toBe(""); // 还原浏览前的空草稿
 });

 it("光标不在开头时 ↑ 不接管（多行编辑照常）", async () => {
  localStorage.removeItem("omp.promptHistory.v1");
  pushHistory("s1", "旧文本");
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "第一行\n第二行" } }));
  await act(async () => { });
  await press(ta, { key: "ArrowUp" });
  expect(useApp.getState().drafts["s1"]).toBe("第一行\n第二行");
 });

 it("发送成功后进历史（localStorage 落盘）", async () => {
  localStorage.removeItem("omp.promptHistory.v1");
  const ta = await mount(false);
  await press(ta, { key: "Enter" });
  const raw = localStorage.getItem("omp.promptHistory.v1");
  expect(raw).not.toBeNull();
  expect((JSON.parse(raw!) as Record<string, string[]>).s1).toContain("你好");
 });
});

describe("Composer V41：大段粘贴 / fast·slow / 导出", () => {
 const pasteText = async (el: HTMLElement, text: string) => {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files: [], getData: () => text } });
  await act(async () => {
   el.dispatchEvent(ev);
  });
 };

 it("大段粘贴转文件引用：save_paste + 草稿插入 @路径", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "" } }));
  await act(async () => { });
  await pasteText(ta!, "长".repeat(3000));
  expect(apiMock.savePaste).toHaveBeenCalledTimes(1);
  expect(apiMock.savePaste.mock.calls[0][0]).toHaveLength(3000);
  expect(useApp.getState().drafts["s1"]).toBe("@/tmp/paste/paste-1.txt ");
 });

 it("短文本粘贴不拦截（不调 save_paste）", async () => {
  const ta = await mount(false);
  await pasteText(ta!, "短文本");
  expect(apiMock.savePaste).not.toHaveBeenCalled();
 });

 it("/fast 与 /slow：toggle 走 IPC；返回命令行走流尾", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "/fast" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(apiMock.setFastMode).toHaveBeenCalledWith("s1", true);
  act(() => useApp.setState({ drafts: { s1: "/slow on" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(apiMock.setSlowMode).toHaveBeenCalledWith("s1", true);
 });

 it("/export：导出会话并交给系统打开", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "/export" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(apiMock.exportSessionHtml).toHaveBeenCalledWith("s1");
  expect(openerMock.openPath).toHaveBeenCalledWith("/tmp/demo/omp-session-x.html");
  const body = (useApp.getState().eventsBySession["s1"] ?? []).map((m) => (m.kind === "command" ? m.output : "")).join("\n");
  expect(body).toContain("/tmp/demo/omp-session-x.html");
 });

 it("! 前缀 = 本地 shell：命令行 + 输出各落一条流尾 command 行", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "! echo hello-shell" } }));
  await act(async () => { });
  await press(ta, { key: "Enter" });
  expect(apiMock.runBash).toHaveBeenCalledWith("s1", "echo hello-shell");
  const body = (useApp.getState().eventsBySession["s1"] ?? []).map((m) => (m.kind === "command" ? m.output : "")).join("\n");
  expect(body).toContain("$ echo hello-shell");
  expect(body).toContain("hello-shell");
 });
});

/**
 * 图片附件 `#N` 占位（2026-10-15）：粘贴 / 拖拽 / `+` 菜单添加图片时，在光标处留下稳定编号的
 * `#N`——文字与图片的对应关系写在正文里（「如图#1」），缩略图角标同编号；编号由 store 分配，
 * 删除图片不重排、不重编号（`lib/attachments.ts` 的 withSlots）。
 */
describe("Composer 图片附件：`#N` 占位与角标", () => {
 const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: "image/png" });

 /** 触发一次带图片的粘贴（读文件 → base64 是异步：轮询等到这一批附件真正入库再断言）。 */
 const pasteFiles = async (el: HTMLElement, files: File[], text = "") => {
  const ev = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "clipboardData", { value: { files, getData: () => text } });
  await act(async () => {
   el.dispatchEvent(ev);
  });
  await act(async () => {
   await vi.waitFor(() => {
    expect((useApp.getState().attachmentsBySession["s1"] ?? []).length).toBeGreaterThanOrEqual(files.length);
   });
  });
 };

 it("粘贴图片：光标处插入 `#1`（「如图」→「如图#1」），附件带稳定编号、角标同编号", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "如图" } }));
  await act(async () => { });
  await pasteFiles(ta!, [png("shot.png")]);
  const atts = useApp.getState().attachmentsBySession["s1"] ?? [];
  expect(atts).toHaveLength(1);
  expect(atts[0].slot).toBe(1);
  expect(useApp.getState().drafts["s1"]).toBe("如图#1");
  // 缩略图角标与正文占位同源
  expect(container.textContent).toContain("#1");
 });

 it("一次粘两张 = `#1 #2`；删除后新增接 #3（编号不回收、文本不自动改）", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "" } }));
  await act(async () => { });
  await pasteFiles(ta!, [png("a.png"), png("b.png")]);
  expect(useApp.getState().drafts["s1"]).toBe("#1 #2");
  expect((useApp.getState().attachmentsBySession["s1"] ?? []).map((a) => a.slot)).toEqual([1, 2]);
  // 移除 #1：正文里的 `#1` 留作悬空引用（不自动改文本），剩余编号不动
  await act(async () => {
   container.querySelector<HTMLButtonElement>('button[aria-label="移除 a.png"]')!.click();
  });
  expect((useApp.getState().attachmentsBySession["s1"] ?? []).map((a) => a.slot)).toEqual([2]);
  const ta2 = container.querySelector<HTMLElement>('[contenteditable="true"]')!;
  await pasteFiles(ta2, [png("c.png")]);
  expect((useApp.getState().attachmentsBySession["s1"] ?? []).map((a) => a.slot)).toEqual([2, 3]);
  expect(useApp.getState().drafts["s1"]).toBe("#1 #2#3");
 });

 it("图文混贴：剪贴板文字在前、占位紧随其后（一次插入）", async () => {
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "看看" } }));
  await act(async () => { });
  await pasteFiles(ta!, [png("m.png")], "截图说明");
  expect(useApp.getState().drafts["s1"]).toBe("看看截图说明#1");
 });
});

/**
 * 「输入」一段文本：直接改 store 草稿，编辑器由同步 effect 跟进（`setText` 后光标在末尾）。
 * 旧 textarea 那套原生 setter + input 事件在 contenteditable 上不适用。
 */
const typeInto = async (_el: HTMLElement | null, value: string) => {
 act(() => useApp.setState({ drafts: { s1: value } }));
 await act(async () => {});
};

/** 等过 `@` 补全的防抖窗口（300ms）。 */
const afterDebounce = async () => {
 await act(async () => {
  await new Promise((resolve) => setTimeout(resolve, 350));
 });
};

/**
 * `@` 补全：一层列举 / 递归搜名字两条口径（后端 `complete_path`）+ 取词中与空态**留在浮层里**。
 * 用户实测的坑：以前候选为空就让浮层消失，看着像「补全坏了」。
 */
describe("Composer `@` 路径补全", () => {
 it("取词中显示「搜索中」，取完显示候选（子目录里的匹配也出）", async () => {
  let settle: ((v: { path: string; real: string; isDir: boolean; label: string }[]) => void) | null = null;
  apiMock.completePath.mockImplementation(
   () =>
    new Promise((resolve) => {
     settle = resolve;
    }),
  );
  const ta = await mount(false);
  await typeInto(ta!, "@baselin");
  expect(container.textContent).toContain(TEXT["zh-CN"].mentionListLoading);
  await afterDebounce();
  expect(apiMock.completePath).toHaveBeenCalledWith("/w/alpha", "baselin");
  await act(async () => {
   settle?.([
    { path: "src/baseline_utils.ts", real: "src/baseline_utils.ts", isDir: false, label: "baseline_utils.ts" },
   ]);
   await Promise.resolve();
  });
  expect(container.textContent).toContain("baseline_utils.ts");
  expect(container.textContent).toContain("src/");
  expect(container.textContent).not.toContain(TEXT["zh-CN"].mentionListLoading);
 });

 it("取完没有匹配：浮层留着如实说，不无声消失", async () => {
  apiMock.completePath.mockResolvedValue([]);
  const ta = await mount(false);
  await typeInto(ta!, "@zzzz");
  await afterDebounce();
  expect(container.textContent).toContain(TEXT["zh-CN"].mentionListEmpty);
 });

 it("选中候选：写进草稿的是短标签，文件收尾空格、目录补斜杠", async () => {
  apiMock.completePath.mockResolvedValue([
   { path: "src/a.ts", real: "src/a.ts", isDir: false, label: "a.ts" },
   { path: "src/components", real: "src/components", isDir: true, label: "components" },
  ]);
  const ta = await mount(false);
  await typeInto(ta!, "@a");
  await afterDebounce();
  const opts = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(opts.length).toBe(2);
  await act(async () => {
   opts[0]?.click();
  });
  // 草稿（序列化）里是真路径，屏幕上是短标签
  expect(useApp.getState().drafts["s1"]).toBe("@src/a.ts ");
  expect(container.querySelector("[data-mention-chip]")?.textContent).toBe("@a.ts");

  await typeInto(ta!, "@comp");
  await afterDebounce();
  const dirOpt = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) =>
   b.textContent?.includes("components"),
  );
  await act(async () => {
   dirOpt?.click();
  });
  // 目录 = 下钻：草稿里是**短标签路径文本**（不是芯片），光标停在其后继续取词
  expect(useApp.getState().drafts["s1"]).toBe("@components/");
  // 目录下钻是纯文本：屏幕上没有芯片（文件才会变成芯片，见上面的断言）
  expect(container.querySelector("[data-mention-chip]")).toBeNull();
 });

 it("选中目录后**能进到目录里**：浮层接着列该目录下的内容（用户实测的坑）", async () => {
  // 第一层：`@` → 列项目根下的目录
  apiMock.completePath.mockResolvedValueOnce([
   { path: "dist", real: "dist", isDir: true, label: "dist" },
  ]);
  const ta = await mount(false);
  await typeInto(ta!, "@");
  await afterDebounce();
  const dist = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].find((b) =>
   b.textContent?.includes("dist"),
  );
  await act(async () => {
   dist?.click();
  });
  expect(useApp.getState().drafts["s1"]).toBe("@dist/");

  // 第二层：光标停在目录芯片后面，取词带上 `@dist/` → 再问后端要 dist 里的东西
  apiMock.completePath.mockResolvedValueOnce([
   { path: "dist/app.js", real: "dist/app.js", isDir: false, label: "app.js" },
  ]);
  await afterDebounce();
  expect(apiMock.completePath).toHaveBeenLastCalledWith("/w/alpha", "dist/");
  expect(
   [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')].some((b) =>
    b.textContent?.includes("app.js"),
   ),
  ).toBe(true);
 });

 it("发送前把短标签还原成完整相对路径（回显 / 历史仍是用户写的短标签）", async () => {
  apiMock.checkPaths.mockResolvedValue([
   { path: "components/", exists: true, isDir: true, resolved: "src/views/components" },
  ]);
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "看看 @components/ 这个目录" } }));
  await act(async () => {});
  await press(ta, { key: "Enter" });
  await act(async () => {
   await Promise.resolve();
  });
  // 发给 omp 的是真路径（omp 只认真路径）
  expect(apiMock.sendMessage).toHaveBeenCalledWith("s1", "看看 @src/views/components/ 这个目录", []);
  // 用户看到的（乐观回显）还是他自己写的短标签
  const msgs = useApp.getState().eventsBySession["s1"] ?? [];
  expect(msgs.some((m) => m.kind === "user" && m.text === "看看 @components/ 这个目录")).toBe(true);
 });

 it("解析不出来（歧义 / 不存在）就按原文发，不猜路径", async () => {
  apiMock.checkPaths.mockResolvedValue([
   { path: "index.ts", exists: false, isDir: false, resolved: null },
  ]);
  const ta = await mount(false);
  act(() => useApp.setState({ drafts: { s1: "@index.ts" } }));
  await act(async () => {});
  await press(ta, { key: "Enter" });
  await act(async () => {
   await Promise.resolve();
  });
  expect(apiMock.sendMessage).toHaveBeenCalledWith("s1", "@index.ts", []);
 });

 it("引用只融入正文：正常的引用不再单独排一行芯片", async () => {
  apiMock.checkPaths.mockResolvedValue([
   { path: "components/", exists: true, isDir: true, resolved: "src/views/components" },
  ]);
  await mount(false);
  act(() => useApp.setState({ drafts: { s1: "看 @components/ 这个目录" } }));
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 400)); // 过完 check_paths 的 300ms 防抖
  });
  // 正文里有标签
  expect(useApp.getState().drafts["s1"]).toBe("看 @components/ 这个目录");
  // 但上方没有芯片行 / 旧提示行（标签已经融入文字，不再重复展示）
  expect(container.textContent).not.toContain(TEXT["zh-CN"].mentionSendHint);
  expect(container.textContent).not.toContain(TEXT["zh-CN"].pathExists);
  expect(container.querySelector('[role="status"]')).toBeNull();
  // 完整路径改由输入框的悬停提示给出（`@标签 → 真路径`）
  expect(container.querySelector("[data-draft-editor]")?.getAttribute("title")).toBe(
   "@components/ → src/views/components",
  );
 });

 it("解析不到的引用才给一行提示（原文照发）", async () => {
  apiMock.checkPaths.mockResolvedValue([
   { path: "index.ts", exists: false, isDir: false, resolved: null },
  ]);
  await mount(false);
  act(() => useApp.setState({ drafts: { s1: "@index.ts" } }));
  await act(async () => {
   await new Promise((resolve) => setTimeout(resolve, 400));
  });
  expect(container.textContent).toContain(fmt(TEXT["zh-CN"].mentionsMissingHint, "1"));
  expect(container.textContent).toContain("@index.ts");
 });

 it("Esc 关掉浮层，继续打字重新打开", async () => {
  apiMock.completePath.mockResolvedValue([
   { path: "src/a.ts", real: "src/a.ts", isDir: false, label: "a.ts" },
  ]);
  const ta = await mount(false);
  await typeInto(ta!, "@a");
  await afterDebounce();
  expect(container.querySelector('[role="option"]')).not.toBeNull();
  await press(ta, { key: "Escape" });
  expect(container.querySelector('[role="option"]')).toBeNull();
  await typeInto(ta!, "@ab");
  await afterDebounce();
  expect(container.querySelector('[role="option"]')).not.toBeNull();
 });
});
