import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { restartRuntimeForApproval } from "./useSessionEvents";

/** 执行模式循环序（对齐 codex / zcode 的 Shift+Tab）：omp 三档。 */
export const APPROVAL_CYCLE = ["always-ask", "write", "yolo"] as const;

/**
 * 会话执行模式循环（V41 从 Composer 提取，Shift+Tab 与命令中心共用）：
 * `always-ask → write → yolo → always-ask`。omp 的档位是启动参数（`--approval-mode`），
 * 运行中改不了——idle 时写覆盖层后自动重启 runtime 立即生效；running / awaiting 时挂起，
 * 本轮结束（转 idle）后自动重启（见 `restartRuntimeForApproval`），不打断进行中的轮次。
 * 返回新档位（失败返回 null）。
 */
export async function cycleSessionApproval(sid: string): Promise<string | null> {
 const st = useApp.getState();
 const cur = st.sessionApprovals[sid] ?? st.globalApproval;
 const idx = APPROVAL_CYCLE.indexOf(cur as (typeof APPROVAL_CYCLE)[number]);
 const next = APPROVAL_CYCLE[(idx + 1) % APPROVAL_CYCLE.length];
 try {
  await api.setSessionApproval(sid, next);
  const st2 = useApp.getState();
  st2.set({ sessionApprovals: { ...st2.sessionApprovals, [sid]: next } });
  const status = st2.statusBySession[sid]?.state;
  if (status === "running" || status === "awaiting-approval") {
   st2.markApprovalRestart(sid);
  } else {
   void restartRuntimeForApproval(sid);
  }
  return next;
 } catch {
  // 写覆盖层失败：静默（徽标不变）
  return null;
 }
}
