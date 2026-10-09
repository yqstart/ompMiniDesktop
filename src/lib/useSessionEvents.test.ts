import { describe, expect, it, beforeEach } from "vitest";
import { frameToViewMsgs, __resetFolds } from "./useSessionEvents";
import { mergeViewMsgs, type IncomingViewMsg } from "./mergeEvents";
import { TEXT } from "./locale";
import type { ViewMsg } from "@shared/types";

/**
 * 实时事件帧 → 流（`frameToViewMsgs` + `mergeViewMsgs` 的组合，即 useSessionEvents 的落库管线）。
 *
 * 重点守着两类**真实踩过的**坑：
 * - 流式文本在 `message_end` 处**不许双份**（真机 18.8.3 的 message_end 携带全文；
 *   恢复 V1–V10 代码时修正过这个缺陷）；
 * - 同一次工具调用的多阶段帧合并成**一张卡**（V11 前修过的「已完成工具仍转圈」）。
 */

const dict = TEXT["zh-CN"];

/** 把一串帧按 useSessionEvents 的口径落进流。 */
function feed(frames: Record<string, unknown>[]): ViewMsg[] {
 let cur: ViewMsg[] = [];
 for (const f of frames) {
  cur = mergeViewMsgs(cur, frameToViewMsgs("s1", f, dict) as IncomingViewMsg[]);
 }
 return cur;
}

const delta = (type: string, text?: string): Record<string, unknown> => ({
 type: "message_update",
 assistantMessageEvent: { type, contentIndex: 0, ...(text != null ? { delta: text } : {}) },
});

beforeEach(() => __resetFolds());

describe("实时流管线：文本", () => {
 it("流式 deltas 逐片原位覆盖，最终只留一条文本", () => {
  const cur = feed([delta("text_start"), delta("text_delta", "你"), delta("text_delta", "好")]);
  expect(cur).toHaveLength(1);
  expect(cur[0].kind === "text" && cur[0].text).toBe("你好");
  expect(cur[0].kind === "text" && cur[0].complete).toBe(false);
 });

 it("message_end 不追加第二条文本，而是把流里那条补全（真机 message_end 携带全文）", () => {
  const cur = feed([
   delta("text_start"),
   delta("text_delta", "OK"),
   delta("text_delta", "了老铁"),
   { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "OK了老铁" }] } },
  ]);
  expect(cur, "全文只应出现一条文本行").toHaveLength(1);
  const row = cur[0];
  expect(row.kind === "text" && row.text).toBe("OK了老铁");
  expect(row.kind === "text" && row.complete).toBe(true);
 });

 it("订阅错过流式帧时，message_end 仍把文本补出来（不丢内容）", () => {
  const cur = feed([
   { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "只收到终帧" }] } },
  ]);
  expect(cur).toHaveLength(1);
  expect(cur[0].kind === "text" && cur[0].text).toBe("只收到终帧");
 });

 it("多段文本按 contentIndex 各自一行（不互相覆盖）", () => {
  const cur = feed([
   delta("text_start"),
   delta("text_delta", "第一段"),
   { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 1 } },
   { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 1, delta: "第二段" } },
   { type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "第一段" }, { type: "text", text: "第二段" }] } },
  ]);
  const texts = cur.filter((m) => m.kind === "text").map((m) => m.kind === "text" && m.text);
  expect(texts).toEqual(["第一段", "第二段"]);
 });
});

describe("实时流管线：工具卡", () => {
 it("同一 toolCallId 的 start / end 合并成一张卡，输出与状态就地覆盖", () => {
  const cur = feed([
   { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } },
   { type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"path":"a.txt"}' } },
   {
    type: "message_update",
    assistantMessageEvent: {
     type: "toolcall_end",
     contentIndex: 0,
     toolCall: { id: "tc-1", name: "read", arguments: { path: "a.txt" }, streamIndex: 0, intent: "看看文件" },
    },
   },
   { type: "tool_execution_start", toolCallId: "tc-1", toolName: "read", args: { path: "a.txt" }, intent: "看看文件" },
   { type: "tool_execution_end", toolCallId: "tc-1", toolName: "read", isError: false, result: { content: [{ type: "text", text: "文件内容" }] } },
  ]);
  const cards = cur.filter((m) => m.kind === "tool");
  expect(cards, "一次调用只应有一张卡").toHaveLength(1);
  const card = cards[0];
  expect(card.kind === "tool" && card.state).toBe("ok");
  expect(card.kind === "tool" && card.argsSummary).toBe("a.txt");
  expect(card.kind === "tool" && card.output).toBe("文件内容");
  expect(card.kind === "tool" && card.intent).toBe("看看文件");
 });
});

describe("实时流管线：标题", () => {
 it("title_change 更新会话标题（不进消息流）", async () => {
  const { useApp } = await import("../stores/app");
  useApp.setState({
   sessions: [{ id: "s1", projectId: "p1", title: "未命名会话 10-09", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: null, running: true }],
  });
  const msgs = frameToViewMsgs("s1", { type: "title_change", title: "登录页重构" }, dict);
  expect(msgs).toHaveLength(0);
  expect(useApp.getState().sessions.find((s) => s.id === "s1")?.title).toBe("登录页重构");
 });

 it("有备注的会话：实时标题不覆盖备注显示", async () => {
  const { useApp } = await import("../stores/app");
  useApp.setState({
   sessions: [{ id: "s1", projectId: "p1", title: "我的备注", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: "我的备注", running: true }],
  });
  frameToViewMsgs("s1", { type: "title_change", title: "omp 的标题" }, dict);
  expect(useApp.getState().sessions.find((s) => s.id === "s1")?.title).toBe("我的备注");
 });
});

describe("实时流管线：用户回显", () => {
 const echoFrame = (text: string): Record<string, unknown> => ({
  type: "message_start",
  message: { role: "user", content: [{ type: "text", text }] },
 });

 it("omp 的实时回显接管本地乐观回显：发一次只有一条气泡", () => {
  // Composer 发送时的乐观回显（appendEvents 直接进流，不走本管线）
  let cur: ViewMsg[] = [{ kind: "user", id: "u-local-123", text: "你好", mentions: [] }];
  cur = mergeViewMsgs(cur, frameToViewMsgs("s1", echoFrame("你好"), dict) as IncomingViewMsg[]);
  const users = cur.filter((m) => m.kind === "user");
  expect(users, "回显到达后只该剩一条用户消息（此前的缺陷是两条都留着）").toHaveLength(1);
  expect(users[0].id.startsWith("u-echo-"), "本地行被换成回显版本").toBe(true);
 });

 it("连发两条相同文本：回显按顺序一对一接管，不互相顶掉", () => {
  let cur: ViewMsg[] = [{ kind: "user", id: "u-local-1", text: "继续", mentions: [] }];
  cur = mergeViewMsgs(cur, frameToViewMsgs("s1", echoFrame("继续"), dict) as IncomingViewMsg[]);
  // 第二条的乐观回显（直接 append），随后第二条回显到达
  cur = [...cur, { kind: "user", id: "u-local-2", text: "继续", mentions: [] }];
  cur = mergeViewMsgs(cur, frameToViewMsgs("s1", echoFrame("继续"), dict) as IncomingViewMsg[]);
  const users = cur.filter((m) => m.kind === "user");
  expect(users).toHaveLength(2);
  expect(users.every((m) => m.id.startsWith("u-echo-"))).toBe(true);
 });

 it("没有乐观回显的消息（排队 / 别处发来）照常显示", () => {
  const cur = mergeViewMsgs([], frameToViewMsgs("s1", echoFrame("排队消息"), dict) as IncomingViewMsg[]);
  expect(cur.filter((m) => m.kind === "user")).toHaveLength(1);
 });
});

describe("实时流管线：思考", () => {
 const thinkingFrame = (type: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "message_update",
  assistantMessageEvent: { type, contentIndex: 0, ...extra },
 });

 it("思考中可见：首个 delta 就有 complete:false 的块，end 就地落定同一条", () => {
  let cur: ViewMsg[] = [];
  const push = (f: Record<string, unknown>) => {
   cur = mergeViewMsgs(cur, frameToViewMsgs("s1", f, dict) as IncomingViewMsg[]);
  };
  push(thinkingFrame("thinking_start"));
  expect(cur.filter((m) => m.kind === "thinking"), "还没内容时不产块").toHaveLength(0);
  push(thinkingFrame("thinking_delta", { delta: "先看" }));
  push(thinkingFrame("thinking_delta", { delta: "目录" }));
  const mid = cur.find((m) => m.kind === "thinking");
  expect(mid?.kind === "thinking" && mid.complete, "流式中 = 「思考中…」").toBe(false);
  expect(mid?.kind === "thinking" && mid.text).toBe("先看目录");
  push(thinkingFrame("thinking_end", { content: "先看目录" }));
  const thinks = cur.filter((m) => m.kind === "thinking");
  expect(thinks, "整段思考始终只有一块").toHaveLength(1);
  expect(thinks[0].kind === "thinking" && thinks[0].complete).toBe(true);
  expect(thinks[0].kind === "thinking" && thinks[0].text).toBe("先看目录");
 });

 it("空思考不产块：只有 start/end 且无内容时不出现「思考 · 0 秒」噪声", () => {
  const cur = feed([thinkingFrame("thinking_start"), thinkingFrame("thinking_end", { content: "" })]);
  expect(cur.filter((m) => m.kind === "thinking")).toHaveLength(0);
 });
});
