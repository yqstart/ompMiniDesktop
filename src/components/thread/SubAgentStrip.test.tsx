// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubAgentInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt, TEXT } from "../../lib/locale";

/**
 * 子代理状态条（V41）：只在有 running 时露面 / 数量文案 / 浮层列全部（running 在前）
 * 与取消 / Esc 与点外关闭 / 跑完不自动收起与空态；以及每行的转录展开
 * （首拉不带 fromByte、增量复用 nextByte、reset 重建、失败错误行、单开与轮询）。
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

import { SubAgentStrip } from "./SubAgentStrip";

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
 act(() => root.render(<SubAgentStrip />));
 await act(async () => {});
};

const bar = () => container.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]');
const panel = () => container.querySelector<HTMLElement>('[role="dialog"]');

const click = async (el: Element | null | undefined) => {
 await act(async () => {
  (el as HTMLElement | undefined)?.click();
 });
};

/** 浮层里的取消按钮（文本 = 字典的 saCancel）。 */
const cancels = () =>
 [...(panel()?.querySelectorAll("button") ?? [])].filter((b) => b.textContent === zh.saCancel);

/** 行尾的「查看输出」入口（aria-label = 字典的 saOpen）。 */
const openers = () =>
 [...(panel()?.querySelectorAll("button") ?? [])].filter((b) => b.getAttribute("aria-label") === zh.saOpen);

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

describe("SubAgentStrip", () => {
 it("没有运行中的子代理：整条不渲染（已完成的历史不占版面）", async () => {
  setSubs([
   sub({ id: "a", status: "completed" }),
   sub({ id: "b", status: "failed" }),
   sub({ id: "c", status: "aborted" }),
  ]);
  await mount();
  expect(bar()).toBeNull();
  expect(container.textContent).toBe("");
 });

 it("运行中数量文案：2 个 running（另有 1 个已完成）渲染「2 个子代理运行中」", async () => {
  setSubs([
   sub({ id: "a" }),
   sub({ id: "b", agent: "reviewer", description: "审代码" }),
   sub({ id: "c", status: "completed" }),
  ]);
  await mount();
  expect(container.textContent).toContain(fmt(zh.saRunning, 2));
  // 未展开：没有浮层，横条自己报收起态
  expect(panel()).toBeNull();
  expect(bar()?.getAttribute("aria-expanded")).toBe("false");
 });

 it("点开浮层：列出全部子代理（running 在前），点「取消」调 cancelSubagent(sid, id)", async () => {
  setSubs([
   sub({ id: "done1", agent: "task", description: "跑测试", status: "completed" }),
   sub({ id: "run1" }),
   sub({ id: "run2", agent: "reviewer", description: "审代码" }),
  ]);
  await mount();
  await click(bar());
  const p = panel();
  expect(p).not.toBeNull();
  expect(bar()?.getAttribute("aria-expanded")).toBe("true");

  // 全部列出（含已完成），running 在前
  const rows = [...p!.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(rows).toHaveLength(3);
  expect(rows[0]).toContain("scout");
  expect(rows[1]).toContain("reviewer");
  expect(rows[2]).toContain("task");
  expect(rows[0]).toContain("调研 A 模块");

  // 状态文案可见 + 色点带 aria-label（颜色不作唯一信号）
  expect(p!.textContent).toContain(zh.saStatusRunning);
  expect(p!.textContent).toContain(zh.saStatusCompleted);
  expect(p!.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(zh.saStatusRunning);

  // 只有 running 行有取消按钮
  const btns = cancels();
  expect(btns).toHaveLength(2);
  expect(btns[0].getAttribute("aria-label")).toBe(fmt(zh.saCancelAria, "scout"));

  await click(btns[0]);
  expect(apiMock.cancelSubagent).toHaveBeenCalledWith("s1", "run1");
  // pending 防重：按钮禁用且再点不重复提交
  expect(btns[0].disabled).toBe(true);
  await click(btns[0]);
  expect(apiMock.cancelSubagent).toHaveBeenCalledTimes(1);
 });

 it("取消失败：解除 pending，可以再点一次", async () => {
  apiMock.cancelSubagent.mockRejectedValueOnce(new Error("连接断了"));
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(bar());
  const btn = cancels()[0];
  await click(btn);
  expect(apiMock.cancelSubagent).toHaveBeenCalledTimes(1);
  expect(btn.disabled).toBe(false);
  await click(btn);
  expect(apiMock.cancelSubagent).toHaveBeenCalledTimes(2);
 });

 it("Esc 关闭浮层（不要求焦点在浮层里），横条仍在并报收起态", async () => {
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(bar());
  expect(panel()).not.toBeNull();

  await act(async () => {
   window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  });
  expect(panel()).toBeNull();
  expect(bar()?.getAttribute("aria-expanded")).toBe("false");
  expect(bar()?.textContent).toContain(fmt(zh.saRunning, 1));
 });

 it("关闭口径：点击外部关闭；再点横条自己也能开合", async () => {
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(bar());
  expect(panel()).not.toBeNull();

  await act(async () => {
   document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
  });
  expect(panel()).toBeNull();

  await click(bar());
  expect(panel()).not.toBeNull();
  await click(bar());
  expect(panel()).toBeNull();
 });

 it("浮层里的点击不算点外：关闭按钮收起面板", async () => {
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(bar());
  const close = panel()?.querySelector<HTMLButtonElement>(`button[aria-label="${zh.saClose}"]`);
  await click(close);
  expect(panel()).toBeNull();
 });

 it("最后一个子代理跑完后浮层不自动收起（已完成的历史看得到）；收起后整条消失", async () => {
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(bar());

  act(() => useApp.setState({ subagentsBySession: { s1: [sub({ id: "run1", status: "completed" })] } }));
  expect(panel()).not.toBeNull();
  expect(panel()!.textContent).toContain(zh.saStatusCompleted);
  // 没有运行中的了：横条改述空状态，不谎报「0 个运行中」
  expect(bar()?.textContent).toContain(zh.saIdleHint);

  await click(bar());
  expect(container.textContent).toBe("");
 });

 it("浮层开着时切到没有子代理的会话：列表给空态文案", async () => {
  setSubs([sub({ id: "run1" })]);
  await mount();
  await click(bar());

  act(() => useApp.setState({ activeSessionId: "s2", subagentsBySession: {} }));
  expect(panel()?.textContent).toContain(zh.saEmpty);
 });

 it("点「查看输出」：拉该子代理的转录（不带 fromByte）并渲染文本与工具调用行", async () => {
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
  await click(bar());

  const btn = openers()[0];
  expect(btn.getAttribute("aria-label")).toBe(zh.saOpen);
  // 入口对已完成的行也在（终态行同样可回看），这里只有 running 一行先验证展开
  await click(btn);
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
  await click(bar());
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
  await click(bar());
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
  // completed 的行没有定时器干扰，reset 重建看得最干净；留一个 running 撑起横条
  setSubs([sub({ id: "run1" }), sub({ id: "done1", status: "completed" })]);
  await mount();
  await click(bar());
  await click(openers()[1]);
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
  // 同样用一个 running 撑起横条，展开 completed 那行
  setSubs([sub({ id: "run1" }), sub({ id: "done1", status: "completed" })]);
  await mount();
  await click(bar());
  await click(openers()[1]);

  const p = pane()!;
  expect(p.textContent).toContain(fmt(zh.saTranscriptMore, 5));
  expect(p.textContent).not.toContain("第 4 条");
  expect(p.textContent).toContain("第 5 条");
  expect(p.textContent).toContain("第 204 条");
 });

 it("同一时刻只展开一个：展开另一行会收起上一行的转录", async () => {
  setSubs([sub({ id: "run1" }), sub({ id: "run2", agent: "reviewer" })]);
  await mount();
  await click(bar());

  await click(openers()[0]);
  expect(pane()!.getAttribute("aria-label")).toBe(fmt(zh.saTranscriptAria, "scout"));
  expect(apiMock.getSubagentMessages).toHaveBeenCalledWith("s1", "run1", undefined);

  await click(openers()[1]);
  expect(container.querySelectorAll('[role="region"]')).toHaveLength(1);
  expect(pane()!.getAttribute("aria-label")).toBe(fmt(zh.saTranscriptAria, "reviewer"));
  expect(apiMock.getSubagentMessages).toHaveBeenLastCalledWith("s1", "run2", undefined);
 });

 it("running 时每 3s 增量拉一次；转终态后不再轮询", async () => {
  vi.useFakeTimers();
  try {
   setSubs([sub({ id: "run1" })]);
   await mount();
   await click(bar());
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
