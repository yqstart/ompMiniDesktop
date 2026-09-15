import { useApp } from "../../stores/app";

export type OmpStatusKind = "ready" | "running" | "awaiting-approval" | "error" | "exited";

/**
 * 输入框内的 omp 状态胶囊：仅在非就绪时出现（运行中 / 等待审批 / 出错 / 已退出）。
 * 就绪态不占位，避免标题框外常驻一个“就绪”分散注意力。
 * 只读展示，不可点击；颜色不作唯一信号，一律配文字。
 */
export function OmpStatusPill() {
  const { activeSessionId, statusBySession, health } = useApp();
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;

  let kind: OmpStatusKind | null = null;
  let text = "";
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
  if (!kind) return null;

  const dot =
    kind === "running"
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
      title={text}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}

export function StatusBar() {
  // 标题框外的独立状态条已下线：状态统一收敛到输入框内的 OmpStatusPill（非就绪才出现）。
  // 保留 aria-live 区域供读屏播报，不占视觉空间。
  const { activeSessionId, statusBySession } = useApp();
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
  const text =
    status === "running"
      ? "运行中"
      : status === "awaiting-approval"
        ? "等待审批"
        : status === "error"
          ? "出错"
          : status === "exited"
            ? "已退出"
            : "";
  if (!text) return null;
  return (
    <div className="sr-only" aria-live="polite">
      {text}
    </div>
  );
}
