// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubAgentInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt, TEXT } from "../../lib/locale";

/**
 * 右栏子代理区块（v2；由 v1 的消息列状态条迁移）：有子代理即渲染（running 在前）与取消 /
 * 每行的转录展开（首拉不带 fromByte、增量复用 nextByte、reset 重建、失败错误行、单开与轮询）。
 *
 * 组件只读 store 的 `subagentsBySession` 片段，所以用例统一 `setState` 摆状态；
 * 取消与转录都走被 mock 的 `@shared/api`，断言落在调用参数与渲染结果上。
 */
/** 转录 IPC 回执的测试形状（与 `api.getSubagentMessages` 的返回同构）。 */
type TranscriptReply = {
 sessionFile: string;
 fromByte: number;
 nextByte: number;
 reset?: boolean;
 messages?: unknown[];
 entries?: unknown[];
};

const { apiMock, transcriptReply } = vi.hoisted(() => {
 const transcriptReply = (_fromByte?: number): TranscriptReply => ({
  sessionFile: "/tmp/sub.jsonl",
  fromByte: _fromByte ?? 0,
  nextByte: 100,
  messages: [],
 });
 return {
  transcriptReply,
  apiMock: {
   cancelSubagent: vi.fn(async (_sid: string, _subId: string) => ({ cancelled: true })),
   getSubagentMessages: vi.fn(
    async (_sid: string, _subId: string, _fromByte?: number) => transcriptReply(_fromByte),
   ),
  },
 };
});
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));

import { SubagentsSection } from "./SubagentsSection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zh = TEXT["zh-CN"];

let container: HTMLDivElement;
let root: Root;

const sub = (over: Partial<SubAgentInfo> & { id: string }): SubAgentInfo => ({
 agent: "scout",
 description: "调研 A 模块",
 status: "running",
 ...over,
});

const setSubs = (list: SubAgentInfo[], sid = "s1") =>
 useApp.setState({ locale: "zh-CN", activeSessionId: sid, subagentsBySession: { [sid]: list } });

const mount = async () => {
 act(() => root.render(<SubagentsSection />));
 await act(async () => { });
};

const click = async (el: Element | null | undefined) => {
 await act(async () => {
  (el as HTMLElement | undefined)?.click();
 });
};

/** 区块里的取消按钮（文本 = 字典的 saCancel）。 */
const cancels = () =>
 [...container.querySelectorAll("button")].filter((b) => b.textContent === zh.saCancel);

/** 行主体的展开入口（aria-label = fmt(saOpenAria, agent)）。 */
const openers = (agent = "scout") =>
 [...container.querySelectorAll("button")].filter((b) => b.getAttribute("aria-label") === fmt(zh.saOpenAria, agent));

/** 转录面板（role="region"，整行下内联展开）。 */
const pane = () => container.querySelector<HTMLElement>('[role="region"]');

/** 转录面板头部的「刷新」按钮。 */
const refreshBtn = () =>
 [...(pane()?.querySelectorAll("button") ?? [])].find((b) => b.getAttribute("aria-label") === zh.saRefresh);

beforeEach(() => {
 vi.clearAllMocks();
 // 上个用例（失败时）可能把一次性回执留在队列里，重置回默认实现
 apiMock.getSubagentMessages.mockReset();
 apiMock.getSubagentMessages.mockImplementation(async (_sid: string, _subId: string, _fromByte?: number) =>
  transcriptReply(_fromByte),
 );
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
 useApp.setState({ activeSessionId: null, subagentsBySession: {} });
});

describe("SubagentsSection", () => {
 it("没有子代理：整块不渲染", async () => {
  setSubs([]);
  await mount();
  expect(container.textContent).toBe("");
 });

 it("有子代理即渲染（含已完成的），running 在前、状态文案与色点 aria 齐全", async () => {
  setSubs([
   sub({ id: "done1", agent: "task", description: "跑测试", status: "completed" }),
   sub({ id: "run1" }),
   sub({ id: "run2", agent: "reviewer", description: "审代码" }),
  ]);
  await mount();
  expect(container.textContent).toContain(zh.panelSubagents);
  expect(container.textContent).toContain(fmt(zh.saRunning, 2));
  const rows = [...container.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("scout");
  expect(rows[1]).toContain("reviewer");
  expect(rows[2]).toContain("task");
  expect(rows[0]).toContain("调研 A 模块");
  expect(container.textContent).toContain(zh.saStatusRunning);
  expect(container.textContent).toContain(zh.saStatusCompleted);
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(zh.saStatusRunning);
 });

 it("点「取消」调 cancelSubagent(sid, id)，pending 期间防重", async () => {
  setSubs([sub({ id: "run1" }), sub({ id: "run2", agent: "reviewer" })]);
  await mount();
  const btns = cancels();
  expect(btns).toHaveLength(2);
  expect(btns[0].getAttribute("aria-label")).toBe(fmt(zh.saCancelAria, "scout"));
  await click(btns[0]);
  expect(apiMock.cancelSubagent).toHaveBeenCalledWith("s1", "run1");
  expect(btns[0].disabled).toBe(true);
  await click(btns[0]);
  expect(apiMock.cancelSubagent).toHaveBeenCalledTimes(1);
 });

 it("取消失败：解除 pending，可以再点一次", async () => {
  apiMock.cancelSubagent.mockRejectedValueOnce(new Error("连接断了"));
  setSubs([sub({ id: "run1" })]);
  await mount();
  const btn = cancels()[0];
  await click(btn);
  expect(apiMock.cancelSubagent).toHaveBeenCalledTimes(1);
  expect(btn.disabled).toBe(false);
  await click(btn);
  expect(apiMock.cancelSubagent).toHaveBeenCalledTimes(2);
 });

 it("点行主体：拉该子代理的转录（不带 fromByte）并渲染文本与工具调用行", async () => {
  apiMock.getSubagentMessages.mockResolvedValueOnce({
   sessionFile: "/tmp/sub.jsonl",
   fromByte: 0,
   nextByte: 42,
   messages: [
    { role: "user", content: [{ type: "text", text: "先调研一下" }] },
    {
     role: "assistant",
     content: [
      { type: "thinking", thinking: "内心戏不渲染" },
      { type: "text", text: "好，我来" },
      { type: "toolCall", name: "bash", arguments: { command: "ls" } },
     ],
    },
    { role: "assistant", content: [{ type: "text", text: "   " }] },
   ],
  });
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(openers()[0]);
  expect(apiMock.getSubagentMessages).toHaveBeenCalledWith("s1", "run1", undefined);

  const p = pane();
  expect(p).not.toBeNull();
  expect(p!.getAttribute("aria-label")).toBe(fmt(zh.saTranscriptAria, "scout"));
  expect(p!.textContent).toContain("先调研一下");
  expect(p!.textContent).toContain("好，我来");
  expect(p!.textContent).toContain("⚙ bash");
  expect(p!.textContent).not.toContain("内心戏不渲染");
  expect(p!.textContent).not.toContain(zh.saTranscriptEmpty);

  // 再点收起：面板消失（定时器随卸载清掉）
  await click(openers()[0]);
  expect(pane()).toBeNull();
 });

 it("转录读取失败：显示一行错误（fmt saTranscriptFailed）而不是空态", async () => {
  const msg = "Unknown subagent or session file unavailable: run9";
  apiMock.getSubagentMessages.mockRejectedValueOnce(new Error(msg));
  setSubs([sub({ id: "run9" })]);
  await mount();
  await click(openers()[0]);
  const p = pane();
  expect(p!.textContent).toContain(fmt(zh.saTranscriptFailed, msg));
  expect(p!.querySelector('[role="alert"]')).not.toBeNull();
  expect(p!.textContent).not.toContain(zh.saTranscriptEmpty);
 });

 it("「刷新」带上次的 nextByte 增量拉，并追加到已有内容后面", async () => {
  apiMock.getSubagentMessages
   .mockResolvedValueOnce({
    sessionFile: "/tmp/sub.jsonl",
    fromByte: 0,
    nextByte: 42,
    messages: [{ role: "assistant", content: [{ type: "text", text: "第一段" }] }],
   })
   .mockResolvedValueOnce({
    sessionFile: "/tmp/sub.jsonl",
    fromByte: 42,
    nextByte: 77,
    messages: [{ role: "assistant", content: [{ type: "text", text: "第二段" }] }],
   });
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(openers()[0]);
  expect(pane()!.textContent).toContain("第一段");

  await click(refreshBtn());
  expect(apiMock.getSubagentMessages).toHaveBeenLastCalledWith("s1", "run1", 42);
  expect(pane()!.textContent).toContain("第一段");
  expect(pane()!.textContent).toContain("第二段");
 });

 it("reset: true 丢弃旧内容重建（已完成的行同样能回看）", async () => {
  apiMock.getSubagentMessages
   .mockResolvedValueOnce({
    sessionFile: "/tmp/sub.jsonl",
    fromByte: 0,
    nextByte: 10,
    messages: [{ role: "assistant", content: [{ type: "text", text: "旧内容" }] }],
   })
   .mockResolvedValueOnce({
    sessionFile: "/tmp/sub2.jsonl",
    fromByte: 0,
    nextByte: 30,
    reset: true,
    messages: [{ role: "assistant", content: [{ type: "text", text: "新内容" }] }],
   });
  setSubs([sub({ id: "run1" }), sub({ id: "done1", agent: "task", status: "completed" })]);
  await mount();
  await click(openers("task")[0]);
  expect(pane()!.textContent).toContain("旧内容");

  await click(refreshBtn());
  expect(apiMock.getSubagentMessages).toHaveBeenLastCalledWith("s1", "done1", 10);
  expect(pane()!.textContent).toContain("新内容");
  expect(pane()!.textContent).not.toContain("旧内容");
 });

 it("超过 200 条保尾截前：只渲染最近 200 条并注明省略数", async () => {
  const messages = Array.from({ length: 205 }, (_, i) => ({
   role: "assistant",
   content: [{ type: "text", text: `第 ${i} 条` }],
  }));
  apiMock.getSubagentMessages.mockResolvedValueOnce({
   sessionFile: "/tmp/sub.jsonl",
   fromByte: 0,
   nextByte: 9,
   messages,
  });
  setSubs([sub({ id: "run1" }), sub({ id: "done1", agent: "task", status: "completed" })]);
  await mount();
  await click(openers("task")[0]);

  const p = pane()!;
  expect(p.textContent).toContain(fmt(zh.saTranscriptMore, 5));
  expect(p.textContent).not.toContain("第 4 条");
  expect(p.textContent).toContain("第 5 条");
  expect(p.textContent).toContain("第 204 条");
 });

 it("同一时刻只展开一个：展开另一行会收起上一行的转录", async () => {
  setSubs([sub({ id: "run1" }), sub({ id: "run2", agent: "reviewer" })]);
  await mount();
  await click(openers("scout")[0]);
  expect(pane()!.getAttribute("aria-label")).toBe(fmt(zh.saTranscriptAria, "scout"));
  expect(apiMock.getSubagentMessages).toHaveBeenCalledWith("s1", "run1", undefined);

  await click(openers("reviewer")[0]);
  expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
  expect(pane()!.getAttribute("aria-label")).toBe(fmt(zh.saTranscriptAria, "reviewer"));
  expect(apiMock.getSubagentMessages).toHaveBeenLastCalledWith("s1", "run2", undefined);
 });

 it("running 时每 3s 增量拉一次；转终态后不再轮询", async () => {
  vi.useFakeTimers();
  try {
   setSubs([sub({ id: "run1" })]);
   await mount();
   await click(openers()[0]);
   expect(apiMock.getSubagentMessages).toHaveBeenCalledTimes(1);

   await act(async () => {
    vi.advanceTimersByTime(3000);
   });
   expect(apiMock.getSubagentMessages).toHaveBeenCalledTimes(2);
   expect(apiMock.getSubagentMessages).toHaveBeenLastCalledWith("s1", "run1", 100);

   act(() => useApp.setState({ subagentsBySession: { s1: [sub({ id: "run1", status: "completed" })] } }));
   await act(async () => {
    vi.advanceTimersByTime(9000);
   });
   expect(apiMock.getSubagentMessages).toHaveBeenCalledTimes(2);
  } finally {
   vi.useRealTimers();
  }
 });
});
