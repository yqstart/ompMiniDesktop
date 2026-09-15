import { useApp } from "../../stores/app";

export function StatusBar() {
  const { activeSessionId, statusBySession, eventsBySession } = useApp();
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
  const events = activeSessionId ? (eventsBySession[activeSessionId] ?? []) : [];
  const tools = events.filter((e) => e.kind === "tool").length;
  const text =
    status === "running"
      ? "运行中"
      : status === "awaiting-approval"
        ? "等待审批"
        : status === "error"
          ? "出错"
          : status === "exited"
            ? "已退出"
            : tools > 0
              ? `工具 ${tools}`
              : "就绪";
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-border bg-surface px-4 py-1 text-xs text-muted" aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "bg-accent animate-pulse" : status === "awaiting-approval" ? "bg-warn" : "bg-border"}`} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
