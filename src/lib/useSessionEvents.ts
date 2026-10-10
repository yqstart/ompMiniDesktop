import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { IPC } from "@shared/ipc";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import type { SessionRuntime, SessionStatus, ViewMsg } from "@shared/types";
import { summarizeArgs, mentionFilesOf, diffStatOf, TOOL_OUTPUT_FULL_MAX } from "./viewmsg";
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
    // 前缀 `u-echo-` = 「待确认的实时回显」：omp 收到 prompt 后会把用户消息回显回来，
    // 而 Composer 发送时已乐观回显过一条 `u-local-*`。mergeViewMsgs 按同文本把本地行
    // 换成这条（换 id），不翻倍——「发一次出现两条」就是这两条各渲染了一次。
    id: `u-echo-${Date.now()}`,
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
   // 流式「思考中…」：首个 delta 就按同 id 推出（mergeViewMsgs 原位覆盖）。
   // 此前只在 thinking_end 落一条完成态——思考全程界面上没有任何运行迹象。
   out.push({ kind: "thinking", id: key, text: fold.thinking, seconds: 0, complete: false });
  } else if (e.type === "thinking_end") {
   const text = e.content || fold.thinking;
   // 空思考不产块（模型只发 thinking_start/end 不带内容时，此前会留下一条
   // 「思考 · 持续了 0 秒」的空块噪声）；有内容的就地落定为完成态。
   if (text.trim()) {
    out.push({
     kind: "thinking",
     id: key,
     text,
     seconds: Math.max(0, Math.round((Date.now() - fold.startedAt) / 1000)),
     complete: true,
    });
   }
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
   // 文本块与流式路径**共用同一个 id**（`${sid}:${contentIndex}`）：
   // `message_end.message.content` 就是流里那条文本的完整版（真机 18.8.3 实测携带全文），
   // 用 `__append` 原地补全——不这么做，deltas 已渲染一遍、这里再用随机 id 推一条就双份
   // （V1–V10 的历史缺陷，恢复时修正）。
   const blocks = m.content ?? [];
   for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === "text" && b.text) {
     out.push({
      kind: "text",
      id: `${sid}:${i}`,
      seq: 0,
      text: b.text,
      complete: true,
      __append: true,
     } as IncomingViewMsg);
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
    outputFull: !isDenied && text.length > 2000 && text.length <= TOOL_OUTPUT_FULL_MAX ? text : undefined,
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
   outputFull: !denied && text.length > 2000 && text.length <= TOOL_OUTPUT_FULL_MAX ? text : undefined,
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
 // 后端已把状态收敛到 idle，此处渲染输出文本。
 // 字段名以真机为准：omp 18.2.1 发的是 `text`（`output` 是早期 canned 脚本的形状，一并兼容）。
 if (t === "command_output") {
  const text = String(
   (frame as Record<string, unknown>).text ?? (frame as Record<string, unknown>).output ?? "",
  );
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
 // 子代理帧（task 工具 spawn 的子会话；订阅在 spawn 握手时打开，见 runtime.rs）：
 // lifecycle 起止各落一行；progress / event 是高频帧（每次工具推进都会来），
 // 不逐条渲染——否则一次并行调研能刷出几十行子代理分隔线。
 if (t === "subagent_lifecycle") {
  const p = (frame.payload ?? {}) as Record<string, unknown>;
  const agent = String(p.agent ?? "").trim() || "?";
  const status = String(p.status ?? "");
  const desc = typeof p.description === "string" ? p.description.trim() : "";
  const text =
   status === "started"
    ? desc
     ? fmt(dict.dividerSubagentStartedWith, agent, desc)
     : fmt(dict.dividerSubagentStarted, agent)
    : status === "completed"
     ? fmt(dict.dividerSubagentDone, agent)
     : status === "failed"
      ? fmt(dict.dividerSubagentFailed, agent)
      : fmt(dict.dividerSubagentAborted, agent);
  // id 带 status：同一次 spawn 的 started / completed 是两条独立消息（mergeViewMsgs 按 id 去重）
  out.push({ kind: "divider", id: `sub-${String(p.id ?? "")}-${status || "unknown"}`, divider: "turn", text });
  return out;
 }
 if (t === "subagent_progress" || t === "subagent_event") return out;
 if (t === "turn_start" || t === "turn_end" || t === "agent_start" || t === "agent_end") return out;
 // 会话标题变更（TUI 侧的自动标题 / `/rename` 会写 jsonl `title_change`；rpc-ui 实测不产生，
 // 但 TUI 里改过的会话在聊天里打开时历史回放里有——实时帧同样消费，避免改名后标题陈旧）。
 // 只更新 store.sessions 里该会话的标题（备注 note 优先的口径在后端 display_title，实时帧
 // 里没有 note 上下文：已有备注的会话不覆盖备注显示——TopBar 取 title 字段，备注优先已由后端落定）。
 if (t === "title_change" && typeof frame.title === "string" && frame.title.trim()) {
  const title = (frame.title as string).trim();
  const st = useApp.getState();
  const cur = st.sessions.find((s) => s.id === sid);
  // 有备注的会话标题显示的是备注（display_title 口径），实时标题不该覆盖它
  if (cur && !cur.note?.trim()) {
   st.set({ sessions: st.sessions.map((s) => (s.id === sid ? { ...s, title } : s)) });
  }
  return out;
 }
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
  ...(Array.isArray(rt.todoPhases) && rt.todoPhases.length > 0
   ? { plansBySession: { ...s.plansBySession, [sid]: rt.todoPhases } }
   : {}),
 }));
 if (shouldSync && useApp.getState().activeSessionId === sid) {
  void api.setThinking(sid, level).catch(() => undefined);
 }
}

/**
 * 命令面刷新：只替换 `currentRuntime.commands`，别的字段原样留着
 * （`applyRuntime` 是整块覆盖，拿它更新命令面会顺手抹掉刚推来的模型 / 档位 / 用量）。
 * 运行时真值还没到位时直接丢弃——那种情况下 `syncSessionRuntime` 的补拉会带上命令面
 * （后端 `SessionMeta.commands` 早已缓存），不必在这里另存一份。
 */
function applyCommands(sid: string, raw: unknown) {
 const st = useApp.getState();
 if (st.activeSessionId !== sid || !st.currentRuntime) return;
 useApp.setState({ currentRuntime: { ...st.currentRuntime, commands: normalizeCommands(raw) } });
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

// ---------- 非活跃会话历史的内存治理（V34） ----------

/** 内存里保留最近几个「打开过」的会话的完整历史（超出即清，切回时重新拉）。 */
const KEEP_HISTORY = 3;

/** 最近激活过的会话（新的在前）——历史清理的保留名单。 */
let recentHistoryIds: string[] = [];

/** 单测隔离用：清掉 LRU 记录。 */
export function __resetHistoryLru() {
 recentHistoryIds = [];
}

/**
 * 把「非活跃会话」的历史从内存里清掉（保留最近 `keep` 个激活过的）。
 *
 * 为什么需要：`eventsBySession` 里每个**打开过**的会话都会留下全量消息（工具全量
 * 输出文本也在里面），浏览十来个长会话就是几百 MB 到 GB 级的常驻内存。
 * 清掉是安全的——切回会话时 `openSessionWithHistory` 本来就每次 `get_history`
 * 全量重拉（合并按 id 去重，空基底天然支持）。
 *
 * 正在跑 / 等审批的会话不动：它们的流还在写，用户随时可能切回去看中间态。
 */
export function trimSessionHistories(activeId: string | null, keep = KEEP_HISTORY): void {
 if (activeId) recentHistoryIds = [activeId, ...recentHistoryIds.filter((x) => x !== activeId)];
 recentHistoryIds = recentHistoryIds.slice(0, Math.max(1, keep));
 const keepSet = new Set(recentHistoryIds);
 const st = useApp.getState();
 let changed = false;
 const next: Record<string, ViewMsg[]> = {};
 for (const [sid, msgs] of Object.entries(st.eventsBySession)) {
  const running = st.statusBySession[sid]?.state;
  if (keepSet.has(sid) || running === "running" || running === "awaiting-approval") {
   next[sid] = msgs;
  } else {
   changed = true;
   folds.delete(sid);
  }
 }
 if (changed) st.set({ eventsBySession: next });
}

/**
 * 会话被归档 / 删除后清掉它的前端缓存（事件流 / 运行状态 / 计划 / 附件 / 折叠态 / LRU 名单）。
 * 清掉是安全的：会话数据的真相在 jsonl，重新打开走 `get_history`。
 * 归档 / 删除都会先把长驻进程 kill 掉（后端），前端也就没有理由再留着这些。
 */
export function forgetSession(sid: string): void {
 folds.delete(sid);
 recentHistoryIds = recentHistoryIds.filter((x) => x !== sid);
 const st = useApp.getState();
 if (
  !(sid in st.eventsBySession) &&
  !(sid in st.statusBySession) &&
  !(sid in st.plansBySession) &&
  !(sid in st.attachmentsBySession)
 ) {
  return;
 }
 const events = { ...st.eventsBySession };
 const status = { ...st.statusBySession };
 const plans = { ...st.plansBySession };
 const atts = { ...st.attachmentsBySession };
 delete events[sid];
 delete status[sid];
 delete plans[sid];
 delete atts[sid];
 st.set({ eventsBySession: events, statusBySession: status, plansBySession: plans, attachmentsBySession: atts });
}

export function useSessionEvents() {
 const { activeSessionId, set, appMode } = useApp();

 // 切去终端形态：聊天不在用，非当前会话的历史一并清掉（保留当前会话，切回来不空白）。
 // 内存治理的兜底——LRU 只按「切会话」触发，切去终端用几小时的话那几份历史会一直挂着。
 useEffect(() => {
  if (appMode !== "terminal") return;
  trimSessionHistories(useApp.getState().activeSessionId, 1);
 }, [appMode]);

 useEffect(() => {
  const sid = activeSessionId;
  if (!sid) return;
  // 内存治理：非活跃会话的历史只留最近 K 个（更早的清掉，切回时重新 get_history 拉回）
  trimSessionHistories(sid);
  let off1: (() => void) | undefined;
  let off2: (() => void) | undefined;
  let off3: (() => void) | undefined;
  // `listen` 是异步注册的：cleanup 先于注册完成时必须把「已在路上」的监听立刻解掉，
  // 否则监听器泄漏（旧会话的帧会一直写进 store）。
  let disposed = false;
  // 切会话先清运行时态，等真值回填（避免沿用上一个会话的模型/档位/用量）
  set({ currentModel: null, currentThinking: null, currentEfforts: null, currentRuntime: null });
  (async () => {
   const o1 = await listen<Record<string, unknown>>(IPC.chatEvent(sid), (e) => {
    // 命令面变化（装/卸技能与扩展时 omp 会重发）：只更新运行时真值，不进消息流。
    // 握手期那一发通常早于本订阅，所以 `syncSessionRuntime` 的补拉才是第一次到位的路径，
    // 这里管的是"会话开着时命令面又变了"。
    if (e.payload?.type === "available_commands_update") {
     applyCommands(sid, e.payload.commands);
     return;
    }
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
   if (disposed) {
    o1();
    return;
   }
   off1 = o1;
   const o2 = await listen<SessionStatus & { detail?: string }>(IPC.chatStatus(sid), (e) => {
    const st = useApp.getState();
    set({
     statusBySession: { ...st.statusBySession, [sid]: { state: e.payload.state } as SessionStatus },
    });
   });
   if (disposed) {
    o2();
    return;
   }
   off2 = o2;
   // 运行时真值：实时推送 + 订阅建立后补拉一次（spawn 握手可能早于本订阅；
   // 若本订阅早于 spawn，则由 `openSessionWithHistory` 在 open 返回后再补一次）
   const o3 = await listen<SessionRuntime>(IPC.chatRuntime(sid), (e) => applyRuntime(sid, e.payload));
   if (disposed) {
    o3();
    return;
   }
   off3 = o3;
   void syncSessionRuntime(sid);
  })();
  return () => {
   disposed = true;
   off1?.();
   off2?.();
   off3?.();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeSessionId]);
}
