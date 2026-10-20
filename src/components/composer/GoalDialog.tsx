import { useRef, useState } from "react";
import { Pause, Play, Target } from "reicon-react";
import { api } from "@shared/api";
import type { Goal } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { DialogShell } from "../settings/DialogShell";

/**
 * 目标弹窗（2026-10-20，`+` 菜单「目标」的落地）：**查看 / 设置 / 暂停 / 恢复 / 清除**。
 *
 * 为什么不复用输入框：`/goal <说明>` 要求整条草稿就是一条命令（`/` 必须在开头），
 * 从菜单点进来时用户草稿里往往已经有内容——覆盖它不可接受，拼在末尾又会退化成普通消息。
 * 弹窗不碰草稿，操作全走 RPC（与 GoalRow 的暂停 / 继续 / 清除同一条通路）。
 *
 * 只在打开时挂载（`{open && <GoalDialog/>}`）：objective 直接由 props 初始化，
 * 不需要用 effect 把 prop 灌进 state（`react-hooks/set-state-in-effect` 也不允许）。
 */
export function GoalDialog({ sessionId, goal, onClose }: { sessionId: string; goal: Goal | null; onClose: () => void }) {
 const t = useText();
 const inputRef = useRef<HTMLInputElement>(null);
 const [objective, setObjective] = useState(goal?.objective ?? "");
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const paused = goal?.status === "paused";

 /** 执行一次 goal RPC：成功即写回 store 并关窗；失败把 omp 的原文留在弹窗里。 */
 const run = async (op: "create" | "pause" | "resume" | "drop") => {
  if (busy) return;
  const text = objective.trim();
  if (op === "create" && !text) return;
  setBusy(true);
  setError(null);
  try {
   const data = await api.goalCommand(sessionId, op, op === "create" ? text : undefined);
   useApp.getState().setGoal(sessionId, (data.goal ?? null) as Goal | null);
   onClose();
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e));
  } finally {
   setBusy(false);
  }
 };

 const primary = "cursor-pointer rounded-md border border-transparent bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-opacity duration-100 hover:opacity-90 disabled:cursor-default disabled:opacity-50";
 const secondary =
  "flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40";

 return (
  <DialogShell title={t.goalLabel} onClose={onClose} initialFocusRef={inputRef}>
   <div className="flex flex-col gap-3">
    <p className="text-[12px] leading-5 text-muted">{t.goalDialogHint}</p>
    <label className="flex flex-col gap-1.5">
     <span className="text-[12px] font-medium text-muted">{t.goalObjectiveLabel}</span>
     <input
      ref={inputRef}
      value={objective}
      onChange={(e) => setObjective(e.target.value)}
      placeholder={t.goalDialogPlaceholder}
      spellCheck={false}
      className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] outline-none focus:border-accent/60"
      onKeyDown={(e) => {
       if (e.key === "Enter" && !e.nativeEvent.isComposing) {
        e.preventDefault();
        void run("create");
       }
      }}
     />
    </label>
    {goal && (
     <div className="flex items-center gap-1.5 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[12px] text-muted">
      <Target size={13} className="shrink-0 text-accent" aria-hidden />
      <span className="shrink-0 font-medium text-accent">{t.goalLabel}</span>
      <span className="shrink-0">{paused ? t.goalPaused : t.goalInProgress}</span>
      {goal.timeUsedSeconds >= 60 && (
       <span className="shrink-0 text-faint">{fmt(t.goalRowTime, Math.max(1, Math.round(goal.timeUsedSeconds / 60)))}</span>
      )}
     </div>
    )}
    {error && (
     <p role="alert" className="text-[12px] leading-5 text-danger">
      {error}
     </p>
    )}
    <div className="flex flex-wrap items-center gap-1.5 border-t border-border-soft pt-3">
     <button type="button" disabled={busy || !objective.trim()} onClick={() => void run("create")} className={primary}>
      {goal ? t.goalDialogUpdate : t.goalDialogSet}
     </button>
     {goal && (
      <>
       <button type="button" disabled={busy} onClick={() => void run(paused ? "resume" : "pause")} className={secondary}>
        {paused ? <Play size={11} aria-hidden /> : <Pause size={11} aria-hidden />}
        {paused ? t.goalResume : t.goalPause}
       </button>
       <button
        type="button"
        disabled={busy}
        onClick={() => void run("drop")}
        className={`${secondary} hover:text-danger`}
       >
        {t.goalClear}
       </button>
      </>
     )}
    </div>
   </div>
  </DialogShell>
 );
}
