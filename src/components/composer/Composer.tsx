import { useApp } from "../../stores/app";
import { api } from "@shared/api";
import { ModelPicker } from "../pickers/ModelPicker";
import { ThinkingPicker } from "../pickers/ThinkingPicker";
import { PermissionBadge } from "../pickers/PermissionBadge";
import { OmpStatusPill, RuntimeStats } from "../thread/StatusBar";
import { ContextBar } from "./ContextBar";

/**
 * 会话输入框：随心输入 + 底部工具行（截图布局）。
 * 上：上下文条（项目 / git 分支）+ 多行输入；下左：+ / 权限；下右：模型 / 思考档 / 语音占位 / 发送-停止。
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
      <div className="shrink-0 px-4 pb-4">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/70 bg-surface px-4 py-3 text-center text-sm text-muted">
          已归档，只读——取消归档后可继续对话
        </div>
      </div>
    );
  }

  return (
    <div className="shrink-0 px-4 pb-4">
      {/* 上下文条在卡片外、上方：项目 + git 分支（无项目时自身不渲染） */}
      <ContextBar />
      <div
        className={`mx-auto max-w-3xl rounded-2xl border bg-surface shadow-[0_8px_28px_-12px_rgba(0,0,0,0.35)] transition-colors duration-150 ${
          awaiting ? "border-warn/50" : "border-border/80 focus-within:border-accent/60"
        }`}
      >
        {awaiting && (
          <div className="px-4 pt-2.5 text-xs text-warn">先处理上面的审批</div>
        )}
        <label htmlFor="composer" className="sr-only">
          输入消息
        </label>
        <textarea
          id="composer"
          rows={3}
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
          className="max-h-44 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-sm leading-6 outline-none placeholder:text-muted/70 disabled:opacity-60"
        />
        <div className="flex flex-wrap items-center gap-0.5 gap-y-1 px-2.5 pb-2.5">
          <button
            className="cursor-pointer rounded-full p-2 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-40"
            aria-label="添加附件（V1 未开放）"
            title="添加附件（V1 未开放）"
            disabled
          >
            <span aria-hidden className="text-lg leading-none">＋</span>
          </button>
          <PermissionBadge compact align="left" />
          <OmpStatusPill />
          <RuntimeStats />
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1">
            <ModelPicker compact />
            <ThinkingPicker compact />
            {running ? (
              <button
                onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
                className="ml-1 flex cursor-pointer items-center gap-1.5 rounded-full bg-accent px-3.5 py-1.5 text-sm text-white transition-opacity duration-150 hover:opacity-90"
                aria-label="停止"
              >
                <span className="h-2 w-2 rounded-sm bg-white" aria-hidden />
                停止
              </button>
            ) : (
              <button
                onClick={() => void send()}
                disabled={!draft.trim()}
                className="ml-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-accent text-white transition-all duration-150 hover:opacity-90 disabled:cursor-default disabled:opacity-30"
                aria-label="发送"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M12 19V5m0 0-6 6m6-6 6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
