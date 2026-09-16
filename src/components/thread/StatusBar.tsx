import { useApp } from "../../stores/app";
import { api } from "@shared/api";

export type OmpStatusKind = "ready" | "running" | "awaiting-approval" | "error" | "exited";

/**
 * 输入框内的 omp 状态胶囊：常驻展示（借鉴 Cursor / Codex 底部状态条的做法）。
 * 就绪态也占位显示「就绪」，避免用户误以为状态丢失；非就绪（运行中 / 等待审批 /
 * 出错 / 已退出 / omp 不可用）用颜色 + 文字双信号强调。
 * 只读展示，不可点击；颜色不作唯一信号，一律配文字。
 */
export function OmpStatusPill() {
  const { activeSessionId, statusBySession, health, sessions } = useApp();
  const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
  // 后端 list_sessions 的 running 快照兜底：事件还没到之前也能看到运行中。
  const runningFallback = activeSessionId
    ? sessions.find((s) => s.id === activeSessionId)?.running
    : false;

  let kind: OmpStatusKind;
  let text: string;
  if (!health) {
    kind = "running";
    text = "检查中…";
  } else if (!health.ok) {
    kind = "error";
    text = "omp 不可用";
  } else if (status === "running" || (!status && runningFallback)) {
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
  } else {
    // idle / 未知一律收敛为就绪常驻位（对应 Cursor 右下角常亮的连接态）。
    kind = "ready";
    text = activeSessionId ? "就绪" : "未选会话";
  }
  if (!kind) return null;

  const dot =
    kind === "ready"
      ? "bg-ok/70"
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
      title={text}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  );
}

/** 数字紧凑格式（纯展示，不做任何统计计算）。 */
function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/**
 * 输入框工具行里的只读用量：上下文占用 / 本轮 token / 耗时 / TTFT。
 *
 * 数据全部来自后端透传的 omp 真值（`omp-state://<id>`）——前端不自算 token、
 * 不猜单位（omp 的 duration/ttft 实测就是毫秒，这里只把它显示成秒）。
 * 没有真值时整块不渲染，不占位、不显示"—"。
 */
export function CompactButton() {
  const { activeSessionId, currentRuntime, statusBySession } = useApp();
  const pct = currentRuntime?.contextUsage?.percent;
  const normalized = pct == null ? null : pct <= 1 ? pct * 100 : pct;
  // 上下文占用 ≥80% 才露面：平时不占工具行，满了才是行动点。
  if (normalized == null || normalized < 80 || !activeSessionId) return null;
  const busy = statusBySession[activeSessionId]?.state === "running";
  const run = async () => {
    try {
      await api.compactSession(activeSessionId);
    } catch {
      // 失败走 divider 错误行展示（frameToViewMsgs 的 response 失败分支），此处不弹错
    }
  };
  return (
    <button
      onClick={() => void run()}
      disabled={busy}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full border border-warn/50 px-2 py-0.5 text-xs text-warn transition-colors duration-150 hover:bg-warn/10 disabled:cursor-default disabled:opacity-40"
      aria-label={`压缩上下文（当前占用 ${Math.round(normalized)}%）`}
      title="把历史压缩成摘要后继续本会话"
    >
      压缩 {Math.round(normalized)}%
    </button>
  );
}

export function QueueBadge() {
  const n = useApp((s) => s.currentRuntime?.queuedCount ?? 0);
  if (!n || n <= 0) return null;
  return (
    <span
      className="flex shrink-0 items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs text-accent"
      role="status"
      aria-label={`已排队 ${n} 条`}
      title="流式中排队的追问，本轮后按序执行"
    >
      排队 {n}
    </span>
  );
}

export function RuntimeStats() {
  const rt = useApp((s) => s.currentRuntime);
  if (!rt) return null;
  const parts: string[] = [];
  const cu = rt.contextUsage;
  if (cu) {
    const pct = cu.percent == null ? null : cu.percent <= 1 ? cu.percent * 100 : cu.percent;
    if (pct != null) parts.push(`上下文 ${pct >= 10 ? Math.round(pct) : pct.toFixed(1)}%`);
    else if (cu.tokens != null && cu.contextWindow)
      parts.push(`上下文 ${compact(cu.tokens)}/${compact(cu.contextWindow)}`);
  }
  if (rt.usage?.totalTokens != null) parts.push(`${compact(rt.usage.totalTokens)} tok`);
  if (rt.durationMs != null) parts.push(`${(rt.durationMs / 1000).toFixed(1)}s`);
  if (rt.ttftMs != null) parts.push(`TTFT ${(rt.ttftMs / 1000).toFixed(1)}s`);
  if (parts.length === 0) return null;
  const u = rt.usage;
  const detail = [
    u?.input != null ? `输入 ${u.input}` : null,
    u?.output != null ? `输出 ${u.output}` : null,
    u?.cacheRead != null ? `缓存读 ${u.cacheRead}` : null,
    u?.reasoningTokens != null ? `推理 ${u.reasoningTokens}` : null,
    u?.costTotal != null ? `成本 $${u.costTotal.toFixed(4)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      className="flex shrink-0 cursor-default items-center px-1.5 text-xs text-muted/80"
      role="status"
      aria-label={`用量：${parts.join("，")}`}
      title={detail || "omp 透传的用量真值"}
    >
      {parts.join(" · ")}
    </span>
  );
}

export function StatusBar() {  // 标题框外的独立状态条已下线：状态统一收敛到输入框内的 OmpStatusPill（常驻展示）。
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
