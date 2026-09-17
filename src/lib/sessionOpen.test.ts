/**
 * 打开会话的**全链路回归**（mock IPC，不依赖 Tauri）：
 * `openSessionWithHistory` 把 get_history 的行落库为消息流、重复打开不叠、
 * 回放超限时在流尾落一条注记（且不重复落）。
 *
 * 这条链路此前没有测试覆盖——排查「打开已有会话不显示」问题时它是最先被怀疑的对象。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const SID = "sess-open-1";

/** get_history 的形状（后端已过滤到 message/custom/title 系，包一层 {lines, truncated}）。 */
const HISTORY_LINES = [
 { type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "你好" }] } },
 {
  type: "message",
  id: "m2",
  message: {
   role: "assistant",
   content: [
    { type: "text", text: "我来跑一下" },
    { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" }, intent: "列出目录" },
   ],
  },
 },
 { type: "message", id: "m3", message: { role: "toolResult", toolCallId: "tc1", toolName: "bash", content: [{ type: "text", text: "a.txt" }] } },
 { type: "title_change", id: "t1", title: "会话标题" },
];

vi.mock("@shared/api", () => ({
 api: {
  openSession: vi.fn(async (id: string) => ({ id, projectId: "p1", title: "t", archived: false })),
  getSessionRuntime: vi.fn(async () => null),
  getHistory: vi.fn(async () => ({ lines: structuredClone(HISTORY_LINES), truncated: false })),
 },
}));

// node 环境没有 rAF：读底调用不需要真跑
(globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;

import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { openSessionWithHistory } from "./sessionOpen";

describe("打开会话：历史落库与去重", () => {
 beforeEach(() => {
  useApp.setState({ eventsBySession: {}, sessions: [], activeSessionId: null });
  vi.mocked(api.getHistory).mockResolvedValue({ lines: structuredClone(HISTORY_LINES), truncated: false });
 });

 it("历史落库（消息与工具痕迹都进流）", async () => {
  await openSessionWithHistory(SID);
  const kinds = (useApp.getState().eventsBySession[SID] ?? []).map((m) => m.kind);
  expect(kinds).toContain("user");
  expect(kinds).toContain("text");
  expect(kinds).toContain("tool");
 });

 it("重复打开同一会话不叠历史", async () => {
  await openSessionWithHistory(SID);
  const n1 = (useApp.getState().eventsBySession[SID] ?? []).length;
  await openSessionWithHistory(SID);
  expect(useApp.getState().eventsBySession[SID] ?? []).toHaveLength(n1);
 });

 it("truncated 时在流尾落一条注记，且重复打开不叠第二条", async () => {
  vi.mocked(api.getHistory).mockResolvedValue({ lines: structuredClone(HISTORY_LINES), truncated: true });
  await openSessionWithHistory(SID);
  expect((useApp.getState().eventsBySession[SID] ?? []).filter((m) => m.id === "hist-truncated")).toHaveLength(1);
  await openSessionWithHistory(SID);
  expect((useApp.getState().eventsBySession[SID] ?? []).filter((m) => m.id === "hist-truncated")).toHaveLength(1);
 });
});
