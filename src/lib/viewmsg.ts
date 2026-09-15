import type { ViewMsg } from "@shared/types";

let seq = 0;
const nid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

function truncate(text: string, limit = 2000): { out: string; full?: string } {
  if (text.length <= limit) return { out: text };
  return { out: text.slice(0, limit), full: text };
}

/** 按工具名定制参数摘要行（docs/v1-design.md §8.3）。 */
export function summarizeArgs(name: string, args: Record<string, unknown>): string {
  const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
  switch (name) {
    case "read":
    case "write":
    case "edit": {
      const path = s(args.path ?? args.file ?? args.target);
      const range =
        args.startLine != null || args.endLine != null
          ? `:${s(args.startLine ?? 1)}-${s(args.endLine ?? "")}`
          : typeof args.lines === "string"
            ? `:${args.lines}`
            : "";
      return `${path}${range}`.trim() || "(无参数)";
    }
    case "bash":
      return s(args.command ?? args.cmd ?? "").trim() || "(无命令)";
    case "grep":
    case "glob":
      return [s(args.pattern ?? args.query ?? ""), s(args.path ?? args.dir ?? "")]
        .filter(Boolean)
        .join(" · ");
    default: {
      try {
        const line = JSON.stringify(args);
        return line.length > 120 ? `${line.slice(0, 120)}…` : line;
      } catch {
        return "(无参数)";
      }
    }
  }
}

/**
 * 把 jsonl 文件的一行（message/custom/title_change 等）归一为 ViewMsg。
 * 历史回放与实时流共用此归一语义；未知 type 返回 null（调用方记日志不崩）。
 */
export function viewMsgFromJsonlLine(line: unknown): ViewMsg[] {
  if (!line || typeof line !== "object") return [];
  const o = line as Record<string, unknown>;
  const type = o.type as string | undefined;
  if (type === "message") {
    const m = o.message as { role?: string; content?: unknown[] } | undefined;
    if (!m || !Array.isArray(m.content)) return [];
    const out: ViewMsg[] = [];
    for (const b of m.content as Record<string, unknown>[]) {
      if (b.type === "text") {
        if (m.role === "user") {
          out.push({ kind: "user", id: nid("u"), text: String(b.text ?? ""), mentions: [] });
        } else {
          out.push({
            kind: "text",
            id: nid("t"),
            seq: seq++,
            text: String(b.text ?? ""),
            complete: true,
          });
        }
      } else if (b.type === "thinking") {
        out.push({ kind: "thinking", id: nid("th"), text: String(b.thinking ?? ""), seconds: 0, complete: true });
      } else if (b.type === "toolCall") {
        const args =
          b.arguments && typeof b.arguments === "object"
            ? (b.arguments as Record<string, unknown>)
            : {};
        out.push({
          kind: "tool",
          id: nid("tool"),
          toolCallId: String(b.id ?? ""),
          name: String(b.name ?? "tool"),
          intent: String((b as Record<string, unknown>).intent ?? ""),
          argsSummary: summarizeArgs(String(b.name ?? "tool"), args),
          state: "running",
          output: "",
          streamIndex: typeof b.streamIndex === "number" ? b.streamIndex : 0,
        });
      }
    }
    if (m.role === "toolResult") {
      const text = (m.content as Record<string, unknown>[])
        .filter((b) => b.type === "text")
        .map((b) => String(b.text ?? ""))
        .join("\n");
      const { out, full } = truncate(text);
      return [
        {
          kind: "tool",
          id: nid("tool"),
          toolCallId: String((m as Record<string, unknown>).toolCallId ?? ""),
          name: String((m as Record<string, unknown>).toolName ?? "tool"),
          intent: "",
          argsSummary: "",
          state: (m as Record<string, unknown>).isError ? "error" : "ok",
          output: out,
          outputFull: full,
          streamIndex: 0,
        },
      ];
    }
    return out;
  }
  if (type === "custom") {
    const data = o.data as Record<string, unknown> | undefined;
    if ((o.customType === "tool_execution_start" || o.customType === "tool_execution_end") && data) {
      const result = data.result as Record<string, unknown> | undefined;
      const text = result
        ? (Array.isArray(result.content) ? result.content : [])
            .filter((b): b is Record<string, unknown> => !!b && typeof b === "object" && (b as Record<string, unknown>).type === "text")
            .map((b) => String(b.text ?? ""))
            .join("\n")
        : "";
      const { out, full } = truncate(text);
      return [
        {
          kind: "tool",
          id: nid("tool"),
          toolCallId: String(data.toolCallId ?? ""),
          name: String(data.toolName ?? "tool"),
          intent: String(data.intent ?? ""),
          argsSummary: summarizeArgs(
            String(data.toolName ?? "tool"),
            (data.args as Record<string, unknown>) ?? {},
          ),
          state:
            o.customType === "tool_execution_end"
              ? data.isError
                ? "error"
                : "ok"
              : "running",
          output: out,
          outputFull: full,
          streamIndex: 0,
        },
      ];
    }
    return [];
  }
  if (type === "title_change" || type === "model_change" || type === "thinking_level_change") {
    const label =
      type === "model_change"
        ? `已切换模型`
        : type === "thinking_level_change"
          ? `思考等级已设为 ${String((o as Record<string, unknown>).thinkingLevel ?? "")}`
          : `标题：${String((o as Record<string, unknown>).title ?? "")}`;
    return [
      {
        kind: "divider",
        id: nid("d"),
        divider: type === "model_change" ? "model" : type === "thinking_level_change" ? "thinking" : "title",
        text: label,
      },
    ];
  }
  return [];
}
