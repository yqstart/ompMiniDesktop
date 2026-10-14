import { Pause, Play, Target } from "reicon-react";
import { api } from "@shared/api";
import type { Goal } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

/**
 * 目标行（V40）：goal 模式的状态与操作（对齐 zcode 的目标摘要条 / codex 的 `/goal`）。
 *
 * 有目标才渲染：`目标 · <objective> · 进行中 · 已用 N 分钟` + 暂停 / 继续 / 清除。
 * 数据 = `goal_updated` 帧与 `get_state.goal` 回读（`store.goalBySession`）；
 * 操作走 RPC `goal`（create 由输入框的 `/goal <说明>` 承担，这里只做 pause/resume/drop）。
 */
export function GoalRow() {
 const t = useText();
 // 选择器订阅：只有本会话的 goal 变化才重渲染（对象引用来自帧/回读，稳定）
 const goal = useApp((s) => (s.activeSessionId ? (s.goalBySession[s.activeSessionId] ?? null) : null));
 const sid = useApp((s) => s.activeSessionId);
 if (!goal) return null;
 const paused = goal.status === "paused";

 const act = async (op: "pause" | "resume" | "drop") => {
  if (!sid) return;
  try {
   const data = await api.goalCommand(sid, op);
   // 立即收敛显示（`goal_updated` 帧随后也会到，同值幂等）
   useApp.getState().setGoal(sid, (data.goal ?? null) as Goal | null);
  } catch {
   // 失败静默：状态行保持原样，下一次帧 / 回读收敛
  }
 };

 return (
  <div
   className="mx-auto mb-1 flex max-w-(--measure-content) items-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1 text-[12px] text-muted"
   aria-label={fmt(t.goalRowAria, goal.objective, paused ? t.goalPaused : t.goalInProgress)}
  >
   <Target size={13} className="shrink-0 text-accent" aria-hidden />
   <span className="shrink-0 font-medium text-accent">{t.goalLabel}</span>
   <span className="min-w-0 truncate" title={goal.objective}>
    {goal.objective}
   </span>
   <span className="shrink-0 text-faint" aria-hidden>
    ·
   </span>
   <span className="shrink-0">{paused ? t.goalPaused : t.goalInProgress}</span>
   {goal.timeUsedSeconds >= 60 && (
    <>
     <span className="shrink-0 text-faint" aria-hidden>
      ·
     </span>
     <span className="shrink-0 text-faint">{fmt(t.goalRowTime, Math.max(1, Math.round(goal.timeUsedSeconds / 60)))}</span>
    </>
   )}
   <span className="ml-auto flex shrink-0 items-center gap-0.5">
    <button
     onClick={() => void act(paused ? "resume" : "pause")}
     className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     {paused ? <Play size={11} aria-hidden /> : <Pause size={11} aria-hidden />}
     {paused ? t.goalResume : t.goalPause}
    </button>
    <button
     onClick={() => void act("drop")}
     className="cursor-pointer rounded px-1.5 py-0.5 text-faint transition-colors duration-100 hover:bg-hover hover:text-danger"
    >
     {t.goalClear}
    </button>
   </span>
  </div>
 );
}
