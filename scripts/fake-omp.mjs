#!/usr/bin/env node
/**
 * fake-omp：canned RPC 事件脚本，用于 M1 历史回放 / M2 全链路联调。
 * 用法：OMP_FAKE_SCENARIO=history|approve-once|deny|multi node scripts/fake-omp.mjs
 * 行协议与真实 omp --mode rpc 一致（ready/response/事件），便于 Rust pump 照单解析。
 */
import fs from "node:fs";

const scenario = process.env.OMP_FAKE_SCENARIO ?? "history";
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const sessionId = "01a08f64-617e-7465-acfa-ac5a6c174bf7";
const sessionFile = `/tmp/fake-agent/sessions/--fake--/2026-09-15T00-00-00-000Z_${sessionId}.jsonl`;

const stateData = {
  model: { provider: "commandcode", id: "claude-haiku-4-5-20251001" },
  thinkingLevel: "off",
  isStreaming: false,
  sessionFile,
  sessionId,
  messageCount: 2,
  contextUsage: { tokens: 100, contextWindow: 200000, percent: 0.05 },
};

function historyMessages() {
  return [
    { role: "user", content: [{ type: "text", text: "用bash执行 echo hi" }] },
    {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "简单任务，直接执行。" },
        {
          type: "toolCall",
          id: "call_00_fake1",
          name: "bash",
          arguments: { command: "echo hi" },
          streamIndex: 0,
          intent: "执行 echo 测试",
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: "call_00_fake1",
      toolName: "bash",
      content: [{ type: "text", text: "hi\n" }],
      isError: false,
    },
    { role: "assistant", content: [{ type: "text", text: "已执行，输出 `hi`。" }] },
  ];
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (d) => {
  buffer += d;
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (line) handle(line);
  }
});

function handle(line) {
  let cmd;
  try {
    cmd = JSON.parse(line);
  } catch {
    return;
  }
  const id = cmd.id ?? "x";
  switch (cmd.type) {
    case "negotiate_protocol":
      out({ id, type: "response", command: "negotiate_protocol", success: true, data: { protocolVersion: 2 } });
      break;
    case "get_state":
      out({ id, type: "response", command: "get_state", success: true, data: stateData });
      break;
    case "get_messages_page":
      out({
        id,
        type: "response",
        command: "get_messages_page",
        success: true,
        data: { messages: historyMessages(), totalMessages: historyMessages().length },
      });
      break;
    case "prompt":
      out({ id, type: "response", command: "prompt", success: true });
      runScenario(cmd.message ?? "");
      break;
    case "abort":
      out({ id, type: "response", command: "abort", success: true });
      out({ type: "agent_end", isTerminal: true, messages: [] });
      break;
    case "set_model":
      out({ id, type: "response", command: "set_model", success: true, data: {} });
      out({ type: "model_changed" });
      break;
    case "set_thinking_level":
      out({ id, type: "response", command: "set_thinking_level", success: true });
      out({ type: "thinking_level_changed", thinkingLevel: cmd.level });
      break;
    case "switch_session":
      out({ id, type: "response", command: "switch_session", success: true, data: { cancelled: false } });
      break;
    default:
      out({ type: "response", command: cmd.type ?? "parse", success: false, error: "unknown command" });
  }
}

function runScenario(message) {
  out({ type: "agent_start" });
  out({ type: "turn_start" });
  out({
    type: "message_start",
    message: { role: "user", content: [{ type: "text", text: message }] },
  });
  out({ type: "message_end", message: { role: "user", content: [{ type: "text", text: message }] } });
  // thinking 流
  out({
    type: "message_start",
    message: { role: "assistant", content: [{ type: "thinking", thinking: "" }] },
  });
  out({ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } });
  for (const w of ["简单", "任务", "，直接执行。"]) {
    out({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: w } });
  }
  out({
    type: "message_update",
    assistantMessageEvent: { type: "thinking_end", contentIndex: 0, content: "简单任务，直接执行。" },
  });
  // toolcall 流
  const args = JSON.stringify({ command: "echo hi" });
  out({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 1 } });
  for (let i = 0; i < args.length; i += 8) {
    out({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 1, delta: args.slice(i, i + 8) },
    });
  }
  out({
    type: "message_update",
    assistantMessageEvent: {
      type: "toolcall_end",
      contentIndex: 1,
      toolCall: { id: "call_00_fake1", name: "bash", arguments: { command: "echo hi" }, streamIndex: 0, intent: "执行 echo 测试" },
    },
  });
  out({
    type: "message_end",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "call_00_fake1", name: "bash", arguments: { command: "echo hi" }, streamIndex: 0, intent: "执行 echo 测试" }],
    },
  });
  out({
    type: "tool_execution_start",
    toolCallId: "call_00_fake1",
    toolName: "bash",
    args: { command: "echo hi" },
    intent: "执行 echo 测试",
  });
  if (scenario === "deny") {
    out({
      type: "extension_ui_request",
      id: "ui-fake-1",
      method: "select",
      title: "Allow tool: bash\nCommand: echo hi",
      options: ["Approve", "Deny"],
    });
    // 等待 stdin 的 extension_ui_response（15s 超时自动拒绝分支）
    const timer = setTimeout(() => finishDenied(), 15000);
    pendingDeny = timer;
    return;
  }
  out({
    type: "extension_ui_request",
    id: "ui-fake-1",
    method: "select",
    title: "Allow tool: bash\nCommand: echo hi",
    options: ["Approve", "Deny"],
  });
  const timer = setTimeout(() => finishApproved(), 15000);
  pendingApprove = timer;
}

let pendingApprove = null;
let pendingDeny = null;

// stdin 里混入 extension_ui_response 时由外层 handle 截获
const origHandle = handle;

function finishApproved() {
  out({
    type: "tool_execution_end",
    toolCallId: "call_00_fake1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "hi\n" }] },
    isError: false,
  });
  out({
    type: "message_start",
    message: { role: "toolResult", toolCallId: "call_00_fake1", toolName: "bash", content: [{ type: "text", text: "hi\n" }] },
  });
  out({
    type: "message_end",
    message: { role: "toolResult", toolCallId: "call_00_fake1", toolName: "bash", content: [{ type: "text", text: "hi\n" }] },
  });
  out({ type: "turn_end" });
  out({ type: "turn_start" });
  out({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } });
  out({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "已执行，输出 `hi`。" } });
  out({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "已执行，输出 `hi`。" }] },
  });
  out({ type: "turn_end" });
  out({ type: "agent_end", isTerminal: true, messages: [] });
}

function finishDenied() {
  out({
    type: "tool_execution_end",
    toolCallId: "call_00_fake1",
    toolName: "bash",
    result: { content: [{ type: "text", text: "Tool call denied by user: bash" }] },
    isError: true,
  });
  out({ type: "turn_end" });
  out({ type: "turn_start" });
  out({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } });
  out({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "执行被拒绝，未运行。" } });
  out({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: "执行被拒绝，未运行。" }] },
  });
  out({ type: "turn_end" });
  out({ type: "agent_end", isTerminal: true, messages: [] });
}

// 拦截审批回包：收到即按 decision 走对应分支
process.stdin.removeAllListeners("data");
let buf2 = "";
process.stdin.on("data", (d) => {
  buf2 += d;
  let idx;
  while ((idx = buf2.indexOf("\n")) >= 0) {
    const line = buf2.slice(0, idx).trim();
    buf2 = buf2.slice(idx + 1);
    if (!line) continue;
    let cmd;
    try {
      cmd = JSON.parse(line);
    } catch {
      continue;
    }
    if (cmd.type === "extension_ui_response") {
      if (pendingApprove) clearTimeout(pendingApprove);
      if (pendingDeny) clearTimeout(pendingDeny);
      if (cmd.cancelled) finishDenied();
      else finishApproved();
      continue;
    }
    origHandle(line);
  }
});

out({ type: "ready", protocolVersion: 1, supportedProtocolVersions: [1, 2], maxFrameBytes: 1048576 });

// scenario=multi：启动后额外吐一个并行双工具事件（供 M2-7）
if (scenario === "multi" || scenario === "history") {
  // history 场景不需要额外事件；multi 在 prompt 时由 runScenario 扩展（此处占位）
  void fs;
}
