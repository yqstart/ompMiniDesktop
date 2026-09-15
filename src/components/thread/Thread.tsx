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
    <div className="mx-auto w-full max-w-3xl flex-1 overflow-y-auto px-4 py-4" role="log" aria-label="会话消息">
      {events.map((m) => (
        <div key={m.id} className="mb-4 text-sm leading-7">
          {m.kind === "user" && (
            <div className="ml-auto w-fit max-w-full rounded bg-surface px-3 py-2">{m.text}</div>
          )}
          {m.kind === "text" && <div className="whitespace-pre-wrap">{m.text}</div>}
          {m.kind === "thinking" && (
            <details className="rounded border border-border px-3 py-2 text-muted">
              <summary className="cursor-pointer">
                {m.complete ? `已思考 ${m.seconds} 秒…` : "思考中…"}
              </summary>
              <div className="whitespace-pre-wrap">{m.text}</div>
            </details>
          )}
          {m.kind === "tool" && <ToolCard m={m} />}
          {m.kind === "approval" && activeSessionId && (
            <ApprovalCard m={m} sessionId={activeSessionId} />
          )}
          {m.kind === "divider" && (
            <div className="text-center text-xs text-muted">{m.text}</div>
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
