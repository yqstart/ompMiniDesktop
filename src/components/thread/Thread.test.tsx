// @vitest-environment jsdom
/**
 * Thread 渲染冒烟（jsdom + createRoot，与浏览器同路径）：
 * 内联一组真实形状的 jsonl 行 → viewMsgsFromJsonlLines → 渲染整棵 Thread，
 * 断言不崩、且用户消息与工具行的关键内容出现。
 *
 * 为什么要有这条：`打开已有会话 → 历史落库 → 渲染` 是"右侧不显示"类问题的
 * 唯一端到端覆盖（jsdom 是这两条测试的测试环境依赖，见 THIRD-PARTY-NOTICES）。
 */
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { THREAD_PAGE, useApp } from "../../stores/app";
import { viewMsgsFromJsonlLines } from "../../lib/viewmsg";
import { TEXT } from "../../lib/locale";
import { Thread } from "./Thread";

// 让 React 的 act(...) 在 jsdom 下进入"测试环境"模式（消除 "not configured" 警告）
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

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
