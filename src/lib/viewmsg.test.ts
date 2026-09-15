import { describe, expect, it } from "vitest";
import { summarizeArgs, viewMsgFromJsonlLine, viewMsgsFromJsonlLines } from "./viewmsg";

describe("summarizeArgs", () => {
  it("read 显示 path+行号", () => {
    expect(summarizeArgs("read", { path: "a/b.rs", startLine: 1, endLine: 120 })).toBe("a/b.rs:1-120");
  });
  it("bash 显示 command", () => {
    expect(summarizeArgs("bash", { command: "echo hi" })).toBe("echo hi");
  });
});

describe("viewMsgFromJsonlLine", () => {
  it("user 文本归一", () => {
    const msgs = viewMsgFromJsonlLine({
      type: "message",
      message: { role: "user", content: [{ type: "text", text: "hi" }] },
    });
    expect(msgs[0]).toMatchObject({ kind: "user", text: "hi" });
  });
  it("toolResult 错误态", () => {
    const msgs = viewMsgFromJsonlLine({
      type: "message",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        isError: true,
        content: [{ type: "text", text: "denied" }],
      },
    });
    expect(msgs[0]).toMatchObject({ kind: "tool", state: "error" });
  });
  it("model_change 走分隔线", () => {
    const msgs = viewMsgFromJsonlLine({ type: "model_change" });
    expect(msgs[0]).toMatchObject({ kind: "divider", divider: "model" });
  });
  it("未知 type 不崩", () => {
    expect(viewMsgFromJsonlLine({ type: "something_new" })).toEqual([]);
  });
});

describe("viewMsgsFromJsonlLines（历史批量归一）", () => {
  const callLine = {
    type: "message",
    id: "assistant-1",
    message: {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call_1",
          name: "bash",
          arguments: { command: "echo hi" },
          streamIndex: 0,
          intent: "执行 echo 测试",
        },
      ],
    },
  };
  const startLine = {
    type: "custom",
    id: "start-1",
    customType: "tool_execution_start",
    data: { toolCallId: "call_1", toolName: "bash", args: {}, intent: "执行 echo 测试" },
  };
  const resultLine = {
    type: "message",
    id: "result-1",
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      isError: false,
      content: [{ type: "text", text: "hi\n" }],
    },
  };

  it("已完成工具只出一卡且终态 ok（含意图与参数）", () => {
    const msgs = viewMsgsFromJsonlLines([callLine, startLine, resultLine]);
    const tools = msgs.filter((m) => m.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      id: "tool:call_1",
      toolCallId: "call_1",
      name: "bash",
      intent: "执行 echo 测试",
      argsSummary: "echo hi",
      state: "ok",
      output: "hi\n",
    });
  });

  it("未完成工具才 running（无结果行）", () => {
    const msgs = viewMsgsFromJsonlLines([callLine, startLine]);
    const tools = msgs.filter((m) => m.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ state: "running", output: "" });
  });

  it("失败结果归一为 error", () => {
    const msgs = viewMsgsFromJsonlLines([
      callLine,
      startLine,
      {
        type: "message",
        id: "result-err",
        message: {
          role: "toolResult",
          toolCallId: "call_1",
          toolName: "bash",
          isError: true,
          content: [{ type: "text", text: "Tool call denied by user: bash" }],
        },
      },
    ]);
    const tools = msgs.filter((m) => m.kind === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ state: "error" });
  });

  it("同行多 toolCall 各出一卡", () => {
    const msgs = viewMsgsFromJsonlLines([
      {
        type: "message",
        id: "assistant-multi",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "c-a", name: "read", arguments: { path: "a.ts" }, streamIndex: 0 },
            { type: "toolCall", id: "c-b", name: "bash", arguments: { command: "ls" }, streamIndex: 1 },
          ],
        },
      },
      {
        type: "message",
        id: "r-a",
        message: { role: "toolResult", toolCallId: "c-a", toolName: "read", isError: false, content: [{ type: "text", text: "ok" }] },
      },
      {
        type: "message",
        id: "r-b",
        message: { role: "toolResult", toolCallId: "c-b", toolName: "bash", isError: false, content: [{ type: "text", text: "ok" }] },
      },
    ]);
    const tools = msgs.filter((m) => m.kind === "tool");
    expect(tools.map((t) => (t.kind === "tool" ? t.toolCallId : ""))).toEqual(["c-a", "c-b"]);
    expect(tools.every((t) => t.kind === "tool" && t.state === "ok")).toBe(true);
  });

  it("id 稳定：重复归一可去重", () => {
    const a = viewMsgsFromJsonlLines([callLine, startLine, resultLine]);
    const b = viewMsgsFromJsonlLines([callLine, startLine, resultLine]);
    expect(a.map((m) => m.id)).toEqual(b.map((m) => m.id));
  });
});
