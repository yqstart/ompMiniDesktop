import type { Text } from "./locale";

/**
 * 任务清单的状态 → 展示口径：浮卡与右栏「进度」区块共用同一张表（单一真相，
 * 两处渲染不许各写一份映射）。「符号 + 色调 + 文案」三信号，颜色不作唯一信号。
 * 上游实测状态集：`pending` / `in_progress` / `completed` / `blocked`（带 `blocker` 文案）；
 * 未知状态按「待办」档渲染（`TODO_PENDING`）。
 */
export const TODO_DISPLAY: Record<string, { symbol: string; tone: string; label: keyof Text }> = {
 pending: { symbol: "○", tone: "text-faint", label: "planTodo" },
 in_progress: { symbol: "◐", tone: "text-accent", label: "planInProgress" },
 completed: { symbol: "✓", tone: "text-ok", label: "planDone" },
 blocked: { symbol: "⊘", tone: "text-danger", label: "planBlocked" },
};

/** 未知状态的兜底档（与 `pending` 同口径）。 */
export const TODO_PENDING = TODO_DISPLAY.pending;
