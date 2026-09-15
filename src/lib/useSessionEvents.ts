import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { IPC } from "@shared/ipc";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import type { SessionRuntime, SessionStatus, ViewMsg } from "@shared/types";
import { summarizeArgs } from "./viewmsg";
import { resolveThinking } from "./thinking";
import { mergeViewMsgs, type IncomingViewMsg } from "./mergeEvents";

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

/**
 * 工具卡 id：一次调用的所有阶段（toolcall_end / tool_execution_start / _end /
 * message{toolResult}）共用一个，配合 mergeViewMsgs 的原位覆盖，
 * 保证「输入中 → 运行中 → 成功/失败」始终是同一张卡。
 * 无 toolCallId 的异常帧才退回时间戳兜底 id（宁可多一张卡也不能串卡）。
 */
const toolCardId = (toolCallId: string): string =>
  toolCallId ? `tool:${toolCallId}` : `tool-anon-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** 已经告警过的未知帧类型（每类只提示一次，避免日志被同一帧刷屏）。 */
const unknownFrameTypes = new Set<string>();

const folds = new Map<string, Fold>();
/** 单测隔离用：清掉按会话累积的流式折叠态。 */
export function __resetFolds() {
  folds.clear();
}
const getFold = (sid: string): Fold => {
  let f = folds.get(sid);
  if (!f) {
    f = { textId: null, text: "", thinkingId: null, thinking: "", toolArgs: {}, toolMeta: {}, startedAt: Date.now() };
    folds.set(sid, f);
  }
  return f;
};

/** 导出供单测回放真实事件序列（不涉及 tauri 副作用）。 */
export function frameToViewMsgs(sid: string, frame: Record<string, unknown>): ViewMsg[] {
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
      // 卡 id 换成 toolCallId 版本（与历史回放 `viewMsgsFromJsonlLines` 的 `tool:<id>` 对齐），
      // 同时把之前按 contentIndex 建的"输入中"占位卡原位替换掉，避免一次调用两张卡。
      out.push({
        kind: "tool",
        id: tc.id ? `tool:${tc.id}` : key,
        toolCallId: tc.id ?? "",
        name: tc.name ?? "tool",
        intent: tc.intent ?? "",
        argsSummary: summarizeArgs(tc.name ?? "tool", args),
        state: "running",
        output: "",
        streamIndex: tc.streamIndex ?? 0,
        ...(tc.id ? { __replaceId: key } : {}),
      } as IncomingViewMsg);
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
      const isError = (frame.message as { isError?: boolean }).isError === true;
      const tcId = (frame.message as { toolCallId?: string }).toolCallId ?? "";
      out.push({
        kind: "tool",
        // 与 toolcall_end / tool_execution_* 共用一个 id：同一次调用只有一张卡，
        // 终态就地覆盖（早前那张 running 卡不会残留成"永远转圈"）。
        id: toolCardId(tcId),
        toolCallId: tcId,
        name: (frame.message as { toolName?: string }).toolName ?? "tool",
        intent: "",
        argsSummary: "",
        // 拒绝分支统一渲染成「被用户拒绝」（omp 回的是英文 "Tool call denied by user: xxx"）
        state: isDenied || isError ? "error" : "ok",
        output: isDenied ? "被用户拒绝" : text.length > 2000 ? text.slice(0, 2000) : text,
        outputFull: !isDenied && text.length > 2000 ? text : undefined,
        streamIndex: 0,
      });
    }
    return out;
  }
  if (t === "tool_execution_start") {
    const meta = fold.toolMeta[String(frame.toolCallId ?? "")];
    out.push({
      kind: "tool",
      id: toolCardId(String(frame.toolCallId ?? "")),
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
      id: toolCardId(String(frame.toolCallId ?? "")),
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
  // 其余未知帧：忽略不崩，但每个类型只告警一次（M4 协议漂移 guard——
  // omp 大版本升级后事件名对不上时，日志里能直接看出来是哪一类帧变了）。
  if (!unknownFrameTypes.has(t)) {
    unknownFrameTypes.add(t);
    console.warn(`[omp] 未知事件类型（已忽略，仅提示一次）：${t}`, frame);
  }
  return out;
}

/**
 * 把 omp 回读的运行时真值落到 store：模型 + 思考档。
 * 档位非法/缺失（实测量产场景：切到无思考模型会丢掉档位）→ 归一到该模型最高档并下发纠正。
 */
function applyRuntime(sid: string, rt: SessionRuntime) {
  const efforts = rt.efforts ?? null;
  const { level, shouldSync } = resolveThinking(efforts, rt.thinkingLevel);
  useApp.setState({
    currentEfforts: efforts,
    currentRuntime: rt,
    ...(rt.model ? { currentModel: `${rt.model.provider}/${rt.model.id}` } : {}),
    currentThinking: level,
  });
  if (shouldSync && useApp.getState().activeSessionId === sid) {
    void api.setThinking(sid, level).catch(() => undefined);
  }
}

export function useSessionEvents() {
  const { activeSessionId, set } = useApp();
  const sidRef = useRef(activeSessionId);

  useEffect(() => {
    // ref 只在 effect 里更新（render 期写 ref 会触发 react-hooks/refs）
    sidRef.current = activeSessionId;
    const sid = activeSessionId;
    if (!sid) return;
    let off1: (() => void) | undefined;
    let off2: (() => void) | undefined;
    let off3: (() => void) | undefined;
    // 切会话先清运行时态，等真值回填（避免沿用上一个会话的模型/档位/用量）
    set({ currentModel: null, currentThinking: null, currentEfforts: null, currentRuntime: null });
    (async () => {
      off1 = await listen<Record<string, unknown>>(IPC.sessionEvent(sid), (e) => {
        const msgs = frameToViewMsgs(sid, e.payload) as IncomingViewMsg[];
        if (msgs.length > 0) {
          // 统一走 mergeViewMsgs：text 流式同 id 覆盖、工具卡同 id 原位合并，
          // 避免一次工具调用渲染成多张卡（"已完成工具仍转圈"的直播版）。
          const st = useApp.getState();
          const cur = st.eventsBySession[sid] ?? [];
          st.set({ eventsBySession: { ...st.eventsBySession, [sid]: mergeViewMsgs(cur, msgs) } });
        }
      });
      off2 = await listen<SessionStatus & { detail?: string }>(IPC.sessionStatus(sid), (e) => {
        const st = useApp.getState();
        set({
          statusBySession: { ...st.statusBySession, [sid]: { state: e.payload.state } as SessionStatus },
        });
      });
      // 运行时真值：实时推送 + 订阅建立后补拉一次（spawn 握手可能早于本订阅）
      off3 = await listen<SessionRuntime>(IPC.sessionRuntime(sid), (e) => applyRuntime(sid, e.payload));
      void api
        .getSessionRuntime(sid)
        .then((rt) => {
          if (rt && sidRef.current === sid) applyRuntime(sid, rt);
        })
        .catch(() => undefined);
    })();
    return () => {
      off1?.();
      off2?.();
      off3?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId]);
}
