import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { TODO_DISPLAY, TODO_PENDING } from "../../lib/todoDisplay";
import { PanelSection } from "./PanelSection";
import type { TodoPhase } from "@shared/types";

/**
 * 右栏「进度」区块（v2，Codex 对标）：`plansBySession`（todo 工具帧 `details.phases`
 * 实时写入 + `get_state.todoPhases` 回读）的只读任务清单 —— ✓ 完成 / ◐ 进行中 /
 * ⊘ 受阻 / ○ 待办（状态口径与消息列右上角的「任务清单」浮卡共用 `TODO_DISPLAY`）。
 * 没有计划数据时整块不渲染（不占版面）；主入口是浮卡，这里是停靠的完整视图。
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
    {phases.map((p, pi) => (
     <div key={pi}>
      {p.name && <div className="mb-0.5 text-[11px] font-medium text-muted">{p.name}</div>}
      <ul className="space-y-0.5">
       {p.tasks.map((task, ti) => {
        const d = TODO_DISPLAY[task.status] ?? TODO_PENDING;
        return (
         <li key={ti} className="flex items-start gap-1.5 text-[12px] leading-5">
          <span aria-hidden className={`shrink-0 ${d.tone}`}>
           {d.symbol}
          </span>
          <span className={`min-w-0 ${task.status === "in_progress" ? "text-foreground" : "text-muted"}`}>
           {task.content}
           <span className="sr-only">{t[d.label]}</span>
           {task.blocker && <span className="block text-[11px] text-faint">{task.blocker}</span>}
          </span>
         </li>
        );
       })}
      </ul>
     </div>
    ))}
   </div>
  </PanelSection>
 );
}
