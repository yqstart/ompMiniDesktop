import type { DiffStat, MentionFile, ViewMsg } from "@shared/types";
import { imagesFromContent } from "./attachments";
import { fmt, type Text } from "./locale";

let seq = 0;
const nid = (p: string) => `${p}-${Date.now().toString(36)}-${seq++}`;

function truncate(text: string, limit = 2000): { out: string; full?: string } {
 if (text.length <= limit) return { out: text };
 return { out: text.slice(0, limit), full: text };
}

/**
 * `fileMention` 消息 → 文件芯片数据（V2 M6b）。
 * omp 侧形状：`{role:"fileMention", files:[{path, content, lineCount, byteSize?, skippedReason?}]}`；
 * 这里只取展示需要的字段，**不保留 content**（文件全文在 jsonl 里，不进前端内存）。
 */
export function mentionFilesOf(message: Record<string, unknown>): MentionFile[] {
 const raw = message.files;
 if (!Array.isArray(raw)) return [];
 const out: MentionFile[] = [];
 for (const f of raw) {
  if (!f || typeof f !== "object") continue;
  const o = f as Record<string, unknown>;
  const path = typeof o.path === "string" ? o.path : "";
  if (!path) continue;
  out.push({
   path,
   ...(typeof o.lineCount === "number" ? { lineCount: o.lineCount } : {}),
   ...(typeof o.byteSize === "number" ? { byteSize: o.byteSize } : {}),
   ...(typeof o.skippedReason === "string" ? { skippedReason: o.skippedReason } : {}),
  });
 }
 return out;
}

/**
 * 按工具名定制参数摘要行（docs/v1-design.md §8.3）。
 * 无参数时返回空串：占位文案（「无参数」）由渲染层按当前界面语言给，数据层不掺文案。
 */
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
   return `${path}${range}`.trim();
  }
  case "bash":
   return s(args.command ?? args.cmd ?? "").trim();
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
    return "";
   }
  }
 }
}

/**
 * 写 / 改文件的行数增量（工具行走尾的 `+N −M`）。
 *
 * 口径：`write` 的 `content` 行数记 `added`；`edit` 的 `new_string` 记 `added`、
 * `old_string` 记 `removed`（整段替换，不做逐行 diff——行级 diff 要留原文，代价不划算）。
 * 拿不到参数（streaming 占位、未知工具）返回 null，界面上就不画这两个数。
 */
export function diffStatOf(name: string, args: Record<string, unknown>): DiffStat | null {
 const str = (v: unknown) => (typeof v === "string" ? v : "");
 const lines = (s: string) => (s.length === 0 ? 0 : s.split("\n").length);
 if (name === "write") {
  const content = str(args.content ?? args.text);
  return content ? { added: lines(content), removed: 0 } : null;
 }
 if (name === "edit") {
  const oldText = str(args.old_string ?? args.oldString ?? args.old_text);
  const newText = str(args.new_string ?? args.newString ?? args.new_text);
  if (!oldText && !newText) return null;
  return { added: lines(newText), removed: lines(oldText) };
 }
 return null;
}

/**
 * 把 jsonl 文件的多行批量归一为 ViewMsg（历史回放入口）。
 *
 * 单行归一（viewMsgFromJsonlLine）无法跨行关联，是截图里
 * “已完成工具仍转圈”的根因：落盘语义是三行一体——
 * `message{assistant/toolCall}`（调）+ `custom{tool_execution_start}`（行）+
 * `message{toolResult}`（果），而落盘里没有 `tool_execution_end`。
 * 单行归一会把同一个 toolCallId 拆成“running 空卡 + ok 结果卡”两张卡，
 * 前者永远 running（转圈），后者丢了 intent/参数。
 *
 * 本函数按 toolCallId 合并：一个逻辑调用只出一张 Tool 卡，
 * 有果则终态 ok/error（含输出），无果才 running（真运行中）。
 * 所有 id 均由 jsonl 行 id / toolCallId 稳定派生（不再随机），
 * 重复打开同一会话可按 id 去重，不会叠历史。
 */
export function viewMsgsFromJsonlLines(lines: unknown[], t: Text): ViewMsg[] {
 const arr = Array.isArray(lines) ? lines : [];
 type CallMeta = { name: string; args: Record<string, unknown>; intent: string; streamIndex: number };
 type ResultMeta = { text: string; full?: string; isError: boolean };
 const calls = new Map<string, CallMeta>();
 const results = new Map<string, ResultMeta>();
 const lineIdOf = (line: unknown, fallback: string): string => {
  if (line && typeof line === "object") {
   const id = (line as Record<string, unknown>).id;
   if (typeof id === "string" && id) return id;
   if (typeof id === "number") return String(id);
  }
  return fallback;
 };

 // 第一遍：收集调用元数据与结果（结果行在文件里总在调用行之后，但先全收齐，
 // 发射时终态一次到位）。
 arr.forEach((line) => {
  if (!line || typeof line !== "object") return;
  const o = line as Record<string, unknown>;
  if (o.type === "message") {
   const m = o.message as
    | { role?: string; content?: unknown[]; toolCallId?: unknown; isError?: unknown }
    | undefined;
   if (!m) return;
   if (m.role === "assistant" && Array.isArray(m.content)) {
    for (const b of m.content as Record<string, unknown>[]) {
     if (!b || typeof b !== "object" || b.type !== "toolCall") continue;
     const id = String(b.id ?? "");
     if (!id) continue;
     const args =
      b.arguments && typeof b.arguments === "object"
       ? (b.arguments as Record<string, unknown>)
       : {};
     const prev = calls.get(id);
     calls.set(id, {
      name: String(b.name ?? prev?.name ?? "tool"),
      args: { ...(prev?.args ?? {}), ...args },
      intent: String(b.intent ?? prev?.intent ?? ""),
      streamIndex: typeof b.streamIndex === "number" ? b.streamIndex : (prev?.streamIndex ?? 0),
     });
    }
   } else if (m.role === "toolResult") {
    const id = String((m as Record<string, unknown>).toolCallId ?? "");
    if (!id) return;
    const text = Array.isArray(m.content)
     ? (m.content as Record<string, unknown>[])
      .filter((b) => b && typeof b === "object" && b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("\n")
     : "";
    const { out, full } = truncate(text);
    results.set(id, { text: out, full, isError: (m as Record<string, unknown>).isError === true });
   }
  } else if (o.type === "custom") {
   const data = o.data as Record<string, unknown> | undefined;
   if (!data) return;
   if (o.customType === "tool_execution_start") {
    const id = String(data.toolCallId ?? "");
    if (!id) return;
    const args =
     data.args && typeof data.args === "object" ? (data.args as Record<string, unknown>) : {};
    const prev = calls.get(id);
    if (!prev) {
     calls.set(id, {
      name: String(data.toolName ?? "tool"),
      args,
      intent: String(data.intent ?? ""),
      streamIndex: 0,
     });
    } else {
     // assistant 行参数更全（bash 的 command、read 的 path 都在那边），只补缺口
     calls.set(id, {
      name: prev.name !== "tool" ? prev.name : String(data.toolName ?? "tool"),
      args: { ...args, ...prev.args },
      intent: prev.intent || String(data.intent ?? ""),
      streamIndex: prev.streamIndex,
     });
    }
   } else if (o.customType === "tool_execution_end") {
    // 落盘实测没有这一行（只有 start + message toolResult），此处兼容万一有
    const id = String(data.toolCallId ?? "");
    if (!id || results.has(id)) return;
    const result = data.result as Record<string, unknown> | undefined;
    const text = result
     ? (Array.isArray(result.content) ? result.content : [])
      .filter(
       (b): b is Record<string, unknown> =>
        !!b && typeof b === "object" && (b as Record<string, unknown>).type === "text",
      )
      .map((b) => String(b.text ?? ""))
      .join("\n")
     : "";
    const { out, full } = truncate(text);
    results.set(id, { text: out, full, isError: data.isError === true });
   }
  }
 });

 // 第二遍：按文件顺序发射，一个 toolCallId 只出一卡（位置在首次调用处）
 const out: ViewMsg[] = [];
 const emittedTools = new Set<string>();
 const emitTool = (toolCallId: string) => {
  if (!toolCallId || emittedTools.has(toolCallId)) return;
  emittedTools.add(toolCallId);
  const call = calls.get(toolCallId);
  const res = results.get(toolCallId);
  const name = call?.name ?? "tool";
  const diffStat = call ? diffStatOf(name, call.args) : null;
  out.push({
   kind: "tool",
   id: `tool:${toolCallId}`,
   toolCallId,
   name,
   intent: call?.intent ?? "",
   argsSummary: call ? summarizeArgs(name, call.args) : "",
   state: res ? (res.isError ? "error" : "ok") : "running",
   output: res?.text ?? "",
   outputFull: res?.full,
   streamIndex: call?.streamIndex ?? 0,
   ...(diffStat ? { diffStat } : {}),
  });
 };

 // 会话创建时 omp 会把初始模型 / 思考档写进 jsonl（`--model` / `--thinking`），
 // 它们是"新会话的出生状态"而不是会话中切换——渲染出来就是新对话顶部凭空
 // 多一行「思考等级已设为 max」。首条用户消息之前的这类记录一律不渲染分隔线。
 let userSeen = false;

 arr.forEach((line, li) => {
  if (!line || typeof line !== "object") return;
  const o = line as Record<string, unknown>;
  const lid = lineIdOf(line, `n${li}`);
  if (o.type === "message") {
   const m = o.message as { role?: string; content?: unknown[] } | undefined;
   if (!m) return;
   if (m.role === "user") {
    const text = Array.isArray(m.content)
     ? (m.content as Record<string, unknown>[])
      .filter((b) => b && typeof b === "object" && b.type === "text")
      .map((b) => String(b.text ?? ""))
      .join("\n")
     : "";
    // 图片块（V2 M6）：用户随消息发出的图，渲染在气泡里；
    // 过大的块按 imagesFromContent 的上限省略并计数，不无上限常驻内存。
    const { images, omitted } = imagesFromContent(m.content);
    userSeen = true;
    out.push({
     kind: "user",
     id: `u:${lid}`,
     text,
     mentions: [],
     ...(images.length > 0 ? { images } : {}),
     ...(omitted > 0 ? { imagesOmitted: omitted } : {}),
    });
    return;
   }
   if (m.role === "fileMention") {
    // @文件 提及（V2 M6b）：omp 把命中的文件读进上下文时落的一条消息，渲染成文件芯片
    const files = mentionFilesOf(m as Record<string, unknown>);
    if (files.length > 0) out.push({ kind: "files", id: `fm:${lid}`, files });
    return;
   }
   if (m.role === "toolResult") {
    // 结果已合并进调用处的卡；孤儿结果（调用行被截断时）才在此处补一卡
    const id = String((m as Record<string, unknown>).toolCallId ?? "");
    if (id && !emittedTools.has(id) && !calls.has(id)) emitTool(id);
    return;
   }
   if (!Array.isArray(m.content)) return;
   (m.content as Record<string, unknown>[]).forEach((b, bi) => {
    if (!b || typeof b !== "object") return;
    if (b.type === "text") {
     const t = String(b.text ?? "");
     if (!t) return;
     out.push({ kind: "text", id: `t:${lid}:${bi}`, seq: bi, text: t, complete: true });
    } else if (b.type === "thinking") {
     out.push({
      kind: "thinking",
      id: `th:${lid}:${bi}`,
      text: String(b.thinking ?? ""),
      seconds: 0,
      complete: true,
     });
    } else if (b.type === "toolCall") {
     const id = String(b.id ?? "");
     if (id) emitTool(id);
    }
   });
   return;
  }
  if (o.type === "custom") {
   // start/end 行都已合并，孤儿（调用行不在回放窗内）才补卡
   if (o.customType === "tool_execution_start" || o.customType === "tool_execution_end") {
    const data = o.data as Record<string, unknown> | undefined;
    const id = String(data?.toolCallId ?? "");
    if (id && !emittedTools.has(id) && !calls.has(id)) emitTool(id);
   }
   return;
  }
  if (o.type === "title_change" || o.type === "model_change" || o.type === "thinking_level_change") {
   if (!userSeen && o.type !== "title_change") return;
   const label =
    o.type === "model_change"
     ? t.dividerModel
     : o.type === "thinking_level_change"
      ? fmt(t.dividerThinking, String((o as Record<string, unknown>).thinkingLevel ?? ""))
      : fmt(t.dividerTitle, String((o as Record<string, unknown>).title ?? ""));
   out.push({
    kind: "divider",
    id: `d:${lid}`,
    divider: o.type === "model_change" ? "model" : o.type === "thinking_level_change" ? "thinking" : "title",
    text: label,
   });
   return;
  }
 });
 return out;
}
export function viewMsgFromJsonlLine(line: unknown, t: Text): ViewMsg[] {
 if (!line || typeof line !== "object") return [];
 const o = line as Record<string, unknown>;
 const type = o.type as string | undefined;
 if (type === "message") {
  const m = o.message as { role?: string; content?: unknown[] } | undefined;
  // fileMention 消息没有 content 数组，先于 content 检查处理
  if (m?.role === "fileMention") {
   const files = mentionFilesOf(m as unknown as Record<string, unknown>);
   return files.length > 0 ? [{ kind: "files", id: nid("fm"), files }] : [];
  }
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
   } else if (b.type === "image") {
    // 用户消息里的图片块（V2 M6）：并进同一条 user 消息的气泡
    const { images, omitted } = imagesFromContent([b]);
    const last = out[out.length - 1];
    if (last && last.kind === "user") {
     if (images.length > 0) last.images = [...(last.images ?? []), ...images];
     if (omitted > 0) last.imagesOmitted = (last.imagesOmitted ?? 0) + omitted;
    } else {
     out.push({
      kind: "user",
      id: nid("u"),
      text: "",
      mentions: [],
      ...(images.length > 0 ? { images } : {}),
      ...(omitted > 0 ? { imagesOmitted: omitted } : {}),
     });
    }
   } else if (b.type === "toolCall") {
    const args =
     b.arguments && typeof b.arguments === "object"
      ? (b.arguments as Record<string, unknown>)
      : {};
    const name = String(b.name ?? "tool");
    const diffStat = diffStatOf(name, args);
    out.push({
     kind: "tool",
     id: nid("tool"),
     toolCallId: String(b.id ?? ""),
     name,
     intent: String((b as Record<string, unknown>).intent ?? ""),
     argsSummary: summarizeArgs(name, args),
     state: "running",
     output: "",
     streamIndex: typeof b.streamIndex === "number" ? b.streamIndex : 0,
     ...(diffStat ? { diffStat } : {}),
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
   const name = String(data.toolName ?? "tool");
   const args = (data.args as Record<string, unknown>) ?? {};
   const diffStat = diffStatOf(name, args);
   return [
    {
     kind: "tool",
     id: nid("tool"),
     toolCallId: String(data.toolCallId ?? ""),
     name,
     intent: String(data.intent ?? ""),
     argsSummary: summarizeArgs(name, args),
     state:
      o.customType === "tool_execution_end"
       ? data.isError
        ? "error"
        : "ok"
       : "running",
     output: out,
     outputFull: full,
     streamIndex: 0,
     ...(diffStat ? { diffStat } : {}),
    },
   ];
  }
  return [];
 }
 if (type === "title_change" || type === "model_change" || type === "thinking_level_change") {
  const label =
   type === "model_change"
    ? t.dividerModel
    : type === "thinking_level_change"
     ? fmt(t.dividerThinking, String((o as Record<string, unknown>).thinkingLevel ?? ""))
     : fmt(t.dividerTitle, String((o as Record<string, unknown>).title ?? ""));
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
