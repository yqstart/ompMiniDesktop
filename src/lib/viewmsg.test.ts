import { describe, expect, it } from "vitest";
import { summarizeArgs, viewMsgFromJsonlLine } from "./viewmsg";

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
