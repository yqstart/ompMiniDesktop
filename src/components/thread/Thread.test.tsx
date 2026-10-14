// @vitest-environment jsdom
/**
 * Thread 渲染冒烟（jsdom + createRoot，与浏览器同路径）：
 * 内联一组真实形状的 jsonl 行 → viewMsgsFromJsonlLines → 渲染整棵 Thread，
 * 断言不崩、且用户消息与工具行的关键内容出现。
 *
 * 为什么要有这条：`打开已有会话 → 历史落库 → 渲染` 是"右侧不显示"类问题的
 * 唯一端到端覆盖（jsdom 是这两条测试的测试环境依赖，见 THIRD-PARTY-NOTICES）。
 */
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ViewMsg } from "@shared/types";
import { THREAD_PAGE, useApp } from "../../stores/app";
import { nthOfText, viewMsgsFromJsonlLines } from "../../lib/viewmsg";
import { TEXT } from "../../lib/locale";
import { Thread } from "./Thread";

/**
 * 分叉链路要断言 IPC 参数与「打开新会话」的参数，所以两者都用替身：
 * `forkFromMessage` 走 @shared/api（Proxy 兜底其余命令），`openForkedSession` 走 lib。
 */
const { apiMock, openForkedSessionMock, NEW_VIEW } = vi.hoisted(() => ({
 apiMock: { forkFromMessage: vi.fn() },
 openForkedSessionMock: vi.fn(async () => undefined),
 NEW_VIEW: { id: "s-new", projectId: "p1", title: "分叉", cwd: "/tmp", timestamp: 0, archived: false, corrupt: false, note: null, running: false },
}));
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));
vi.mock("../../lib/sessionOpen", () => ({ openForkedSession: openForkedSessionMock }));

// 让 React 的 act(...) 在 jsdom 下进入"测试环境"模式（消除 "not configured" 警告）
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// jsdom 没实现 Range.getBoundingClientRect（划选浮条靠它定位），补一个全 0 矩形：
// 组件的坐标有「越界往回收」的钳制，全 0 也能算出合法位置（左上角附近的浮条）。
if (!("getBoundingClientRect" in Range.prototype)) {
 Object.assign(Range.prototype, {
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0, x: 0, y: 0 }),
 });
}

/** 真实形状的 jsonl 行（与 omp 会话文件同构的裁剪：user 正文 / 思考 / 工具调用 / 工具结果 / 标题）。 */
const JSONL_LINES = [
 { type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "你好" }] } },
 {
  type: "message",
  id: "m2",
  message: {
   role: "assistant",
   content: [
    { type: "thinking", thinking: "先看看目录" },
    { type: "text", text: "我来跑一下" },
    { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" }, intent: "列出目录" },
   ],
  },
 },
 { type: "message", id: "m3", message: { role: "toolResult", toolCallId: "tc1", toolName: "bash", content: [{ type: "text", text: "a.txt" }] } },
 { type: "title_change", id: "t1", title: "冒烟会话" },
];

describe("Thread 渲染", () => {
 it("历史行转 ViewMsg 后整树渲染不崩，关键内容出现", async () => {
  const msgs = viewMsgsFromJsonlLines(JSONL_LINES, TEXT["zh-CN"]);
  useApp.setState({
   eventsBySession: { "s-render": msgs },
   activeSessionId: "s-render",
   sessions: [
    { id: "s-render", projectId: "p1", title: "t", cwd: "/tmp", updatedAt: 0, archived: false, missing: false } as never,
   ],
   projects: [{ id: "p1", name: "p", path: "/tmp" } as never],
   threadLimitSid: "s-render",
   threadLimit: THREAD_PAGE,
  });
  const errors: unknown[] = [];
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container, { onUncaughtError: (e) => errors.push(e) });
  await act(async () => {
   root.render(createElement(Thread));
  });
  const html = container.innerHTML;
  expect(errors).toHaveLength(0);
  expect(html).toContain("你好");
  expect(html).toContain("bash");
  await act(async () => {
   root.unmount();
  });
 });
});

/**
 * 流式「思考中…」指示行：状态是 running 且流尾**没有**「正在输出」的行时补一条
 * （慢模型从发送到首个 delta 可能几十秒到几分钟，此前那段时间消息列里什么都没有
 * ——用户看到的就是「发送文字后无任何反应」）。
 */
describe("流式「思考中…」指示", () => {
 /** 挂载 Thread（与冒烟测试同一套 store 装置），返回容器与根。 */
 const mount = async (msgs: ViewMsg[], state?: "running" | "idle") => {
  useApp.setState({
   eventsBySession: { "s-ind": msgs },
   activeSessionId: "s-ind",
   statusBySession: state ? { "s-ind": { state } } : {},
   sessions: [
    { id: "s-ind", projectId: "p1", title: "t", cwd: "/tmp", updatedAt: 0, archived: false, missing: false } as never,
   ],
   projects: [{ id: "p1", name: "p", path: "/tmp" } as never],
   threadLimitSid: "s-ind",
   threadLimit: THREAD_PAGE,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
   root.render(createElement(Thread));
  });
  return { container, root };
 };
 const indicator = TEXT[useApp.getState().locale].thinking;

 it("运行中且流尾没有活行时补一条（工具跑完在等模型的间隙也补）——但要等一小段才露面", async () => {
  const base = viewMsgsFromJsonlLines(JSONL_LINES, TEXT["zh-CN"]);
  const { container, root } = await mount(base, "running");
  // 防闪（V46）：刚进入空窗的一两帧不挂指示行（段与段之间的短暂间隙不该闪一下）
  expect(container.innerHTML).not.toContain(indicator);
  await act(async () => {
   await new Promise((r) => setTimeout(r, 400));
  });
  expect(container.innerHTML).toContain(indicator);
  await act(async () => {
   root.unmount();
  });
 });

 it("流尾是流式文本 / 运行中的工具卡时不补（界面本来就在动）", async () => {
  const streaming: ViewMsg[] = [{ kind: "text", id: "t1", seq: 0, text: "半句", complete: false }];
  const a = await mount(streaming, "running");
  expect(a.container.innerHTML).not.toContain(indicator);
  await act(async () => {
   a.root.unmount();
  });

  const runningTool: ViewMsg[] = [
   { kind: "tool", id: "tool:tc9", toolCallId: "tc9", name: "bash", intent: "", argsSummary: "ls", state: "running", output: "", streamIndex: 0 },
  ];
  const b = await mount(runningTool, "running");
  expect(b.container.innerHTML).not.toContain(indicator);
  await act(async () => {
   b.root.unmount();
  });
 });

 it("不在运行（idle / 未知状态）时不渲染指示", async () => {
  const base = viewMsgsFromJsonlLines(JSONL_LINES, TEXT["zh-CN"]);
  const a = await mount(base, "idle");
  expect(a.container.innerHTML).not.toContain(indicator);
  await act(async () => {
   a.root.unmount();
  });
  const b = await mount(base);
  expect(b.container.innerHTML).not.toContain(indicator);
  await act(async () => {
   b.root.unmount();
  });
 });
});

/** 消息流里的 user / assistant 正文（分叉定位只认这两类）。 */
const userMsg = (id: string, text: string): ViewMsg => ({ kind: "user", id, text, mentions: [] });
const textMsg = (id: string, text: string): ViewMsg => ({ kind: "text", id, seq: 0, text, complete: true });

describe("nthOfText（分叉定位序号）", () => {
 it("同类同文本按出现次序给 0 基序号，跨类不干扰", () => {
  const events = [
   userMsg("u1", "同样的话"),
   textMsg("a1", "同样的话"),
   textMsg("a2", "别的"),
   userMsg("u2", "同样的话"),
   textMsg("a3", "同样的话"),
  ];
  expect(nthOfText(events, "u1")).toBe(0);
  expect(nthOfText(events, "u2")).toBe(1);
  expect(nthOfText(events, "a1")).toBe(0);
  expect(nthOfText(events, "a3")).toBe(1);
 });

 it("思考 / 工具卡这类非目标消息不参与计数；找不到时退化为 0", () => {
  const events: ViewMsg[] = [
   { kind: "thinking", id: "t1", text: "同样的话", seconds: 1, complete: true },
   textMsg("a1", "同样的话"),
  ];
  expect(nthOfText(events, "a1")).toBe(0);
  expect(nthOfText(events, "missing")).toBe(0);
 });
});

/**
 * V40 分叉入口：user 消息 hover 出「编辑并重发」，assistant 正文 hover 出「分叉」；
 * 定位靠 role + 文本 + 同类同文本序号，编辑模式把原文本回填成新会话草稿。
 * 失败不弹窗——落一条本地命令行到消息流尾，文案走字典。
 */
describe("消息 hover 分叉动作", () => {
 const SID = "s-fork";
 const t = () => TEXT[useApp.getState().locale];

 const byLabel = (container: HTMLElement, label: string) => container.querySelector(`button[aria-label="${label}"]`);

 const mount = async (msgs: ViewMsg[], opts: { state?: "running" | "idle"; archived?: boolean; draft?: string } = {}) => {
  useApp.setState({
   eventsBySession: { [SID]: msgs },
   activeSessionId: SID,
   statusBySession: opts.state ? { [SID]: { state: opts.state } } : {},
   sessions: [
    { id: SID, projectId: "p1", title: "t", cwd: "/tmp", updatedAt: 0, archived: opts.archived ?? false, missing: false } as never,
   ],
   projects: [{ id: "p1", name: "p", path: "/tmp" } as never],
   threadLimitSid: SID,
   threadLimit: THREAD_PAGE,
   drafts: { [SID]: opts.draft ?? "" },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
   root.render(createElement(Thread));
  });
  return { container, root };
 };

 const click = async (el: Element | null) => {
  expect(el).not.toBeNull();
  await act(async () => {
   el?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
 };

 it("每条消息行带 data-msg-id（⌘F 定位挂钩）", async () => {
  const { container, root } = await mount([userMsg("m1", "你好"), textMsg("a1", "答")]);
  expect(container.querySelector('[data-msg-id="m1"]')).not.toBeNull();
  expect(container.querySelector('[data-msg-id="a1"]')).not.toBeNull();
  await act(async () => {
   root.unmount();
  });
 });

 it("user 消息「编辑并重发」→ forkFromMessage(user, 文本, nth, edit) + 草稿回填", async () => {
  apiMock.forkFromMessage.mockReset();
  apiMock.forkFromMessage.mockResolvedValue(NEW_VIEW);
  openForkedSessionMock.mockClear();
  // 同一句话出现两次：第二次的序号必须是 1（后端按 role+文本+序号定位）
  const { container, root } = await mount([userMsg("m1", "重发我"), textMsg("a1", "答"), userMsg("m2", "重发我")]);
  await click(byLabel(container, t().msgEditAria));
  // 第一条也是这个按钮，取到的是 m1 → 序号 0
  expect(apiMock.forkFromMessage).toHaveBeenCalledWith(SID, "user", "重发我", 0, "edit");
  expect(openForkedSessionMock).toHaveBeenCalledWith(NEW_VIEW, { draft: "重发我" });
  await act(async () => {
   root.unmount();
  });
 });

 it("第二条同文本 user 消息的 nth = 1", async () => {
  apiMock.forkFromMessage.mockReset();
  apiMock.forkFromMessage.mockResolvedValue(NEW_VIEW);
  openForkedSessionMock.mockClear();
  const { container, root } = await mount([userMsg("m1", "重发我"), textMsg("a1", "答"), userMsg("m2", "重发我")]);
  await click(container.querySelector('[data-msg-id="m2"] button[aria-label]'));
  expect(apiMock.forkFromMessage).toHaveBeenCalledWith(SID, "user", "重发我", 1, "edit");
  await act(async () => {
   root.unmount();
  });
 });

 it("assistant 正文「分叉」→ forkFromMessage(assistant, 文本, nth, branch)，不回填草稿", async () => {
  apiMock.forkFromMessage.mockReset();
  apiMock.forkFromMessage.mockResolvedValue(NEW_VIEW);
  openForkedSessionMock.mockClear();
  const { container, root } = await mount([userMsg("m1", "问"), textMsg("a1", "答案")]);
  await click(byLabel(container, t().msgBranchAria));
  expect(apiMock.forkFromMessage).toHaveBeenCalledWith(SID, "assistant", "答案", 0, "branch");
  expect(openForkedSessionMock).toHaveBeenCalledWith(NEW_VIEW);
  await act(async () => {
   root.unmount();
  });
 });

 it("分叉失败 → 消息流尾出现 command 行，文案走字典（含「没有定位到」映射）", async () => {
  apiMock.forkFromMessage.mockReset();
  apiMock.forkFromMessage.mockRejectedValue(new Error("没有定位到这条消息"));
  openForkedSessionMock.mockClear();
  const { container, root } = await mount([userMsg("m1", "问"), textMsg("a1", "答案")]);
  await click(byLabel(container, t().msgBranchAria));
  expect(openForkedSessionMock).not.toHaveBeenCalled();
  const events = useApp.getState().eventsBySession[SID];
  const last = events[events.length - 1];
  expect(last.kind).toBe("command");
  expect(last.kind === "command" && last.output).toBe(t().msgForkNotFound);
  expect(container.innerHTML).toContain(t().msgForkNotFound);
  // 清掉这条本地回执，别污染后面的用例
  await act(async () => {
   useApp.setState({ eventsBySession: { [SID]: [userMsg("m1", "问"), textMsg("a1", "答案")] } });
  });
  await act(async () => {
   root.unmount();
  });
 });

 it("运行中 / 已归档：分叉按钮禁用并给出原因", async () => {
  const running = await mount([userMsg("m1", "问"), textMsg("a1", "答案")], { state: "running" });
  const disabled = running.container.querySelector(`button[aria-label="${t().msgEditAria}"]`) as HTMLButtonElement;
  expect(disabled.disabled).toBe(true);
  expect(disabled.title).toBe(t().msgForkBusyHint);
  await act(async () => {
   running.root.unmount();
  });

  const archived = await mount([userMsg("m1", "问"), textMsg("a1", "答案")], { archived: true });
  const ro = archived.container.querySelector(`button[aria-label="${t().msgBranchAria}"]`) as HTMLButtonElement;
  expect(ro.disabled).toBe(true);
  expect(ro.title).toBe(t().archivedComposerHint);
  await act(async () => {
   archived.root.unmount();
  });
 });
});

/**
 * V40 划选浮条：划中消息列里的正文 → 选区上方浮出「引用到输入框 / 旁问」。
 * 「引用」把选中文本转成 `> ` 引用块追加进草稿（旧草稿非空时空一行隔开）。
 */
describe("划选浮条", () => {
 const SID = "s-sel";

 const mountWithSelection = async (draft: string) => {
  useApp.setState({
   eventsBySession: { [SID]: [userMsg("m1", "你好世界")] },
   activeSessionId: SID,
   statusBySession: {},
   sessions: [
    { id: SID, projectId: "p1", title: "t", cwd: "/tmp", updatedAt: 0, archived: false, missing: false } as never,
   ],
   projects: [{ id: "p1", name: "p", path: "/tmp" } as never],
   threadLimitSid: SID,
   threadLimit: THREAD_PAGE,
   drafts: { [SID]: draft },
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
   root.render(createElement(Thread));
  });
  return { container, root };
 };

 /** 在容器内的气泡正文上造一个真实选区，再派发 mouseup（与浏览器同路径）。 */
 const select = async (container: HTMLElement) => {
  const bubble = container.querySelector('[data-msg-id="m1"] .whitespace-pre-wrap');
  expect(bubble).not.toBeNull();
  const range = document.createRange();
  range.selectNodeContents(bubble!);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  await act(async () => {
   container.querySelector('[role="log"]')?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
 };

 it("引用到输入框：选中文本转成 `> ` 引用块追加进草稿", async () => {
  const { container, root } = await mountWithSelection("旧草稿");
  await select(container);
  const quote = container.querySelector(`button[aria-label="${TEXT[useApp.getState().locale].selQuote}"]`);
  expect(quote).not.toBeNull();
  await act(async () => {
   quote?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(useApp.getState().draftOf(SID)).toBe("旧草稿\n\n> 你好世界\n\n");
  // 动作执行后浮条关闭
  expect(container.querySelector(`button[aria-label="${TEXT[useApp.getState().locale].selQuote}"]`)).toBeNull();
  await act(async () => {
   root.unmount();
  });
 });

 it("无选区不显示浮条", async () => {
  const { container, root } = await mountWithSelection("");
  window.getSelection()?.removeAllRanges();
  await act(async () => {
   container.querySelector('[role="log"]')?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  expect(container.querySelector(`button[aria-label="${TEXT[useApp.getState().locale].selQuote}"]`)).toBeNull();
  await act(async () => {
   root.unmount();
  });
 });
});

/**
 * 摘要式表达（v2 §2.1）的端到端：`jsonl → ViewMsg → buildThreadLayout → 渲染`。
 * 单测（`lib/threadLayout.test.ts`）覆盖纯函数，这里盖「真的进了 DOM」这一段。
 */
describe("Thread 摘要式表达（v2）", () => {
 const SID2 = "s-v2";

 const mountV2 = async (lines: unknown[]) => {
  const msgs = viewMsgsFromJsonlLines(lines, TEXT["zh-CN"]);
  useApp.setState({
   locale: "zh-CN",
   eventsBySession: { [SID2]: msgs },
   activeSessionId: SID2,
   statusBySession: {},
   sessions: [{ id: SID2, projectId: "p1", title: "t", cwd: "/tmp", timestamp: 0, archived: false, corrupt: false, note: null, running: false }],
   projects: [{ id: "p1", name: "p", path: "/tmp" } as never],
   threadLimitSid: SID2,
   threadLimit: THREAD_PAGE,
  });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
   root.render(createElement(Thread));
  });
  return { container, root };
 };

 const BASH_ROUND = [
  { type: "message", id: "u1", timestamp: "2026-10-14T03:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "跑两条命令" }] } },
  { type: "message", id: "m1", timestamp: "2026-10-14T03:00:05.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls" } }] } },
  { type: "message", id: "r1", timestamp: "2026-10-14T03:00:06.000Z", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "a.txt" }] } },
  { type: "message", id: "m2", timestamp: "2026-10-14T03:00:07.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "c2", name: "bash", arguments: { command: "pwd" } }] } },
  { type: "message", id: "r2", timestamp: "2026-10-14T03:00:08.000Z", message: { role: "toolResult", toolCallId: "c2", toolName: "bash", content: [{ type: "text", text: "/tmp" }] } },
  { type: "message", id: "m3", timestamp: "2026-10-14T03:02:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "跑完了" }] } },
 ];

 it("相邻两条 bash 折叠成「运行了 2 条命令」，展开才逐条显示；轮时长行收在轮末", async () => {
  const { container, root } = await mountV2(BASH_ROUND);
  // 折叠行在：摘要文案出现
  expect(container.textContent).toContain("运行了 2 条命令");
  // 折叠态不出现逐条命令
  expect(container.textContent).not.toContain("ls");
  expect(container.textContent).not.toContain("pwd");
  // 轮时长行（03:00:00 → 03:02:00 = 120s）
  expect(container.textContent).toContain("用时 2:00");

  const runBtn = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("运行了 2 条命令"));
  expect(runBtn?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
   runBtn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // 展开后逐条工具行出现
  expect(container.textContent).toContain("ls");
  expect(container.textContent).toContain("pwd");
  await act(async () => {
   root.unmount();
  });
 });

 it("相邻两条写 / 改折叠成编辑卡：文件行 + 行级增量", async () => {
  const { container, root } = await mountV2([
   { type: "message", id: "u1", timestamp: "2026-10-14T03:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "改两个文件" }] } },
   { type: "message", id: "m1", timestamp: "2026-10-14T03:00:01.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "w1", name: "write", arguments: { path: "/tmp/a.ts", content: "1\n2\n3" } }] } },
   { type: "message", id: "m2", timestamp: "2026-10-14T03:00:02.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "e1", name: "edit", arguments: { path: "/tmp/b.ts", old_string: "x", new_string: "y\nz" } }] } },
  ]);
  expect(container.textContent).toContain("编辑了 2 个文件");
  expect(container.textContent).toContain("a.ts");
  expect(container.textContent).toContain("b.ts");
  // 行级增量：write 3 行 + edit 2 行 = +5；edit 移除 1 行
  expect(container.textContent).toContain("+5");
  expect(container.textContent).toContain("−1");
  await act(async () => {
   root.unmount();
  });
 });

 it("单条 bash 不聚合（避免「运行了 1 条命令」的假摘要），保持原样一行", async () => {
  const { container, root } = await mountV2([
   { type: "message", id: "u1", timestamp: "2026-10-14T03:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "跑一条" }] } },
   { type: "message", id: "m1", timestamp: "2026-10-14T03:00:01.000Z", message: { role: "assistant", content: [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "ls -la" } }] } },
   { type: "message", id: "r1", timestamp: "2026-10-14T03:00:02.000Z", message: { role: "toolResult", toolCallId: "c1", toolName: "bash", content: [{ type: "text", text: "ok" }] } },
  ]);
  expect(container.textContent).not.toContain("运行了 1 条命令");
  expect(container.textContent).toContain("ls -la");
  await act(async () => {
   root.unmount();
  });
 });
});
