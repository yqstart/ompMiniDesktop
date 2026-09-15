import { useApp } from "../../stores/app";

export type OmpStatusKind = "ready" | "running" | "awaiting-approval" | "error" | "exited";

/**
 * 输入框内的 omp 状态胶囊：就绪（omp 可用）/ 运行中 / 等待审批 / 出错 / 已退出。
 * 只读展示，不可点击；颜色不作唯一信号，一律配文字。
 */
export function OmpStatusPill() {
  const { activeSessionId, statusBySession, health } = useApp();
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;

  let kind: OmpStatusKind = "ready";
  let text = "就绪";
  if (!health || !health.ok) {
    kind = "error";
    text = "omp 不可用";
  } else if (status === "running") {
    kind = "running";
    text = "运行中";
  } else if (status === "awaiting-approval") {
    kind = "awaiting-approval";
    text = "等待审批";
  } else if (status === "error") {
    kind = "error";
    text = "出错";
  } else if (status === "exited") {
    kind = "exited";
    text = "已退出";
  }

  const dot =
    kind === "ready"
      ? "bg-ok"
      : kind === "running"
        ? "bg-accent animate-pulse"
        : kind === "awaiting-approval"
          ? "bg-warn"
          : kind === "error"
            ? "bg-danger"
            : "bg-muted/50";
  return (
    <span
      className="flex shrink-0 cursor-default items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-muted"
      role="status"
      aria-label={`omp 状态：${text}`}
      title={kind === "ready" ? `omp ${health?.omp.ompVersion ?? ""} 就绪` : text}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}

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
    <div className="flex shrink-0 items-center gap-2 px-5 py-1.5 text-[11px] text-muted" aria-live="polite">
      <span className={`h-1.5 w-1.5 rounded-full ${status === "running" ? "bg-accent animate-pulse" : status === "awaiting-approval" ? "bg-warn" : "bg-muted/40"}`} aria-hidden />
      <span>{text}</span>
    </div>
  );
}
