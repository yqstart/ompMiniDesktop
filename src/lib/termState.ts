import type { TermTabState } from "@shared/types";
import type { TextKey } from "./locale";

/** π 的颜色即 omp 状态（token 见 MASTER §2）：工作中呼吸、等你确认、就绪、结束、失败。 */
export const STATE_TONE: Record<TermTabState, string> = {
  working: "animate-pulse text-accent",
  attention: "text-warn",
  ready: "text-ok",
  exited: "text-ok",
  failed: "text-danger",
  unknown: "text-faint",
};

/** 状态文字（屏幕阅读器与 π 的悬停提示；颜色不是唯一信号）。 */
export const STATE_TEXT: Record<TermTabState, TextKey | null> = {
  working: "termStateWorking",
  attention: "termStateAttention",
  ready: "termStateReady",
  exited: "termStateExited",
  failed: "termStateFailed",
  unknown: null,
};
