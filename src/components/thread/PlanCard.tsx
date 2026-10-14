import { useEffect } from "react";
import { CheckListSquare, ChevronDown, X } from "reicon-react";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { TODO_DISPLAY, TODO_PENDING } from "../../lib/todoDisplay";

/** 标题行图标钮（无边框轻量档：浮卡本身已是 elevated 面）。 */
const ICON_BTN =
 "cursor-pointer rounded-md p-0.5 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground";

/**
 * 任务清单浮卡（v2，消息列右上角常驻）：折叠态 = 进度徽标，展开态 = 阶段清单。
 *
 * - 数据 = `plansBySession`（todo 工具帧 `details.phases` 实时写入 + `get_state.todoPhases`
 *   回读）；开合 = `planCardBySession`（无记录 = 首次出现自动展开，见 store 的 `applyPlans`）；
 * - 全部完成自动折叠为 ✓ 徽标（同一份清单只自动折一次——用户手动再展开不再打扰）；
 * - 清单清空（回读发现 `[]` / `todo_auto_clear` 帧）即退场；手动隐藏后本次计划不再出现；
 * - 挂载在 Thread 的相对定位外壳内：不入消息流、不随滚动走；**右缘贴消息列右缘
 *   （8px）**——折叠胶囊常驻，必须避开正文列（对齐正文右缘会骑在正文最后一列字符上，
 *   用户实测）；贴边后胶囊落在正文列右侧的留白里（宽窗完全不相交），窄窗也只轻微重叠。
 */
export function PlanCard() {
 const t = useText();
 const sid = useApp((s) => s.activeSessionId);
 const phases = useApp((s) => (sid ? s.plansBySession[sid] : undefined));
 const card = useApp((s) => (sid ? s.planCardBySession[sid] : undefined));
 const setPlanCard = useApp((s) => s.setPlanCard);

 const total = phases?.reduce((n, p) => n + p.tasks.length, 0) ?? 0;
 const done = phases?.reduce((n, p) => n + p.tasks.filter((x) => x.status === "completed").length, 0) ?? 0;
 const allDone = total > 0 && done === total;
 const visible = !!sid && !!phases && phases.length > 0 && card !== "hidden";
 const expanded = card !== "collapsed";

 // 全部完成 → 收成徽标：**只在 `allDone` 翻转的那一下折**（deps 只有 allDone）——
 // 用户随后手动再展开不被打扰；开合态从 store 读实时值（多实例 / 重挂载时
 // 不会因为本地 ref 没记录过折叠事件而把用户的展开动作再折回去）。
 useEffect(() => {
  if (!allDone) return;
  const st = useApp.getState();
  if (st.activeSessionId && st.planCardBySession[st.activeSessionId] === "expanded") {
   st.setPlanCard(st.activeSessionId, "collapsed");
  }
 }, [allDone]);

 if (!visible || !sid || !phases) return null;

 const badgeTone = allDone ? "shrink-0 text-ok" : "shrink-0 text-accent";
 return (
  <div className="absolute top-5 right-2 z-10">
   {!expanded && (
    <button
     onClick={() => setPlanCard(sid, "expanded")}
     className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1 shadow-pop transition-colors duration-100 hover:bg-hover"
     aria-label={fmt(t.planBadgeAria, done, total)}
     title={t.planTitle}
    >
     <CheckListSquare size={13} aria-hidden className={badgeTone} />
     <span className={`font-mono text-[11px] ${allDone ? "text-ok" : "text-muted"}`}>
      {done}/{total}
     </span>
    </button>
   )}
   {expanded && (
    <div
     className="w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-elevated shadow-pop"
     role="group"
     aria-label={t.planTitle}
    >
     <div className="flex items-center gap-1.5 border-b border-border-soft px-2.5 py-1.5">
      <CheckListSquare size={13} aria-hidden className={badgeTone} />
      <span className="text-xs font-medium text-muted">{t.planTitle}</span>
      <span className={`font-mono text-[11px] ${allDone ? "text-ok" : "text-faint"}`}>
       {done}/{total}
      </span>
      <div className="ml-auto flex items-center gap-0.5">
       <button
        onClick={() => setPlanCard(sid, "collapsed")}
        className={ICON_BTN}
        aria-label={t.planCollapse}
        title={t.planCollapse}
       >
        <ChevronDown size={13} aria-hidden className="rotate-180" />
       </button>
       <button onClick={() => setPlanCard(sid, "hidden")} className={ICON_BTN} aria-label={t.planHide} title={t.planHide}>
        <X size={13} aria-hidden />
       </button>
      </div>
     </div>
     <div className="max-h-[min(50vh,26rem)] space-y-2 overflow-y-auto px-2.5 py-2">
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
    </div>
   )}
  </div>
 );
}
