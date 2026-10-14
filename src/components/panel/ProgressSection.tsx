import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { PanelSection } from "./PanelSection";
import type { TodoPhase } from "@shared/types";

/** 状态符号 + 颜色（文字状态在 `sr-only` 里，颜色不作唯一信号——与 PlanCard 同口径）。 */
const TONE: Record<string, string> = {
 completed: "text-ok",
 in_progress: "text-accent",
};

/**
 * 右栏「进度」区块（v2）：`plansBySession`（omp `todoPhases` 真值 + `todo_reminder`）
 * 的只读任务清单 —— ✓ 完成 / ◐ 进行中 / ○ 待办。没有计划数据时整块不渲染（不占版面）。
 */
export function ProgressSection() {
 const t = useText();
 const phases = useApp((s) => (s.activeSessionId ? (s.plansBySession[s.activeSessionId] ?? null) : null));
 if (!phases || phases.length === 0) return null;
 const total = phases.reduce((n: number, p: TodoPhase) => n + p.tasks.length, 0);
 const done = phases.reduce(
  (n: number, p: TodoPhase) => n + p.tasks.filter((x) => x.status === "completed").length,
  0,
 );
 return (
  <PanelSection
   title={t.panelProgress}
   anchor="panel-progress"
   action={
    total > 0 ? (
     <span className="shrink-0 font-mono text-[11px] text-faint">
      {done}/{total}
     </span>
    ) : undefined
   }
  >
   <div className="space-y-2">
    {phases.map((p) => (
     <div key={p.id}>
      {p.name && <div className="mb-0.5 text-[11px] font-medium text-muted">{p.name}</div>}
      <ul className="space-y-0.5">
       {p.tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-1.5 text-[12px] leading-5">
         <span aria-hidden className={`shrink-0 ${TONE[task.status] ?? "text-faint"}`}>
          {task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : "○"}
         </span>
         <span className={`min-w-0 ${task.status === "in_progress" ? "text-foreground" : "text-muted"}`}>
          {task.content}
          <span className="sr-only">
           {task.status === "completed" ? t.planDone : task.status === "in_progress" ? t.planInProgress : t.planTodo}
          </span>
         </span>
        </li>
       ))}
      </ul>
     </div>
    ))}
   </div>
  </PanelSection>
 );
}
