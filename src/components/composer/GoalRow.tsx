import { useState } from "react";
import { Edit, Pause, Play, Target, Trash2 } from "reicon-react";
import { api } from "@shared/api";
import type { Goal } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

/** 条内图标钮（DSH GoalBar 的 iconBtn 档）：28px 圆形、悬停才给底，禁用降透明度。 */
const ICON_BTN =
 "flex size-7 cursor-pointer items-center justify-center rounded-full text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40";

/**
 * 目标条（V40；2026-10-20 按 DSH 的 composer goal dock 重做，同日改为**纯展示 + 操作**）：
 *
 * - 一条 36px 高的浮起条（与输入卡同宽、贴在卡上方）：目标字形 + 「目标」+ 状态 +
 *   单行目标文本，右侧只有 28px 圆形图标键（暂停/继续、编辑、清除）。
 * - **与卡面同一套外壳**（2026-10-22 用户口径）：项目 / 分支 / 提交搬回输入卡内之后，
 *   目标条与任务清单浮卡是卡片上方仅有的两层，圆角 / 描边 / 浮起层级统一成
 *   `rounded-xl` + `--border` + `--elevated` + `--shadow-pop`（与任务浮卡同档），整摞读成一个整体。
 * - **编辑不在条内**（2026-10-20 用户口径）：点「编辑」/ 工具行「目标」按钮 =
 *   让**主输入框**进入目标输入模式（`Composer` 的 `goalMode`），发送即设置 / 更新目标；
 *   条只在目标存在后出现，不再就地展开编辑框。
 * - 数据 = `goal_updated` 帧与 `get_state.goal` 回读（`store.goalBySession`）；暂停 / 继续 /
 *   清除走 `api.goalCommand`，成功后立即写回 store 收敛。
 */
export function GoalRow({ onEdit }: { onEdit: () => void }) {
 const t = useText();
 const sid = useApp((s) => s.activeSessionId);
 // 选择器订阅：只有本会话的 goal 变化才重渲染（对象引用来自帧/回读，稳定）
 const goal = useApp((s) => (s.activeSessionId ? (s.goalBySession[s.activeSessionId] ?? null) : null));
 /** 暂停 / 继续 / 清除失败的原因（条内红字，不静默吞掉）。 */
 const [actionError, setActionError] = useState<string | null>(null);

 if (!sid || !goal) return null;

 const paused = goal.status === "paused";
 const run = async (op: "pause" | "resume" | "drop") => {
  setActionError(null);
  try {
   const data = await api.goalCommand(sid, op);
   // 立即收敛显示（`goal_updated` 帧随后也会到，同值幂等）
   useApp.getState().setGoal(sid, (data.goal ?? null) as Goal | null);
  } catch (e) {
   // 失败原因就地显示（DSH 同口径）；状态仍由帧 / 回读收敛
   setActionError(e instanceof Error ? e.message : String(e));
  }
 };

 return (
  <div
   className="mx-auto mb-1.5 max-w-(--measure-content)"
   role="region"
   aria-label={fmt(t.goalRowAria, goal.objective, paused ? t.goalPaused : t.goalInProgress)}
  >
   <div className="flex h-9 items-center gap-2.5 rounded-xl border border-border bg-elevated pr-1 pl-3 shadow-pop">
    <Target size={14} className="shrink-0 text-faint" aria-hidden />
    <span className="flex shrink-0 items-baseline gap-1.5">
     <span className="text-[13px] font-medium text-foreground">{t.goalLabel}</span>
     <span className="text-[11px] text-faint">{paused ? t.goalPaused : t.goalInProgress}</span>
    </span>
    <span className="min-w-0 flex-1 truncate text-[13px] text-muted" title={goal.objective}>
     {goal.objective}
    </span>
    {actionError && (
     <span role="alert" className="min-w-0 max-w-[45%] truncate text-[12px] text-danger" title={actionError}>
      {actionError}
     </span>
    )}
    {!actionError && goal.timeUsedSeconds >= 60 && (
     <span className="shrink-0 text-[11px] text-faint">
      {fmt(t.goalRowTime, Math.max(1, Math.round(goal.timeUsedSeconds / 60)))}
     </span>
    )}
    <span className="flex shrink-0 items-center gap-0.5">
     <button
      type="button"
      onClick={() => void run(paused ? "resume" : "pause")}
      className={ICON_BTN}
      aria-label={paused ? t.goalResume : t.goalPause}
      title={paused ? t.goalResume : t.goalPause}
     >
      {paused ? <Play size={14} aria-hidden /> : <Pause size={14} aria-hidden />}
     </button>
     <button type="button" onClick={onEdit} className={ICON_BTN} aria-label={t.goalEdit} title={t.goalEdit}>
      <Edit size={14} aria-hidden />
     </button>
     <button
      type="button"
      onClick={() => void run("drop")}
      className={`${ICON_BTN} hover:text-danger`}
      aria-label={t.goalClear}
      title={t.goalClear}
     >
      <Trash2 size={14} aria-hidden />
     </button>
    </span>
   </div>
  </div>
 );
}
