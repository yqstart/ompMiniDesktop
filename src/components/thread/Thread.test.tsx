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
import type { ViewMsg } from "@shared/types";
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

 it("运行中且流尾没有活行时补一条（工具跑完在等模型的间隙也补）", async () => {
  const base = viewMsgsFromJsonlLines(JSONL_LINES, TEXT["zh-CN"]);
  const { container, root } = await mount(base, "running");
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
