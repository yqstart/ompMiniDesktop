import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { ModelPicker } from "../pickers/ModelPicker";
import { ThinkingPicker } from "../pickers/ThinkingPicker";
import { PermissionBadge } from "../pickers/PermissionBadge";

/**
 * 会话输入框：随心输入 + 底部工具行（截图布局）。
 * 上：多行输入；下左：+ / 权限；下右：模型 / 思考档 / 语音占位 / 发送-停止。
 * 模型·思考档·权限只放这里，顶栏不再重复（UpdateBell 除外）。
 */
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
      <div className="px-4 pb-4">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface px-4 py-3 text-center text-sm text-muted">
          已归档，只读——取消归档后可继续对话
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4">
      <div className="mx-auto max-w-3xl rounded-2xl border border-border bg-surface shadow-sm">
        {awaiting && (
          <div className="px-4 pt-2 text-xs text-warn">先处理上面的审批</div>
        )}
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
          placeholder={awaiting ? "先处理上面的审批" : "随心输入"}
          className="max-h-40 w-full resize-y bg-transparent px-4 pt-3 text-sm outline-none placeholder:text-muted disabled:opacity-60"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <button
            className="cursor-pointer rounded-full p-2 text-muted transition-colors duration-200 hover:bg-background hover:text-foreground"
            aria-label="添加附件（V1 未开放）"
            title="添加附件（V1 未开放）"
            disabled
          >
            <span aria-hidden className="text-lg leading-none">＋</span>
          </button>
          <PermissionBadge compact align="left" />
          <div className="ml-auto flex items-center gap-1">
            <ModelPicker compact />
            <ThinkingPicker compact />
            {running ? (
              <button
                onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
                className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
                aria-label="停止"
              >
                停止
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!draft.trim()}
                className="cursor-pointer rounded-full bg-accent px-4 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90 disabled:opacity-40"
                aria-label="发送"
              >
                发送
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
