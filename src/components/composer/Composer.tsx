import { useApp } from "../../stores/app";
import { api } from "@shared/api";

export function Composer() {
  const { activeSessionId, draftOf, setDraft, statusBySession, sessions } = useApp();
  const draft = draftOf(activeSessionId);
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
  const running = status === "running" || status === "awaiting-approval";
  const awaiting = status === "awaiting-approval";
  const archived = sessions.find((s) => s.id === activeSessionId)?.archived;

  const send = async () => {
    if (!activeSessionId || !draft.trim() || running || archived) return;
    const text = draft;
    setDraft(activeSessionId, "");
    try {
      await api.sendMessage(activeSessionId, text);
    } catch {
      setDraft(activeSessionId, text);
    }
  };

  if (archived) {
    return (
      <div className="border-t border-border bg-surface px-4 py-3 text-center text-sm text-muted">
        已归档，只读——取消归档后可继续对话
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-surface px-4 py-3">
      {awaiting && (
        <div className="mx-auto mb-2 max-w-3xl text-xs text-warn">先处理上面的审批</div>
      )}
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <label htmlFor="composer" className="sr-only">
          输入消息
        </label>
        <textarea
          id="composer"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(activeSessionId, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (running) return;
              void send();
            }
            if (e.key === "Escape" && running && activeSessionId) {
              void api.stop(activeSessionId).catch(() => undefined);
            }
          }}
          disabled={awaiting}
          placeholder={awaiting ? "先处理上面的审批" : "输入消息，Enter 发送"}
          className="max-h-40 flex-1 resize-y rounded border border-border bg-background px-3 py-2 text-sm outline-none placeholder:text-muted disabled:opacity-60"
        />
        {running ? (
          <button
            onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
            className="cursor-pointer rounded border border-border px-4 py-2 text-sm transition-colors duration-200 hover:bg-background"
            aria-label="停止"
          >
            停止
          </button>
        ) : (
          <button
            onClick={() => void send()}
            disabled={!draft.trim()}
            className="cursor-pointer rounded bg-accent px-4 py-2 text-sm text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-40"
            aria-label="发送"
          >
            发送
          </button>
        )}
      </div>
    </div>
  );
}
