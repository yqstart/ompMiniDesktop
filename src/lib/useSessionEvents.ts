import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { IPC } from "@shared/ipc";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import type { SessionRuntime, SessionStatus, ViewMsg } from "@shared/types";
import { summarizeArgs, mentionFilesOf, diffStatOf } from "./viewmsg";
import { fmt, TEXT, type Text } from "./locale";
import { imagesFromContent } from "./attachments";
import { normalizeCommands } from "./slashCommands";
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
export function frameToViewMsgs(sid: string, frame: Record<string, unknown>, dict: Text): ViewMsg[] {
 const t = frame.type as string;
 const fold = getFold(sid);
 const out: ViewMsg[] = [];
 if (t === "message_start" || t === "message_end") {
  const m = frame.message as { role?: string; content?: { type?: string; text?: string }[]; files?: unknown };
  // @文件 提及（V2 M6b）：omp 读进上下文的文件，渲染成一排芯片。
  // id 由文件清单决定：message_start / message_end 重复推同一条消息时只出一排芯片。
  if (m?.role === "fileMention") {
   const files = mentionFilesOf(m as unknown as Record<string, unknown>);
   if (files.length > 0 && t === "message_start") {
    out.push({ kind: "files", id: `fm:${files.map((f) => f.path).join("|")}`, files });
   }
   return out;
  }
  // message_end 还有 assistant / toolResult 两套终态处理，继续走下面的分支
  if (t === "message_start" && m?.role === "user") {
   const text = (m.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n");
   // 图片块（V2 M6）：随消息发出的图直接渲染在气泡里
   const { images, omitted } = imagesFromContent(m.content);
   out.push({
    kind: "user",
    id: `u-${Date.now()}`,
    text,
    mentions: [],
    ...(images.length > 0 ? { images } : {}),
    ...(omitted > 0 ? { imagesOmitted: omitted } : {}),
   });
   return out;
  }
  if (t === "message_start") return out;
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
    argsSummary: "",
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
   const diffStat = diffStatOf(tc.name ?? "tool", args);
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
    ...(diffStat ? { diffStat } : {}),
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
    // 拒绝分支统一渲染成 dict.toolDenied（omp 回的是英文 "Tool call denied by user: xxx"）
    state: isDenied || isError ? "error" : "ok",
    output: isDenied ? dict.toolDenied : text.length > 2000 ? text.slice(0, 2000) : text,
    outputFull: !isDenied && text.length > 2000 ? text : undefined,
    streamIndex: 0,
   });
  }
  return out;
 }
 if (t === "tool_execution_start") {
  const meta = fold.toolMeta[String(frame.toolCallId ?? "")];
  const name = String(frame.toolName ?? meta?.name ?? "tool");
  const args = (frame.args as Record<string, unknown>) ?? {};
  const diffStat = diffStatOf(name, args);
  out.push({
   kind: "tool",
   id: toolCardId(String(frame.toolCallId ?? "")),
   toolCallId: String(frame.toolCallId ?? ""),
   name,
   intent: String(frame.intent ?? meta?.intent ?? ""),
   argsSummary: summarizeArgs(name, args),
   state: "running",
   output: "",
   streamIndex: meta?.streamIndex ?? 0,
   ...(diffStat ? { diffStat } : {}),
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
   output: denied ? dict.toolDenied : text.length > 2000 ? text.slice(0, 2000) : text,
   outputFull: !denied && text.length > 2000 ? text : undefined,
   streamIndex: 0,
  });
  return out;
 }
 if (t === "extension_ui_request") {
  const method = frame.method as string;
  // 服务端撤回（请求被 abort / 超时）：撤掉卡片，别留下点不动的死卡
  if (method === "cancel") {
   const target = String(frame.targetId ?? "");
   if (target) out.push({ kind: "ui-cancel", id: `uic-${target}`, uiId: target });
   return out;
  }
  // 单向通知：不需要用户回包。notify 给一行分隔线，其余（setStatus / setWidget /
  // setTitle / set_editor_text）是宿主 UI 指令，桌面壳不实现，静默丢弃且不告警。
  if (method === "notify") {
   out.push({ kind: "divider", id: `n-${String(frame.id)}`, divider: "turn", text: String(frame.message ?? "") });
   return out;
  }
  if (method === "setStatus" || method === "setWidget" || method === "setTitle" || method === "set_editor_text") {
   return out;
  }
  const options = Array.isArray(frame.options) ? (frame.options as unknown[]).map(String) : [];
  // 审批是 select 的专用分支（options 含 Approve）：走 ApprovalCard，
  // 「总是允许」还要写会话级 yolo 意向，语义与通用 UI 回包不同。
  // options 缺失的 select 也按审批兜底（宁可让用户决定，也不静默丢一个请求）。
  if (method === "select" && (options.length === 0 || options.includes("Approve"))) {
   out.push({
    kind: "approval",
    id: `ap-${String(frame.id)}`,
    uiId: String(frame.id),
    toolName: "",
    command: "",
    cwd: "",
    title: String(frame.title ?? dict.approvalTitle),
   });
   return out;
  }
  // 其余交互方法：confirm / input / editor / 非审批 select，统一走 UiRequestCard，
  // 回包由后端 respond_ui 按方法组装（confirm 回 {confirmed}，input/editor/select 回 {value}）。
  if (method === "confirm" || method === "input" || method === "editor" || method === "select") {
   out.push({
    kind: "ui",
    id: `ui-${String(frame.id)}`,
    uiId: String(frame.id),
    method,
    title: String(frame.title ?? ""),
    ...(typeof frame.message === "string" ? { message: frame.message } : {}),
    ...(typeof frame.placeholder === "string" ? { placeholder: frame.placeholder } : {}),
    ...(typeof frame.prefill === "string" ? { prefill: frame.prefill } : {}),
    ...(options.length > 0 ? { options } : {}),
    ...(Array.isArray(frame.optionDetails) ? { optionDetails: (frame.optionDetails as unknown[]).map((d) => (typeof d === "string" ? d : null)) } : {}),
   });
  }
  return out;
 }
 if (t === "model_changed" || t === "thinking_level_changed") {
  // 口径同历史回放（viewmsg.ts 的 userSeen）：会话还没有用户消息时，模型 / 思考档变更
  // 不是「会话中切换」（切模型的档位自动跟进也走这条线），不渲染分隔线。
  const hasUser = (useApp.getState().eventsBySession[sid] ?? []).some((m) => m.kind === "user");
  if (hasUser) {
   out.push({
    kind: "divider",
    id: `d-${Date.now()}`,
    divider: t === "model_changed" ? "model" : "thinking",
    text:
     t === "model_changed"
      ? dict.dividerModel
      : fmt(dict.dividerThinking, String(frame.thinkingLevel ?? "")),
   });
  }
  return out;
 }
 if (t === "response") {
  const cmd = frame.command as string;
  if (frame.success === false) {
   out.push({ kind: "divider", id: `e-${Date.now()}`, divider: "exit", text: fmt(dict.opFailedDetail, cmd, String(frame.error ?? "")) });
  }
  return out;
 }
 // 本地命令输出（`/` 命令经 prompt 直发，无 agent turn）：
 // 后端已把状态收敛到 idle，此处只渲染输出文本。
 if (t === "command_output") {
  const text = String((frame as Record<string, unknown>).output ?? "");
  if (text) out.push({ kind: "command", id: `cmd-${String(frame.id ?? Date.now())}`, output: text });
  return out;
 }
 // 本地命令完成信号（`prompt_result{agentInvoked:false}`）：无输出就不渲染，
 // 状态机已由后端收敛，此处只消化帧、不告警。
 if (t === "prompt_result") return out;
 // 计划提醒（`todo_reminder`）：长任务的阶段清单，只读展示。
 if (t === "todo_reminder" || t === "todo_auto_clear") {
  const phases = (frame as Record<string, unknown>).phases;
  if (Array.isArray(phases) && phases.length > 0) {
   out.push({ kind: "plan", id: `plan-${String((frame as Record<string, unknown>).id ?? Date.now())}`, phases: phases as never });
  } else if (t === "todo_auto_clear") {
   out.push({ kind: "divider", id: `td-${Date.now()}`, divider: "turn", text: dict.dividerPlanCleared });
  }
  return out;
 }
 // 单向通知：`notice` 给一行分隔线。
 if (t === "notice" || t === "irc_message") {
  const text = String((frame as Record<string, unknown>).message ?? "");
  if (text) out.push({ kind: "divider", id: `n-${Date.now()}`, divider: "turn", text });
  return out;
 }
 // 压缩 / 重试 / 子代理的生命周期帧：给一行分隔线，不进消息计数。
 if (
  t === "auto_compaction_start" ||
  t === "auto_compaction_end" ||
  t === "auto_retry_start" ||
  t === "auto_retry_end" ||
  t === "retry_fallback_applied" ||
  t === "retry_fallback_succeeded"
 ) {
  const label =
   t === "auto_compaction_start"
    ? dict.dividerCompacting
    : t === "auto_compaction_end"
     ? dict.dividerCompacted
     : t === "auto_retry_start"
      ? dict.dividerRetrying
      : t === "auto_retry_end"
       ? dict.dividerRetryEnd
       : t === "retry_fallback_applied"
        ? dict.dividerFallbackRetry
        : dict.dividerFallbackOk;
  out.push({ kind: "divider", id: `${t}-${Date.now()}`, divider: "turn", text: label });
  return out;
 }
 // 子代理帧：分隔线占位（详细转录暂不展开）。
 if (t === "subagent_lifecycle" || t === "subagent_progress" || t === "subagent_event") {
  out.push({ kind: "divider", id: `${t}-${Date.now()}`, divider: "turn", text: dict.dividerSubagent });
  return out;
 }
 // 可用命令面（`available_commands_update`）：缓存供 `/` 补全，不渲染消息。
 if (t === "available_commands_update") {
  const cmds = (frame as Record<string, unknown>).commands;
  if (Array.isArray(cmds)) {
   useApp.setState((s) => ({
    commandsBySession: {
     ...s.commandsBySession,
     [sid]: normalizeCommands(cmds),
    },
   }));
  }
  return out;
 }
 if (t === "turn_start" || t === "turn_end" || t === "agent_start" || t === "agent_end") return out;
 // 单向宿主通知（握手期就会到，现在经回放正常抵达）：没有渲染面，安静忽略，
 // 不占「未知帧」告警位（那是留给真正的协议漂移的）。
 if (t === "advisor_cost_changed") return out;
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
 useApp.setState((s) => ({
  currentEfforts: efforts,
  currentRuntime: rt,
  ...(rt.model ? { currentModel: `${rt.model.provider}/${rt.model.id}` } : {}),
  currentThinking: level,
  ...(Array.isArray(rt.commands)
   ? { commandsBySession: { ...s.commandsBySession, [sid]: rt.commands } }
   : {}),
  ...(Array.isArray(rt.todoPhases) && rt.todoPhases.length > 0
   ? { plansBySession: { ...s.plansBySession, [sid]: rt.todoPhases } }
   : {}),
 }));
 if (shouldSync && useApp.getState().activeSessionId === sid) {
  void api.setThinking(sid, level).catch(() => undefined);
 }
}

/**
 * 补拉一次运行时真值（模型 / 思考档 / 上下文占用 / 命令面）。
 *
 * 两个调用点，缺一不可：订阅建立时（消除「推送早于订阅」的竞态）与 `open_session`
 * 返回之后（消除「补拉早于 spawn 完成」的竞态——resume 的长驻进程是在 open 里起的，
 * 订阅那次补拉必然拉空）。不是当前会话的包不动，避免切走之后被旧会话覆盖。
 */
export async function syncSessionRuntime(sid: string): Promise<void> {
 try {
  const rt = await api.getSessionRuntime(sid);
  if (rt && useApp.getState().activeSessionId === sid) applyRuntime(sid, rt);
 } catch {
  // 拉不到不影响阅读：会话内的推送与下一次回读会补
 }
}

export function useSessionEvents() {
 const { activeSessionId, set } = useApp();

 useEffect(() => {
  const sid = activeSessionId;
  if (!sid) return;
  let off1: (() => void) | undefined;
  let off2: (() => void) | undefined;
  let off3: (() => void) | undefined;
  // 切会话先清运行时态，等真值回填（避免沿用上一个会话的模型/档位/用量）
  set({ currentModel: null, currentThinking: null, currentEfforts: null, currentRuntime: null });
  (async () => {
   off1 = await listen<Record<string, unknown>>(IPC.sessionEvent(sid), (e) => {
    // 语言按帧到达时刻取：切语言后新帧立刻用新语言，已渲染的旧分隔线要重开会话才换
    const msgs = frameToViewMsgs(sid, e.payload, TEXT[useApp.getState().locale]) as IncomingViewMsg[];
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
   // 运行时真值：实时推送 + 订阅建立后补拉一次（spawn 握手可能早于本订阅；
   // 若本订阅早于 spawn，则由 `openSessionWithHistory` 在 open 返回后再补一次）
   off3 = await listen<SessionRuntime>(IPC.sessionRuntime(sid), (e) => applyRuntime(sid, e.payload));
   void syncSessionRuntime(sid);
  })();
  return () => {
   off1?.();
   off2?.();
   off3?.();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeSessionId]);
}
