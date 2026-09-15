import type { ViewMsg } from "@shared/types";

/**
 * 会话 → Markdown（V2 M9）。
 *
 * 只做**只读导出**：拿界面上已经渲染的 ViewMsg 生成文本，复制到剪贴板由用户自己处置。
 * 不落盘、不写 omp、不加后端命令——导出内容与用户在界面上看到的一致。
 *
 * 取舍：
 * - 思考块包在 `<details>` 里（GitHub 等渲染器可折叠），不删也不喧宾夺主；
 * - 工具输出沿用界面口径截断（2000 字符），并在被截断处明写「已截断」，不假装全文；
 * - 图片只写张数（导出不内联 base64，否则一个 8MB 会话能导出成几十 MB 的 md）。
 */

/** 与界面一致的截断上限（`viewmsg.ts` 的 truncate 口径）。 */
export const EXPORT_TOOL_LIMIT = 2000;

const fence = (text: string): string => {
  // 内容里出现 ``` 时用更长的围栏，避免提前闭合
  const ticks = text.includes("```") ? "````" : "```";
  return `${ticks}\n${text}\n${ticks}`;
};

function toolBlock(m: Extract<ViewMsg, { kind: "tool" }>): string {
  const head = [m.name || "tool", m.intent, m.argsSummary].filter(Boolean).join(" · ");
  const status = m.state === "ok" ? "成功" : m.state === "error" ? "失败" : m.state === "running" ? "运行中" : "输入中";
  const body = m.outputFull && m.output.length >= EXPORT_TOOL_LIMIT ? `${m.output}\n…（已截断）` : m.output;
  return [`**${head}**  \n状态：${status}`, body ? fence(body) : ""].filter(Boolean).join("\n\n");
}

/** 单条消息 → Markdown 片段；不产出内容的类型返回空串。 */
export function viewMsgToMarkdown(m: ViewMsg): string {
  switch (m.kind) {
    case "user": {
      const parts: string[] = [];
      if (m.text.trim()) parts.push(m.text);
      if ((m.images?.length ?? 0) > 0) parts.push(`> 附图 ${m.images!.length} 张（导出不含图片数据）`);
      if ((m.imagesOmitted ?? 0) > 0) parts.push(`> 另有 ${m.imagesOmitted} 张图片因体积过大未展开`);
      return parts.length > 0 ? `**你**\n\n${parts.join("\n\n")}` : "";
    }
    case "text":
      return m.text.trim() ? `**助手**\n\n${m.text}` : "";
    case "thinking":
      return m.text.trim()
        ? `<details><summary>思考${m.complete ? ` ${m.seconds} 秒` : "中"}</summary>\n\n${m.text}\n\n</details>`
        : "";
    case "tool":
      return toolBlock(m);
    case "files":
      return `> 读入上下文：${m.files
        .map((f) => `${f.path}${f.skippedReason ? `（已跳过：${f.skippedReason}）` : f.lineCount != null ? `（${f.lineCount} 行）` : ""}`)
        .join("、")}`;
    case "divider":
      return `---\n\n_${m.text}_`;
    case "approval":
      return `> 等待审批：${m.title.split("\n")[0]}`;
    case "ui":
      return `> 等待输入：${m.title || m.method}`;
    case "ui-cancel":
      return "";
    default:
      return "";
  }
}

/** 整个会话 → Markdown（标题 + 逐条消息）。空消息被跳过，不产生空段。 */
export function sessionToMarkdown(title: string, msgs: ViewMsg[]): string {
  const body = msgs
    .map(viewMsgToMarkdown)
    .map((s) => s.trim())
    .filter(Boolean)
    .join("\n\n");
  const head = `# ${title.trim() || "未命名会话"}`;
  return body ? `${head}\n\n${body}\n` : `${head}\n`;
}
