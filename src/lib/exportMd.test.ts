import { describe, expect, it } from "vitest";
import type { ViewMsg } from "@shared/types";
import { TEXT } from "./locale";
import { EXPORT_TOOL_LIMIT, sessionToMarkdown, viewMsgToMarkdown } from "./exportMd";

const zh = TEXT["zh-CN"];

const mk = (m: Partial<ViewMsg> & { kind: ViewMsg["kind"] }) => m as ViewMsg;

describe("viewMsgToMarkdown", () => {
  it("用户消息带图片时写明张数（不内联 base64）", () => {
    const md = viewMsgToMarkdown(
      mk({
        kind: "user",
        id: "u1",
        text: "看这张图",
        mentions: [],
        images: [{ mimeType: "image/png", data: "AAAA".repeat(100) }],
      }), zh);
    expect(md).toContain("**你**");
    expect(md).toContain("附图 1 张");
    expect(md).not.toContain("AAAA");
  });

  it("思考块包在 details 折叠里，未完成时写「思考中」", () => {
    const done = viewMsgToMarkdown(mk({ kind: "thinking", id: "t1", text: "想了想", seconds: 12, complete: true }), zh);
    expect(done).toContain("<details><summary>思考 12 秒</summary>");
    const running = viewMsgToMarkdown(mk({ kind: "thinking", id: "t2", text: "想", seconds: 0, complete: false }), zh);
    expect(running).toContain("思考中");
  });

  it("工具卡带状态、参数摘要与围栏输出；超长输出写「已截断」", () => {
    const md = viewMsgToMarkdown(
      mk({
        kind: "tool",
        id: "tool:c1",
        toolCallId: "c1",
        name: "bash",
        intent: "跑测试",
        argsSummary: "pnpm test",
        state: "ok",
        output: "x".repeat(EXPORT_TOOL_LIMIT),
        outputFull: "x".repeat(EXPORT_TOOL_LIMIT + 10),
        streamIndex: 0,
      }), zh);
    expect(md).toContain("**bash · 跑测试 · pnpm test**");
    expect(md).toContain("状态：成功");
    expect(md).toContain("（已截断）");
  });

  it("内容里出现 ``` 时用更长围栏，避免提前闭合", () => {
    const md = viewMsgToMarkdown(
      mk({
        kind: "tool",
        id: "tool:c2",
        toolCallId: "c2",
        name: "read",
        intent: "",
        argsSummary: "a.md",
        state: "ok",
        output: "```js\nconsole.log(1)\n```",
        streamIndex: 0,
      }), zh);
    expect(md).toContain("````");
  });

  it("读入上下文的文件芯片与分隔线各有对应写法", () => {
    expect(
      viewMsgToMarkdown(
        mk({ kind: "files", id: "fm1", files: [{ path: "a.ts", lineCount: 42 }, { path: "b.bin", skippedReason: "tooLarge" }] }), zh),
    ).toBe("> 读入上下文：a.ts（42 行）、b.bin（已跳过：tooLarge）");
    expect(viewMsgToMarkdown(mk({ kind: "divider", id: "d1", divider: "model", text: "已切换模型" }), zh)).toContain("_已切换模型_");
  });

  it("空内容不产生空段", () => {
    expect(viewMsgToMarkdown(mk({ kind: "text", id: "t", seq: 0, text: "   ", complete: true }), zh)).toBe("");
    expect(viewMsgToMarkdown(mk({ kind: "ui-cancel", id: "x", uiId: "u" }), zh)).toBe("");
  });
});

describe("sessionToMarkdown", () => {
  it("标题 + 逐条消息，空会话只出标题", () => {
    const md = sessionToMarkdown("缓存调优", [
      mk({ kind: "user", id: "u1", text: "怎么调", mentions: [] }),
      mk({ kind: "text", id: "t1", seq: 0, text: "先量命中率", complete: true }),
    ], zh);
    expect(md.startsWith("# 缓存调优\n\n")).toBe(true);
    expect(md).toContain("**你**\n\n怎么调");
    expect(md).toContain("**助手**\n\n先量命中率");
    expect(sessionToMarkdown("", [], zh)).toBe("# 未命名会话\n");
  });
});
