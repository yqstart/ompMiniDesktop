import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Bulb, Check, CheckListSquare, ChevronRight, Copy } from "reicon-react";
import { THREAD_PAGE, useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { api } from "@shared/api";
import type { ViewMsg } from "@shared/types";
import { ToolRow } from "./ToolRow";
import { ApprovalCard } from "./ApprovalCard";
import { UiRequestCard } from "./UiRequestCard";
import { MentionChips } from "./MentionChips";
import { AssistantText } from "./AssistantText";
import { EmptyState } from "../sidebar/EmptyState";

export function Thread() {
 const { projects, activeSessionId, eventsBySession, threadLimitSid, threadLimit, growThreadLimit, sessions } =
  useApp();
 const t = useText();
 const cwd = sessions.find((s) => s.id === activeSessionId)?.cwd ?? "";
 const scroller = useRef<HTMLDivElement>(null);
 const lastCount = useRef(0);
 // 「加载更早」后要保住视口位置：记录加载前距底部的距离，插入后补回去
 const keepOffset = useRef<number | null>(null);
 const events = activeSessionId ? (eventsBySession[activeSessionId] ?? []) : [];
 // 首屏增量（MASTER §7）：只渲染最后 N 条，向上加载更多。窗口按会话重置。
 const limit = threadLimitSid === activeSessionId ? threadLimit : THREAD_PAGE;
 const hidden = Math.max(0, events.length - limit);
 const shown = hidden > 0 ? events.slice(-limit) : events;
 const loadEarlier = () => {
  const el = scroller.current;
  if (el) keepOffset.current = el.scrollHeight - el.scrollTop;
  growThreadLimit(THREAD_PAGE);
 };
 useLayoutEffect(() => {
  const el = scroller.current;
  if (el && keepOffset.current != null) {
   el.scrollTop = el.scrollHeight - keepOffset.current;
   keepOffset.current = null;
  }
 });
 // 切会话即读底：新会话消息先落位再滚到底（双 rAF 等首帧绘制完成）
 useEffect(() => {
  lastCount.current = 0;
  const raf = requestAnimationFrame(() => {
   requestAnimationFrame(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
   });
  });
  return () => cancelAnimationFrame(raf);
 }, [activeSessionId]);
 // 流式追加时跟随到底：用户已手动上翻则不抢滚动
 useEffect(() => {
  const el = scroller.current;
  if (!el) {
   lastCount.current = events.length;
   return;
  }
  if (events.length <= lastCount.current) {
   lastCount.current = events.length;
   return;
  }
  lastCount.current = events.length;
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  if (nearBottom) el.scrollTop = el.scrollHeight;
 }, [events.length]);
 if (projects.length === 0) return <EmptyState kind="no-project" />;
 if (!activeSessionId) return <EmptyState kind="no-session" />;
 if (events.length === 0) return <EmptyState kind="no-session" />;
 return (
  <div
   ref={scroller}
   onScroll={(e) => {
    // 滚到接近顶部时自动再放一页出来（配合下面的按钮，长会话不必手动点）
    const el = e.currentTarget;
    if (hidden > 0 && el.scrollTop < 24) loadEarlier();
   }}
   className="thread-scroll mx-auto w-full max-w-3xl min-h-0 flex-1 px-5 py-5"
   role="log"
   aria-label={t.threadAria}
  >
   {hidden > 0 && (
    <div className="mb-4 flex justify-center">
     <button
      onClick={loadEarlier}
      className="cursor-pointer rounded-md border border-border px-3 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      aria-label={fmt(t.loadEarlierAria, Math.min(hidden, THREAD_PAGE))}
     >
      {fmt(t.loadEarlier, Math.min(hidden, THREAD_PAGE), hidden)}
     </button>
    </div>
   )}
   {shown.map((m, i) => (
    <ThreadRow key={m.id} m={m} sessionId={activeSessionId} cwd={cwd} tight={isTrace(m) && isTrace(shown[i - 1])} />
   ))}
  </div>
 );
}

/**
 * 「执行痕迹」类消息（工具调用 / 思考）：它们在流里成串出现，行与行之间收紧间距
 * （`mb-4` → 无），读起来是一段紧凑的时间线；正文段落才用整档间距隔开。
 */
const isTrace = (m: ViewMsg | undefined): boolean =>
 !!m && (m.kind === "tool" || m.kind === "thinking");

/**
 * 单条消息行（V2 M8）。
 *
 * 为什么必须 memo：流式输出每个 delta 都会更新 store，整列如果跟着重渲染，
 * 展开到几百上千条时每次 token 都要重算所有 Markdown / 工具卡。
 * `mergeViewMsgs` 只替换发生变化的那条消息、其余保持**同一对象引用**，
 * 所以浅比较即能让"只有正在流式的那一行"重渲染。
 */
const ThreadRow = memo(function ThreadRow({
 m,
 sessionId,
 cwd,
 tight,
}: {
 m: ViewMsg;
 sessionId: string | null;
 cwd: string;
 /** 上一条也是执行痕迹：间距收紧，成串的工具行读成一段。 */
 tight?: boolean;
}) {
 const t = useText();
 return (
  <div className={`text-sm leading-[1.7] ${tight ? "mb-1" : "mb-4"}`}>
   {m.kind === "user" && (
    <div className="group/user ml-auto w-fit max-w-[85%]">
     {/* 用户气泡走 accent 稀释底：一句「这是我说的」靠底色就够，不必读文字才知道
         （右侧对齐 + 底色双信号；助手正文保持裸 Markdown 无底色，两者一眼分得开） */}
     <div className="rounded-lg rounded-br-sm border border-accent/25 bg-accent/10 px-3.5 py-2">
      {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
      {(m.images?.length ?? 0) > 0 && (
       <div className={`flex flex-wrap gap-2 ${m.text ? "mt-2" : ""}`}>
        {m.images?.map((img, i) => (
         <img
          key={i}
          src={`data:${img.mimeType};base64,${img.data}`}
          alt={fmt(t.imageAlt, i + 1)}
          className="max-h-64 max-w-[240px] rounded-lg border border-border object-contain"
         />
        ))}
       </div>
      )}
      {(m.imagesOmitted ?? 0) > 0 && (
       <div className="mt-1.5 text-[11px] text-faint">{fmt(t.imagesOmitted, m.imagesOmitted ?? 0)}</div>
      )}
     </div>
     {m.text.trim() && (
      <div className="mt-0.5 flex justify-end opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100">
       <CopyAction text={m.text} label={t.copyQuestion} />
      </div>
     )}
    </div>
   )}
   {m.kind === "text" && (
    <div className="group/msg">
     <AssistantText text={m.text} complete={m.complete} />
     {m.complete && m.text.trim() && (
      <div className="mt-0.5 flex opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
       <CopyAction text={m.text} label={t.copyReply} />
      </div>
     )}
    </div>
   )}
   {m.kind === "thinking" && (
    <details className="group/think">
     <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[13px] text-muted transition-colors duration-100 hover:bg-hover">
      {/* 思考中：灯泡走 accent 并跟着呼吸；已完成的思考退回静止的 faint（不抢正文） */}
      <Bulb
       size={13}
       className={`shrink-0 ${m.complete ? "text-faint" : "animate-pulse text-accent"}`}
       aria-hidden
      />
      {m.complete ? fmt(t.thoughtDone, m.seconds) : t.thinking}
      <ChevronRight
       size={12}
       aria-hidden
       className="shrink-0 transition-transform duration-150 group-open/think:rotate-90"
      />
     </summary>
     <div className="mt-0.5 mb-1 ml-6 max-h-80 overflow-auto border-l border-border-soft pr-1 pl-3 text-[13px] leading-6 whitespace-pre-wrap text-muted">
      {m.text}
     </div>
    </details>
   )}
   {m.kind === "tool" && <ToolRow m={m} cwd={cwd} />}
   {m.kind === "plan" && <PlanCard m={m} />}
   {m.kind === "approval" && sessionId && <ApprovalCard m={m} sessionId={sessionId} />}
   {m.kind === "ui" && sessionId && <UiRequestCard m={m} sessionId={sessionId} />}
   {m.kind === "files" && <MentionChips m={m} cwd={cwd} />}
   {m.kind === "ui-cancel" && null}
   {m.kind === "command" && (
    // 本地命令（`/` 开头）的输出：左侧 accent 竖条 + 正文色——它是用户主动要的结果，
    // 不是模型的解释，所以不给 muted（那会读起来像备注）
    <div className="rounded-md border-l-2 border-accent/40 bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
     {m.output}
    </div>
   )}
   {m.kind === "divider" && (
    <div className="flex items-center gap-3 py-1">
     <span className="h-px flex-1 bg-border-soft" aria-hidden />
     <span className="text-[11px] text-faint">{m.text}</span>
     <span className="h-px flex-1 bg-border-soft" aria-hidden />
    </div>
   )}
  </div>
 );
});

/**
 * 任务计划卡（只读）：`todoPhases` / `todo_reminder` 的阶段清单展示。
 * 状态「文字 + 颜色 + 符号」三信号（进行中 / 待办 / 完成），颜色不作唯一信号。
 */
function PlanCard({ m }: { m: Extract<ViewMsg, { kind: "plan" }> }) {
 const t = useText();
 /** 状态符号的颜色：完成 ok / 进行中 accent / 待办 faint（与状态词、符号形状并行）。 */
 const tone = (status: string) =>
  status === "completed" ? "text-ok" : status === "in_progress" ? "text-accent" : "text-faint";
 return (
  <div
   className="rounded-lg border border-border bg-surface px-3 py-2"
   role="group"
   aria-label={t.planTitle}
  >
   <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-muted">
    <CheckListSquare size={13} className="shrink-0 text-accent" aria-hidden />
    {t.planTitle}
   </div>
   <div className="space-y-1.5">
    {m.phases.map((p) => (
     <div key={p.id}>
      <div className="text-[13px] font-medium">{p.name}</div>
      <ul className="mt-0.5 space-y-0.5">
       {p.tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-1.5 text-[13px] text-muted">
         <span aria-hidden className={tone(task.status)}>
          {task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : "○"}
         </span>
         <span className={task.status === "in_progress" ? "text-foreground" : undefined}>
          {task.content}
          <span className="sr-only">
           {task.status === "completed"
            ? t.planDone
            : task.status === "in_progress"
             ? t.planInProgress
             : t.planTodo}
          </span>
         </span>
        </li>
       ))}
      </ul>
     </div>
    ))}
   </div>
  </div>
 );
}

/**
 * 单条消息的复制按钮（V2 M9）：hover 才出现，纯剪贴板、不碰 store/草稿。
 * 独立组件 + 自带 copied 状态，避免把状态提到 `ThreadRow` 里破坏行级 memo。
 */
function CopyAction({ text, label }: { text: string; label: string }) {
 const t = useText();
 const [copied, setCopied] = useState(false);
 const copy = async () => {
  try {
   await navigator.clipboard.writeText(text);
   setCopied(true);
  } catch {
   // 复制失败不打断阅读（与代码块复制同一策略）
   setCopied(false);
  }
  setTimeout(() => setCopied(false), 1200);
 };
 return (
  <button
   onClick={() => void copy()}
   className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
   aria-label={label}
   title={label}
  >
   {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
   {copied ? t.copied : t.copy}
  </button>
 );
}

export function SessionActions() {
 const { activeSessionId } = useApp();
 const t = useText();
 if (!activeSessionId) return null;
 return (
  <button
   onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
   className="cursor-pointer text-[13px] text-muted hover:text-foreground"
   aria-label={t.stop}
  >
   {t.stop}
  </button>
 );
}
