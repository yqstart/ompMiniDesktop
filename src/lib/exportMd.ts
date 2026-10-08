import type { ViewMsg } from "@shared/types";
import { fmt, type Text } from "./locale";

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
 * - 文案取自传入的字典（导出时刻的界面语言），标签与界面同源。
 */

/** 与界面一致的截断上限（`viewmsg.ts` 的 truncate 口径）。 */
export const EXPORT_TOOL_LIMIT = 2000;

const fence = (text: string): string => {
 // 内容里出现 ``` 时用更长的围栏，避免提前闭合
 const ticks = text.includes("```") ? "````" : "```";
 return `${ticks}\n${text}\n${ticks}`;
};

function toolBlock(m: Extract<ViewMsg, { kind: "tool" }>, t: Text): string {
 const head = [m.name || "tool", m.intent, m.argsSummary].filter(Boolean).join(" · ");
 const status =
  m.state === "ok"
   ? t.toolStateOk
   : m.state === "error"
    ? t.toolStateError
    : m.state === "running"
     ? t.toolStateRunning
     : t.toolStateStreaming;
 const body = m.outputFull && m.output.length >= EXPORT_TOOL_LIMIT ? `${m.output}\n${t.mdTruncated}` : m.output;
 return [`**${head}**  \n${fmt(t.mdStatus, status)}`, body ? fence(body) : ""].filter(Boolean).join("\n\n");
}

/** 单条消息 → Markdown 片段；不产出内容的类型返回空串。 */
export function viewMsgToMarkdown(m: ViewMsg, t: Text): string {
 switch (m.kind) {
  case "user": {
   const parts: string[] = [];
   if (m.text.trim()) parts.push(m.text);
   if ((m.images?.length ?? 0) > 0) parts.push(fmt(t.mdImages, m.images!.length));
   if ((m.imagesOmitted ?? 0) > 0) parts.push(fmt(t.mdImagesOmitted, m.imagesOmitted ?? 0));
   return parts.length > 0 ? `**${t.mdYou}**\n\n${parts.join("\n\n")}` : "";
  }
  case "text":
   return m.text.trim() ? `**${t.mdAssistant}**\n\n${m.text}` : "";
  case "thinking":
   return m.text.trim()
    ? `<details><summary>${m.complete ? fmt(t.mdThinking, m.seconds) : t.mdThinkingRunning}</summary>\n\n${m.text}\n\n</details>`
    : "";
  case "tool":
   return toolBlock(m, t);
  case "files":
   return fmt(
    t.mdFiles,
    m.files
     .map(
      (f) =>
       `${f.path}${f.skippedReason
        ? fmt(t.mdFileSkipped, f.skippedReason)
        : f.lineCount != null
         ? fmt(t.mdFileLines, f.lineCount)
         : ""
       }`,
     )
     .join(t.mdFilesJoin),
   );
  case "divider":
   return `---\n\n_${m.text}_`;
  case "approval":
   return fmt(t.mdApproval, m.title.split("\n")[0]);
  case "ui":
   return fmt(t.mdUi, m.title || m.method);
  case "ui-cancel":
   return "";
  default:
   return "";
 }
}

/** 整个会话 → Markdown（标题 + 逐条消息）。空消息被跳过，不产生空段。 */
export function sessionToMarkdown(title: string, msgs: ViewMsg[], t: Text): string {
 const body = msgs
  .map((m) => viewMsgToMarkdown(m, t))
  .map((s) => s.trim())
  .filter(Boolean)
  .join("\n\n");
 const head = `# ${title.trim() || t.unnamedChat}`;
 return body ? `${head}\n\n${body}\n` : `${head}\n`;
}
