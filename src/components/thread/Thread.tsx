import { memo, useEffect, useLayoutEffect, useRef } from "react";
import { THREAD_PAGE, useApp } from "../../stores/app";
import { api } from "@shared/api";
import type { ViewMsg } from "@shared/types";
import { ToolCard } from "./ToolCard";
import { ApprovalCard } from "./ApprovalCard";
import { UiRequestCard } from "./UiRequestCard";
import { MentionChips } from "./MentionChips";
import { AssistantText } from "./AssistantText";
import { EmptyState } from "../sidebar/EmptyState";

export function Thread() {
  const { projects, activeSessionId, eventsBySession, threadLimitSid, threadLimit, growThreadLimit } =
    useApp();
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
      aria-label="会话消息"
    >
      {hidden > 0 && (
        <div className="mb-4 flex justify-center">
          <button
            onClick={loadEarlier}
            className="cursor-pointer rounded-full border border-border/70 px-3 py-1 text-xs text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground"
            aria-label={`加载更早的 ${Math.min(hidden, THREAD_PAGE)} 条消息`}
          >
            加载更早的 {Math.min(hidden, THREAD_PAGE)} 条（还有 {hidden} 条）
          </button>
        </div>
      )}
      {shown.map((m) => (
        <ThreadRow key={m.id} m={m} sessionId={activeSessionId} />
      ))}
    </div>
  );
}

/**
 * 单条消息行（V2 M8）。
 *
 * 为什么必须 memo：流式输出每个 delta 都会更新 store，整列如果跟着重渲染，
 * 展开到几百上千条时每次 token 都要重算所有 Markdown / 工具卡。
 * `mergeViewMsgs` 只替换发生变化的那条消息、其余保持**同一对象引用**，
 * 所以浅比较即能让"只有正在流式的那一行"重渲染。
 */
const ThreadRow = memo(function ThreadRow({ m, sessionId }: { m: ViewMsg; sessionId: string | null }) {
  return (
    <div className="mb-5 text-sm leading-7">
      {m.kind === "user" && (
        <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-surface px-3.5 py-2 shadow-[inset_0_0_0_1px_var(--color-border)]">
          {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
          {(m.images?.length ?? 0) > 0 && (
            <div className={`flex flex-wrap gap-2 ${m.text ? "mt-2" : ""}`}>
              {m.images?.map((img, i) => (
                <img
                  key={i}
                  src={`data:${img.mimeType};base64,${img.data}`}
                  alt={`图片 ${i + 1}`}
                  className="max-h-64 max-w-[240px] rounded-lg border border-border/70 object-contain"
                />
              ))}
            </div>
          )}
          {(m.imagesOmitted ?? 0) > 0 && (
            <div className="mt-1.5 text-xs text-muted">
              {m.imagesOmitted} 张图片因体积过大未在回放中展开
            </div>
          )}
        </div>
      )}
      {m.kind === "text" && <AssistantText text={m.text} complete={m.complete} />}
      {m.kind === "thinking" && (
        <details className="rounded-xl border border-border/70 bg-surface/60 px-3 py-2 text-sm text-muted">
          <summary className="cursor-pointer transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden">
            {m.complete ? `已思考 ${m.seconds} 秒` : "思考中…"}
          </summary>
          <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
        </details>
      )}
      {m.kind === "tool" && <ToolCard m={m} />}
      {m.kind === "approval" && sessionId && <ApprovalCard m={m} sessionId={sessionId} />}
      {m.kind === "ui" && sessionId && <UiRequestCard m={m} sessionId={sessionId} />}
      {m.kind === "files" && <MentionChips m={m} />}
      {m.kind === "ui-cancel" && null}
      {m.kind === "divider" && (
        <div className="flex items-center gap-3 py-1">
          <span className="h-px flex-1 bg-border/60" aria-hidden />
          <span className="text-xs text-muted">{m.text}</span>
          <span className="h-px flex-1 bg-border/60" aria-hidden />
        </div>
      )}
    </div>
  );
});

export function SessionActions() {
  const { activeSessionId } = useApp();
  if (!activeSessionId) return null;
  return (
    <button
      onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
      className="cursor-pointer text-xs text-muted hover:text-foreground"
      aria-label="停止"
    >
      停止
    </button>
  );
}
