import { beforeEach, describe, expect, it } from "vitest";
import type { ViewMsg } from "@shared/types";
import { mergeViewMsgs, type IncomingViewMsg } from "./mergeEvents";
import { __resetFolds, frameToViewMsgs } from "./useSessionEvents";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";

const zh = TEXT["zh-CN"];

/**
 * 回归测试：一次工具调用在 RPC 流里分多个阶段到达，必须始终合并成**一张**卡。
 * 这正是 review 发现的问题——旧实现按阶段无脑追加，导致「输入中」那张卡永远转圈，
 * 且 `toolcall_delta` 与 `toolcall_end` 复用同一 id 会触发 React 重复 key 警告。
 */

const SID = "sess-1";

/** 按真实线序回放一批帧，返回累积后的消息流。 */
function replay(frames: Record<string, unknown>[]): ViewMsg[] {
 let msgs: ViewMsg[] = [];
 for (const f of frames) {
  msgs = mergeViewMsgs(msgs, frameToViewMsgs(SID, f, zh) as IncomingViewMsg[]);
 }
 return msgs;
}

const toolFrames = (): Record<string, unknown>[] => [
 // 1) 参数流式拼片（只有 contentIndex，没有 toolCallId）
 { type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 } },
 {
  type: "message_update",
  assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: '{"command":"echo hi"}' },
 },
 // 2) 调用结束：参数与意图齐了，toolCallId 出现
 {
  type: "message_update",
  assistantMessageEvent: {
   type: "toolcall_end",
   contentIndex: 1,
   toolCall: {
    id: "call_abc",
    name: "bash",
    arguments: { command: "echo hi" },
    streamIndex: 1,
    intent: "打印 hi",
   },
  },
 },
 // 3) 开始执行
 { type: "tool_execution_start", toolCallId: "call_abc", toolName: "bash", args: { command: "echo hi" }, intent: "打印 hi" },
 // 4) 执行结束
 { type: "tool_execution_end", toolCallId: "call_abc", toolName: "bash", isError: false, result: { content: [{ type: "text", text: "hi" }] } },
 // 5) 落盘态的 toolResult 回放（同一次调用）
 { type: "message_end", message: { role: "toolResult", toolCallId: "call_abc", toolName: "bash", content: [{ type: "text", text: "hi" }] } },
];

describe("实时流合并：工具卡", () => {
 beforeEach(() => __resetFolds());

 it("一次工具调用从输入中到成功只出一张卡", () => {
  const msgs = replay(toolFrames());
  const tools = msgs.filter((m) => m.kind === "tool");
  expect(tools).toHaveLength(1);
  const [card] = tools as Extract<ViewMsg, { kind: "tool" }>[];
  expect(card.state).toBe("ok");
  expect(card.toolCallId).toBe("call_abc");
  expect(card.name).toBe("bash");
 });

 it("终态卡保留早期事件里的参数摘要与意图（不许被空字段覆盖）", () => {
  const msgs = replay(toolFrames());
  const card = msgs.find((m) => m.kind === "tool") as Extract<ViewMsg, { kind: "tool" }>;
  expect(card.argsSummary).toBe("echo hi");
  expect(card.intent).toBe("打印 hi");
  expect(card.output).toBe("hi");
 });

 it("中间阶段只有一张卡：toolcall_end 不会与 delta 占位卡并存", () => {
  const frames = toolFrames().slice(0, 3);
  const msgs = replay(frames);
  expect(msgs.filter((m) => m.kind === "tool")).toHaveLength(1);
  const card = msgs[0] as Extract<ViewMsg, { kind: "tool" }>;
  expect(card.state).toBe("running");
  expect(card.id).toBe("tool:call_abc");
 });

 it("内部标记不会漏进 store（ViewMsg 契约保持干净）", () => {
  const msgs = replay(toolFrames());
  for (const m of msgs) {
   expect("__append" in m).toBe(false);
   expect("__replaceId" in m).toBe(false);
  }
 });

 it("多工具并行各出一张卡，互不串卡", () => {
  const msgs = replay([
   ...toolFrames(),
   {
    type: "message_update",
    assistantMessageEvent: {
     type: "toolcall_end",
     contentIndex: 2,
     toolCall: { id: "call_def", name: "read", arguments: { path: "/tmp/a.ts" }, streamIndex: 2 },
    },
   },
   { type: "tool_execution_end", toolCallId: "call_def", isError: true, result: { content: [{ type: "text", text: "not found" }] } },
  ]);
  const tools = msgs.filter((m) => m.kind === "tool") as Extract<ViewMsg, { kind: "tool" }>[];
  expect(tools).toHaveLength(2);
  expect(tools.find((t) => t.toolCallId === "call_abc")?.state).toBe("ok");
  expect(tools.find((t) => t.toolCallId === "call_def")?.state).toBe("error");
  expect(tools.find((t) => t.toolCallId === "call_def")?.argsSummary).toBe("/tmp/a.ts");
 });

 it("被拒绝的工具显示「被用户拒绝」且为失败态", () => {
  const msgs = replay([
   ...toolFrames().slice(0, 4),
   {
    type: "message_end",
    message: {
     role: "toolResult",
     toolCallId: "call_abc",
     toolName: "bash",
     isError: true,
     content: [{ type: "text", text: "Tool call denied by user: bash" }],
    },
   },
  ]);
  const card = msgs.find((m) => m.kind === "tool") as Extract<ViewMsg, { kind: "tool" }>;
  expect(card.state).toBe("error");
  expect(card.output).toBe("被用户拒绝");
 });
});

describe("实时流合并：文本与审批", () => {
 beforeEach(() => __resetFolds());

 it("text 流式按同 id 覆盖，不新增消息行", () => {
  const frames = [
   { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
   { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "你" } },
   { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "好" } },
  ];
  const msgs = replay(frames);
  expect(msgs).toHaveLength(1);
  expect(msgs[0].kind === "text" && msgs[0].text).toBe("你好");
 });

 it("同一审批请求重复推送只保留一张卡", () => {
  const frame = { type: "extension_ui_request", method: "select", id: "ui-1", title: "Allow tool: bash" };
  const msgs = replay([frame, frame]);
  expect(msgs).toHaveLength(1);
  expect(msgs[0].kind).toBe("approval");
 });
});

describe("mergeViewMsgs 基础语义", () => {
 it("空追加不改变已有消息", () => {
  const cur: ViewMsg[] = [{ kind: "text", id: "t:1", seq: 0, text: "x", complete: true }];
  expect(mergeViewMsgs(cur, [])).toEqual(cur);
 });

 // V2 M8：行级 memo（ThreadRow）成立的前提——没变化的消息必须保持同一对象引用，
 // 否则流式每个 delta 都会让整列重渲染（上千条时每次 token 重算全部 Markdown）。
 it("未变化的消息保持同一对象引用", () => {
  const first = mergeViewMsgs([], [
   { kind: "text", id: "t:1", seq: 0, text: "已有内容", complete: true } as ViewMsg,
  ]);
  const second = mergeViewMsgs(first, [
   { kind: "text", id: "t:2", seq: 0, text: "新来的一条", complete: true } as ViewMsg,
  ]);
  expect(second[0]).toBe(first[0]);
  expect(second[1]).not.toBe(first[0]);
 });

 it("流式覆盖只替换被覆盖的那一行", () => {
  const first = mergeViewMsgs([], [
   { kind: "text", id: "t:1", seq: 0, text: "旧", complete: true } as ViewMsg,
   { kind: "text", id: "t:2", seq: 0, text: "流式中", complete: false } as ViewMsg,
  ]);
  const second = mergeViewMsgs(first, [
   { kind: "text", id: "t:2", seq: 0, text: "流式中（新）", complete: false, __append: true } as IncomingViewMsg,
  ]);
  expect(second[0]).toBe(first[0]);
  expect(second[1]).not.toBe(first[1]);
  expect(second[1].kind === "text" && second[1].text).toBe("流式中（新）");
 });
});

/**
 * V2 M5：`extension_ui_request` 不再"除 select 外一律当审批"。
 * 审批只认 select（options 含 Approve，或 options 缺失时兜底），
 * confirm / input / editor / 非审批 select 走通用 UI 请求卡，回包语义由后端按方法组装。
 */
describe("实时流合并：通用 UI 请求", () => {
 beforeEach(() => __resetFolds());

 it("confirm / input / editor 各出一张通用 UI 卡，字段不丢", () => {
  const confirm = replay([
   { type: "extension_ui_request", id: "c1", method: "confirm", title: "清理？", message: "删 3 个文件" },
  ]);
  expect(confirm).toHaveLength(1);
  const c = confirm[0] as Extract<ViewMsg, { kind: "ui" }>;
  expect(c.kind).toBe("ui");
  expect(c.method).toBe("confirm");
  expect(c.uiId).toBe("c1");
  expect(c.message).toBe("删 3 个文件");

  const input = replay([
   { type: "extension_ui_request", id: "i1", method: "input", title: "分支名？", placeholder: "feature/…" },
  ]);
  expect((input[0] as Extract<ViewMsg, { kind: "ui" }>).placeholder).toBe("feature/…");

  const editor = replay([
   { type: "extension_ui_request", id: "e1", method: "editor", title: "提交信息", prefill: "chore: " },
  ]);
  const e = editor[0] as Extract<ViewMsg, { kind: "ui" }>;
  expect(e.method).toBe("editor");
  expect(e.prefill).toBe("chore: ");
 });

 it("审批只认 select：含 Approve 或 options 缺失都走审批卡", () => {
  const withApprove = replay([
   { type: "extension_ui_request", id: "a1", method: "select", title: "Allow tool: bash", options: ["Approve", "Deny"] },
  ]);
  expect(withApprove[0].kind).toBe("approval");
  const noOptions = replay([{ type: "extension_ui_request", id: "a2", method: "select", title: "Allow tool: bash" }]);
  expect(noOptions[0].kind).toBe("approval");
 });

 it("非审批 select 带选项清单，走通用 UI 卡", () => {
  const msgs = replay([
   { type: "extension_ui_request", id: "s1", method: "select", title: "选分支", options: ["main", "release/2.0"] },
  ]);
  const s = msgs[0] as Extract<ViewMsg, { kind: "ui" }>;
  expect(s.kind).toBe("ui");
  expect(s.options).toEqual(["main", "release/2.0"]);
 });

 it("同一条请求重复推送只留一张卡；服务端撤回后卡片消失", () => {
  const req = { type: "extension_ui_request", id: "d1", method: "input", title: "说点什么" };
  expect(replay([req, req])).toHaveLength(1);

  const cancelled = replay([req, { type: "extension_ui_request", method: "cancel", targetId: "d1" }]);
  expect(cancelled.filter((m) => m.kind === "ui")).toHaveLength(0);
 });

 it("单向方法不占交互位：notify 走分隔线，其余忽略", () => {
  const notify = replay([
   { type: "extension_ui_request", id: "n1", method: "notify", message: "构建完成", notifyType: "info" },
  ]);
  expect(notify).toHaveLength(1);
  expect(notify[0].kind).toBe("divider");

  const quiet = replay([
   { type: "extension_ui_request", id: "w1", method: "setWidget", widgetKey: "k", widgetLines: ["a"] },
   { type: "extension_ui_request", id: "t1", method: "setTitle", title: "x" },
   { type: "extension_ui_request", id: "st1", method: "setStatus", statusKey: "k", statusText: "跑着呢" },
   { type: "extension_ui_request", id: "et1", method: "set_editor_text", text: "abc" },
  ]);
  expect(quiet).toHaveLength(0);
 });
});

/** V2 M6：随消息发出的图片在实时帧里也要落到 user 气泡（不是被丢掉）。 */
describe("实时流：用户消息的图片块", () => {
 beforeEach(() => __resetFolds());

 it("message_start(user) 的图片块并入同一条 user 消息", () => {
  const msgs = replay([
   {
    type: "message_start",
    message: {
     role: "user",
     content: [
      { type: "text", text: "看图" },
      { type: "image", data: "AAA", mimeType: "image/png" },
     ],
    },
   },
  ]);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({
   kind: "user",
   text: "看图",
   images: [{ mimeType: "image/png", data: "AAA" }],
  });
 });
});

/** V2 M6b：@文件 提及的 fileMention 只出一排芯片（start/end 各推一次也不许出两排）。 */
describe("实时流：@文件 提及", () => {
 beforeEach(() => __resetFolds());

 it("fileMention 的 start/end 各推一次，只出一排芯片", () => {
  const frame = {
   type: "message_start",
   message: {
    role: "fileMention",
    files: [
     { path: "docs/rpc-memo.md", content: "…", lineCount: 69 },
     { path: "a.bin", byteSize: 1024, skippedReason: "tooLarge" },
    ],
   },
  };
  const msgs = replay([frame, { ...frame, type: "message_end" }]);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({ kind: "files" });
  expect((msgs[0] as Extract<ViewMsg, { kind: "files" }>).files).toHaveLength(2);
 });

 it("fileMention 不影响同一批次里的文本流", () => {
  const msgs = replay([
   {
    type: "message_start",
    message: { role: "fileMention", files: [{ path: "a.ts", lineCount: 3 }] },
   },
   { type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } },
   { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
   { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "读完" } },
  ]);
  expect(msgs.map((m) => m.kind)).toEqual(["files", "text"]);
 });
});

/** 本轮新增：本地命令 / 计划 / 压缩重试 / 可用命令帧的归一。 */
describe("实时流：本地命令与计划事件", () => {
 it("command_output 落成 command 卡（灰字代码区）", () => {
  const msgs = replay([
   { type: "command_output", id: "c-1", output: "本地命令已执行：/compact" },
  ]);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({ kind: "command", output: "本地命令已执行：/compact" });
 });

 it("prompt_result（本地收尾）不渲染消息、不告警", () => {
  const msgs = replay([{ type: "prompt_result", id: "p-1", agentInvoked: false }]);
  expect(msgs).toHaveLength(0);
 });

 it("todo_reminder 落成 plan 卡（只读阶段清单）", () => {
  const msgs = replay([
   {
    type: "todo_reminder",
    phases: [{ id: "ph-1", name: "联调", tasks: [{ id: "t-1", content: "跑 e2e", status: "in_progress" }] }],
   },
  ]);
  expect(msgs).toHaveLength(1);
  expect(msgs[0]).toMatchObject({ kind: "plan" });
  const plan = msgs[0] as Extract<ViewMsg, { kind: "plan" }>;
  expect(plan.phases[0].tasks[0]).toMatchObject({ content: "跑 e2e", status: "in_progress" });
 });

 it("压缩 / 重试帧落成分隔线（不进消息计数）", () => {
  const msgs = replay([{ type: "auto_compaction_start" }, { type: "auto_compaction_end" }]);
  expect(msgs).toHaveLength(2);
  expect(msgs[0]).toMatchObject({ kind: "divider", text: "正在压缩上下文…" });
  expect(msgs[1]).toMatchObject({ kind: "divider", text: "上下文已压缩" });
 });

 it("available_commands_update 只缓存、不渲染消息", () => {
  const msgs = replay([
   { type: "available_commands_update", commands: [{ name: "compact", description: "压缩" }] },
  ]);
  expect(msgs).toHaveLength(0);
  expect(useApp.getState().commandsBySession[SID]).toMatchObject([{ name: "compact" }]);
 });
});

/**
 * 回归：会话还没有用户消息时，模型 / 思考档变更不算「会话中切换」——
 * 口径与历史回放（viewmsg.ts 的 `userSeen`）一致，新建对话顶部不许凭空多一行提示。
 */
describe("实时流：首条用户消息之前的模型 / 思考档变更", () => {
 beforeEach(() => __resetFolds());

 it("空会话（无用户消息）不渲染分隔线", () => {
  useApp.setState({ eventsBySession: {} });
  const msgs = replay([{ type: "model_changed" }, { type: "thinking_level_changed", thinkingLevel: "max" }]);
  expect(msgs).toHaveLength(0);
 });

 it("用户消息之后照旧渲染", () => {
  useApp.setState({
   eventsBySession: { [SID]: [{ kind: "user", id: "u-1", text: "hi", mentions: [] }] },
  });
  const msgs = replay([
   { type: "model_changed" },
   { type: "thinking_level_changed", thinkingLevel: "high" },
  ]);
  expect(msgs).toMatchObject([
   { kind: "divider", divider: "model", text: "已切换模型" },
   { kind: "divider", divider: "thinking", text: "思考等级已设为 high" },
  ]);
 });
});
