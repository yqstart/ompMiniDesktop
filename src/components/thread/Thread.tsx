import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { ToolCard } from "./ToolCard";
import { ApprovalCard } from "./ApprovalCard";
import { EmptyState } from "../sidebar/EmptyState";

export function Thread() {
  const { projects, activeSessionId, eventsBySession } = useApp();
  if (projects.length === 0) return <EmptyState kind="no-project" />;
  if (!activeSessionId) return <EmptyState kind="no-session" />;
  const events = eventsBySession[activeSessionId] ?? [];
  if (events.length === 0) return <EmptyState kind="no-session" />;
  return (
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-5 py-5" role="log" aria-label="会话消息">
      {events.map((m) => (
        <div key={m.id} className="mb-5 text-sm leading-7">
          {m.kind === "user" && (
            <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-surface px-3.5 py-2 shadow-[inset_0_0_0_1px_var(--color-border)]">{m.text}</div>
          )}
          {m.kind === "text" && <div className="max-w-full overflow-x-auto whitespace-pre-wrap">{m.text}</div>}
          {m.kind === "thinking" && (
            <details className="rounded-xl border border-border/70 bg-surface/60 px-3 py-2 text-[13px] text-muted">
              <summary className="cursor-pointer transition-colors duration-150 hover:text-foreground [&::-webkit-details-marker]:hidden">
                {m.complete ? `已思考 ${m.seconds} 秒` : "思考中…"}
              </summary>
              <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
            </details>
          )}
          {m.kind === "tool" && <ToolCard m={m} />}
          {m.kind === "approval" && activeSessionId && (
            <ApprovalCard m={m} sessionId={activeSessionId} />
          )}
          {m.kind === "divider" && (
            <div className="flex items-center gap-3 py-1">
              <span className="h-px flex-1 bg-border/60" aria-hidden />
              <span className="text-xs text-muted">{m.text}</span>
              <span className="h-px flex-1 bg-border/60" aria-hidden />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

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
