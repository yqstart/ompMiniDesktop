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
