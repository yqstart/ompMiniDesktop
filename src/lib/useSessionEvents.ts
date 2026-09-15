import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { IPC } from "@shared/ipc";
import { useApp } from "../stores/app";
import type { SessionStatus, ViewMsg } from "@shared/types";
import { summarizeArgs } from "./viewmsg";

/**
 * 把后端转发的 omp 事件归一为 ViewMsg。
 * 历史（get_history 原始块）与实时流共用 viewMsgFromJsonlLine 语义，
 * 此处只处理实时帧的增量形态（message_update 三类 delta 等）。
 */
type Fold = {
  textId: string | null;
  text: string;
  thinkingId: string | null;
  thinking: string;
  toolArgs: Record<string, string>;
  toolMeta: Record<string, { name: string; intent: string; streamIndex: number }>;
  startedAt: number;
};

const folds = new Map<string, Fold>();
const getFold = (sid: string): Fold => {
  let f = folds.get(sid);
  if (!f) {
    f = { textId: null, text: "", thinkingId: null, thinking: "", toolArgs: {}, toolMeta: {}, startedAt: Date.now() };
    folds.set(sid, f);
  }
  return f;
};

function frameToViewMsgs(sid: string, frame: Record<string, unknown>): ViewMsg[] {
  const t = frame.type as string;
  const fold = getFold(sid);
  const out: ViewMsg[] = [];
  if (t === "message_start") {
    const m = frame.message as { role?: string; content?: { type?: string; text?: string }[] };
    if (m?.role === "user") {
      const text = (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      out.push({ kind: "user", id: `u-${Date.now()}`, text, mentions: [] });
    }
    return out;
  }
  if (t === "message_update") {
    const e = frame.assistantMessageEvent as { type?: string; contentIndex?: number; delta?: string; content?: string; toolCall?: { id?: string; name?: string; arguments?: Record<string, unknown>; streamIndex?: number; intent?: string } };
    if (!e) return out;
    const key = `${sid}:${e.contentIndex ?? 0}`;
    if (e.type === "text_start") {
      fold.textId = key;
      fold.text = "";
      out.push({ kind: "text", id: key, seq: 0, text: "", complete: false });
    } else if (e.type === "text_delta") {
      fold.text += e.delta ?? "";
      out.push({ kind: "text", id: key, seq: 0, text: fold.text, complete: false, __append: true } as ViewMsg);
    } else if (e.type === "thinking_start") {
      fold.thinkingId = key;
      fold.thinking = "";
      fold.startedAt = Date.now();
    } else if (e.type === "thinking_delta") {
      fold.thinking += e.delta ?? "";
    } else if (e.type === "thinking_end") {
      out.push({
        kind: "thinking",
        id: key,
        text: e.content ?? fold.thinking,
        seconds: Math.max(0, Math.round((Date.now() - fold.startedAt) / 1000)),
        complete: true,
      });
      fold.thinking = "";
      fold.thinkingId = null;
    } else if (e.type === "toolcall_start") {
      fold.toolArgs[key] = "";
    } else if (e.type === "toolcall_delta") {
      fold.toolArgs[key] = (fold.toolArgs[key] ?? "") + (e.delta ?? "");
      out.push({
        kind: "tool",
        id: key,
        toolCallId: "",
        name: "tool",
        intent: "",
        argsSummary: "输入中…",
        state: "streaming",
        output: "",
        streamIndex: e.contentIndex ?? 0,
      });
    } else if (e.type === "toolcall_end" && e.toolCall) {
      const tc = e.toolCall;
      const args = (tc.arguments ?? {}) as Record<string, unknown>;
      fold.toolMeta[tc.id ?? key] = {
        name: tc.name ?? "tool",
        intent: tc.intent ?? "",
        streamIndex: tc.streamIndex ?? 0,
      };
      out.push({
        kind: "tool",
        id: key,
        toolCallId: tc.id ?? "",
        name: tc.name ?? "tool",
        intent: tc.intent ?? "",
        argsSummary: summarizeArgs(tc.name ?? "tool", args),
        state: "running",
        output: "",
        streamIndex: tc.streamIndex ?? 0,
      });
    }
    return out;
  }
  if (t === "message_end") {
    const m = frame.message as { role?: string; content?: { type?: string; text?: string; thinking?: string }[] };
    if (m?.role === "assistant") {
      for (const b of m.content ?? []) {
        if (b.type === "text" && b.text) {
          out.push({ kind: "text", id: `t-${Date.now()}-${Math.random().toString(36).slice(2)}`, seq: 0, text: b.text, complete: true });
        }
      }
    }
    if (m?.role === "toolResult") {
      const text = (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
      const isDenied = text.includes("denied by user");
      out.push({
        kind: "tool",
        id: `tr-${Date.now()}`,
        toolCallId: (frame.message as { toolCallId?: string }).toolCallId ?? "",
        name: (frame.message as { toolName?: string }).toolName ?? "tool",
        intent: "",
        argsSummary: "",
        state: isDenied ? "error" : "ok",
        output: text.length > 2000 ? text.slice(0, 2000) : text,
        outputFull: text.length > 2000 ? text : undefined,
        streamIndex: 0,
      });
    }
    return out;
  }
  if (t === "tool_execution_start") {
    const meta = fold.toolMeta[String(frame.toolCallId ?? "")];
    out.push({
      kind: "tool",
      id: `tool-${String(frame.toolCallId)}`,
      toolCallId: String(frame.toolCallId ?? ""),
      name: String(frame.toolName ?? meta?.name ?? "tool"),
      intent: String(frame.intent ?? meta?.intent ?? ""),
      argsSummary: summarizeArgs(
        String(frame.toolName ?? "tool"),
        (frame.args as Record<string, unknown>) ?? {},
      ),
      state: "running",
      output: "",
      streamIndex: meta?.streamIndex ?? 0,
    });
    return out;
  }
  if (t === "tool_execution_end") {
    const result = frame.result as { content?: { type?: string; text?: string }[] };
    const text = (result?.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
    const denied = text.includes("denied by user");
    out.push({
      kind: "tool",
      id: `tool-${String(frame.toolCallId)}`,
      toolCallId: String(frame.toolCallId ?? ""),
      name: String(frame.toolName ?? "tool"),
      intent: "",
      argsSummary: "",
      state: frame.isError || denied ? "error" : "ok",
      output: denied ? "被用户拒绝" : text.length > 2000 ? text.slice(0, 2000) : text,
      outputFull: !denied && text.length > 2000 ? text : undefined,
      streamIndex: 0,
    });
    return out;
  }
  if (t === "extension_ui_request") {
    const method = frame.method as string;
    if (method === "select" || method === "confirm") {
      out.push({
        kind: "approval",
        id: `ap-${String(frame.id)}`,
        uiId: String(frame.id),
        toolName: "",
        command: "",
        cwd: "",
        title: String(frame.title ?? "需要你的确认"),
      });
    }
    return out;
  }
  if (t === "model_changed" || t === "thinking_level_changed") {
    out.push({
      kind: "divider",
      id: `d-${Date.now()}`,
      divider: t === "model_changed" ? "model" : "thinking",
      text: t === "model_changed" ? "已切换模型" : `思考等级已设为 ${String(frame.thinkingLevel ?? "")}`,
    });
    return out;
  }
  if (t === "response") {
    const cmd = frame.command as string;
    if (frame.success === false) {
      out.push({ kind: "divider", id: `e-${Date.now()}`, divider: "exit", text: `操作失败（${cmd}）：${String(frame.error ?? "")}` });
    }
    return out;
  }
  if (t === "turn_start" || t === "turn_end" || t === "agent_start" || t === "agent_end") return out;
  // 其余未知帧：忽略不崩（历史归一入口只处理文件行，实时未知帧由 Rust 透传日志）
  return out;
}

export function useSessionEvents() {
  const { activeSessionId, appendEvents, set } = useApp();
  const sidRef = useRef(activeSessionId);
  sidRef.current = activeSessionId;

  useEffect(() => {
    const sid = sidRef.current;
    if (!sid) return;
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    (async () => {
      off1 = await listen<Record<string, unknown>>(IPC.sessionEvent(sid), (e) => {
        const msgs = frameToViewMsgs(sid, e.payload);
        if (msgs.length > 0) {
          // text streaming：同 id 追加而非新增（30ms 节流在渲染层做，此处合并）
          const st = useApp.getState();
          const cur = st.eventsBySession[sid] ?? [];
          const merged: ViewMsg[] = [];
          for (const m of msgs) {
            if ((m as { __append?: boolean }).__append && m.kind === "text") {
              const idx = cur.concat(merged).findIndex((x) => x.kind === "text" && x.id === m.id && !x.complete);
              if (idx >= 0) {
                const copy = [...cur, ...merged] as ViewMsg[];
                copy[idx] = m;
                st.set({ eventsBySession: { ...st.eventsBySession, [sid]: copy } });
                continue;
              }
              const { __append, ...rest } = m as ViewMsg & { __append?: boolean };
              merged.push(rest);
            } else {
              merged.push(m);
            }
          }
          if (merged.length > 0) appendEvents(sid, merged);
        }
      });
      off2 = await listen<SessionStatus & { detail?: string }>(IPC.sessionStatus(sid), (e) => {
        const st = useApp.getState();
        set({
          statusBySession: { ...st.statusBySession, [sid]: { state: e.payload.state } as SessionStatus },
        });
      });
    })();
    return () => {
      off1?.();
      off2?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);
}
