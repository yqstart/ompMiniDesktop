#!/usr/bin/env node
/**
 * fake-omp：canned RPC 事件脚本，用于历史回放 / 实时全链路联调与自动化验收。
 *
 * 用法：OMP_FAKE_SCENARIO=history|approve|deny|multi|abort|ui node scripts/fake-omp.mjs
 * 场景：
 *   history  只回历史帧（列表/回放联调）
 *   approve  审批通过分支（默认场景）
 *   deny     审批拒绝分支（回 cancelled:true 走"被用户拒绝"）
 *   multi    同一条 assistant 消息里两个工具并行（一成一败），验证不串卡
 *   abort    流式中断：只吐前半段，收到 abort 才补 agent_end
 *   ui       通用 UI 请求（V2 M5）：confirm → input → editor → select，外加一条被服务端撤回的请求
 * 行协议与真实 omp --mode rpc 一致（ready/response/事件），便于 Rust pump 照单解析。
 * 自动化驱动见 scripts/e2e-rpc.mjs（`pnpm e2e:rpc`）。
 */
import fs from "node:fs";

const scenario = process.env.OMP_FAKE_SCENARIO ?? "history";
const out = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const sessionId = "01a08f64-617e-7465-acfa-ac5a6c174bf7";
const sessionFile = `/tmp/fake-agent/sessions/--fake--/2026-09-15T00-00-00-000Z_${sessionId}.jsonl`;

// 模型子集（字段照抄真实 omp get_state 的 model 对象；efforts 取自 omp models --json 实测）
const MODELS = {
  "commandcode/claude-opus-5": {
    provider: "commandcode",
    id: "claude-opus-5",
    name: "Claude Opus 5",
    reasoning: true,
    contextWindow: 1000000,
    thinking: { mode: "anthropic-adaptive", efforts: ["low", "medium", "high", "xhigh", "max"], supportsDisplay: true },
  },
  "commandcode/claude-sonnet-5": {
    provider: "commandcode",
    id: "claude-sonnet-5",
    name: "Claude Sonnet 5",
    reasoning: true,
    contextWindow: 1000000,
    thinking: { mode: "anthropic-adaptive", efforts: ["low", "medium", "high", "xhigh", "max"], supportsDisplay: true },
  },
  // 无思考模型：无 thinking 键，档位随之丢失（真实 omp 行为）
  "commandcode/claude-haiku-4-5-20251001": {
    provider: "commandcode",
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    reasoning: false,
    contextWindow: 200000,
  },
};

let modelKey = "commandcode/claude-opus-5";
let thinkingLevel = "xhigh";

/** 最近一次 prompt 带的图片数（V2 M6：验证 prompt.images 透传）。 */
let promptImageCount = 0;

function stateData() {
  const m = MODELS[modelKey];
  const d = {
    model: m,
    isStreaming: false,
    sessionFile,
    sessionId,
    messageCount: 2,
    contextUsage: { tokens: 100, contextWindow: m.contextWindow ?? 200000, percent: 0.05 },
  };
  // 实测：无思考档时 thinkingLevel 键整个缺失
  if (thinkingLevel) d.thinkingLevel = thinkingLevel;
  return d;
}

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
      out({ id, type: "response", command: "get_state", success: true, data: stateData() });
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
      promptImageCount = Array.isArray(cmd.images) ? cmd.images.length : 0;
      runScenario(cmd.message ?? "");
      break;
    case "abort":
      out({ id, type: "response", command: "abort", success: true });
      out({ type: "agent_end", isTerminal: true, messages: [] });
      break;
    case "set_model": {
      const key = `${cmd.provider}/${cmd.modelId}`;
      const m = MODELS[key];
      if (!m) {
        out({ id, type: "response", command: "set_model", success: false, error: `Model not found: ${key}` });
        break;
      }
      modelKey = key;
      // 实测：omp 切模型后不修正思考档——切到无思考模型时档位直接丢失
      if (!m.thinking) thinkingLevel = null;
      out({ id, type: "response", command: "set_model", success: true, data: m });
      out({ type: "model_changed" });
      break;
    }
    case "set_thinking_level": {
      const m = MODELS[modelKey];
      const allowed = new Set(["off", ...(m.thinking?.efforts ?? [])]);
      // 实测：非法档（不在 efforts 且非 off）同样回 success，服务端静默忽略
      if (allowed.has(cmd.level)) thinkingLevel = cmd.level;
      out({ id, type: "response", command: "set_thinking_level", success: true });
      out({ type: "thinking_level_changed", thinkingLevel: thinkingLevel ?? cmd.level });
      break;
    }
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
  // scenario=abort：流式吐一半就停，等 abort 命令（handle 的 abort 分支补 agent_end）。
  // 验证「流式中只允许停止」与「agent_end 才是完成信号」。
  if (scenario === "abort") {
    for (const w of ["这一步", "有点久", "…"]) {
      out({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: w } });
    }
    return;
  }
  // scenario=ui：通用 UI 请求全方法（V2 M5）。后续由 extension_ui_response 一步步推进
  // （见 uiAdvance），最后用一段 text 汇报收到的回包语义，供 e2e:rpc 断言。
  if (scenario === "ui") {
    uiStep = 0;
    uiLog = [];
    out({
      type: "extension_ui_request",
      id: "ui-c1",
      method: "confirm",
      title: "清理临时文件？",
      message: "将删除 /tmp/omp-fake 下的 3 个文件",
    });
    return;
  }
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
  // scenario=multi：同一条 assistant 消息里再排一个工具（read 一个不存在的文件，必然失败），
  // 两个工具并行推进：验证前端「各出一张卡、不串卡、失败红边」。多工具不触发审批。
  if (scenario === "multi") {
    out({ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 2 } });
    out({
      type: "message_update",
      assistantMessageEvent: { type: "toolcall_delta", contentIndex: 2, delta: '{"path":"/tmp/omp-missing.ts"}' },
    });
    out({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_end",
        contentIndex: 2,
        toolCall: {
          id: "call_00_fake2",
          name: "read",
          arguments: { path: "/tmp/omp-missing.ts", startLine: 1, endLine: 20 },
          streamIndex: 1,
          intent: "读取缺失文件",
        },
      },
    });
    out({
      type: "tool_execution_start",
      toolCallId: "call_00_fake2",
      toolName: "read",
      args: { path: "/tmp/omp-missing.ts" },
      intent: "读取缺失文件",
    });
    out({
      type: "tool_execution_end",
      toolCallId: "call_00_fake2",
      toolName: "read",
      result: { content: [{ type: "text", text: "ENOENT: no such file or directory" }] },
      isError: true,
    });
    out({
      type: "message_end",
      message: {
        role: "toolResult",
        toolCallId: "call_00_fake2",
        toolName: "read",
        isError: true,
        content: [{ type: "text", text: "ENOENT: no such file or directory" }],
      },
    });
  }
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

// --- scenario=ui 的状态机（V2 M5）------------------------------------------
// 每收到一个 extension_ui_response 推进一步：confirm → input → editor → select，
// 然后发一条**服务端主动撤回**的请求（omp 在请求方 abort/超时时会发 method:"cancel" + targetId）
// 与一条单向 notify，最后用 text 汇报收到的回包，供 e2e:rpc 断言回包语义。
let uiStep = 0;
let uiLog = [];

function uiAdvance(cmd) {
  if (uiStep === 0) {
    uiLog.push(`confirm=${cmd.confirmed === true}`);
    out({ type: "extension_ui_request", id: "ui-i1", method: "input", title: "新分支名？", placeholder: "feature/…" });
  } else if (uiStep === 1) {
    uiLog.push(`input=${cmd.value}`);
    out({ type: "extension_ui_request", id: "ui-e1", method: "editor", title: "提交信息", prefill: "chore: " });
  } else if (uiStep === 2) {
    uiLog.push(`editor=${String(cmd.value ?? "").replace(/\n/g, "|")}`);
    out({
      type: "extension_ui_request",
      id: "ui-s1",
      method: "select",
      title: "选一个目标分支",
      options: ["main", "release/2.0"],
    });
  } else if (uiStep === 3) {
    uiLog.push(`select=${cmd.value}`);
    out({ type: "extension_ui_request", id: "ui-x1", method: "select", title: "这条会被撤回", options: ["A", "B"] });
    out({ type: "extension_ui_request", method: "cancel", targetId: "ui-x1" });
    out({ type: "extension_ui_request", id: "ui-n1", method: "notify", message: "已收到全部输入", notifyType: "info" });
    uiFinish();
    return;
  }
  uiStep += 1;
}

function uiFinish() {
  const text = `ui-ok ${uiLog.join(" ")}`;
  out({ type: "turn_end" });
  out({ type: "turn_start" });
  out({ type: "message_start", message: { role: "assistant", content: [{ type: "text", text: "" }] } });
  out({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: text } });
  out({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } });
  out({ type: "turn_end" });
  out({ type: "agent_end", isTerminal: true, messages: [] });
}

// stdin 里混入 extension_ui_response 时由外层 handle 截获
const origHandle = handle;

function finishApproved() {
  // 图片附件回执（V2 M6）：把收到的 images 数量写进收尾文本，供 e2e:rpc 断言
  const done = promptImageCount > 0 ? `已执行，输出 \`hi\`。images=${promptImageCount}` : "已执行，输出 `hi`。";
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
  out({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: done } });
  out({
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text: done }] },
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
      if (scenario === "ui") {
        uiAdvance(cmd);
        continue;
      }
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
void fs;
