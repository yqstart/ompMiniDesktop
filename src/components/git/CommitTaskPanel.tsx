import { useEffect, useRef } from "react";
import { AlertTriangle, CheckCircle, Loader, X } from "reicon-react";
import type { CommitPhase } from "@shared/types";
import { useApp } from "../../stores/app";
import {
 cancelCommitTask,
 closeCommitPanel,
 isCommitTaskRunning,
 pushCommits,
 startCommitTask,
} from "../../lib/commitTasks";
import { workspaceLabel } from "../../lib/workspaces";
import { useDialogFocus } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";
import type { TextKey } from "../../lib/locale";

/**
 * 工作区「提交并推送」任务浮层（V14）。
 *
 * - 单例：显示 `activeCommitCwd` 指向的任务；Esc / 点遮罩 / 「后台运行」都是**关闭浮层**
 *   （运行中 = 转后台，任务与行徽章继续；终态 = 清除记录）。
 * - 两段式的中转站：`committed`（已提交，待推送）停在这里，用户点「推送」走 ~2s 快路径。
 * - 日志流式来自后端 Channel（已去 ANSI）；结果里的提交列表读自 git（真相在 git，不在解析输出）。
 */

/** 阶段文案（中英字典键）。 */
const PHASE_KEY: Record<CommitPhase, TextKey> = {
 checking: "gitPhaseChecking",
 committing: "gitPhaseCommitting",
 pushing: "gitPhasePushing",
 committed: "gitPhaseCommitted",
 pushed: "gitPhasePushed",
 noop: "gitPhaseNoop",
 failed: "gitPhaseFailed",
 canceled: "gitPhaseCanceled",
};

/** 阶段色调（token，见 index.css）。 */
const PHASE_TONE: Record<CommitPhase, string> = {
 checking: "text-muted",
 committing: "text-accent",
 pushing: "text-accent",
 committed: "text-ok",
 pushed: "text-ok",
 noop: "text-muted",
 failed: "text-danger",
 canceled: "text-faint",
};

export function CommitTaskPanel() {
 const activeCwd = useApp((s) => s.activeCommitCwd);
 if (!activeCwd) return null;
 // key：切换到另一个工作区的任务时重建（滚动位置与焦点都回到新任务）
 return <CommitTaskCard key={activeCwd} cwd={activeCwd} />;
}

function CommitTaskCard({ cwd }: { cwd: string }) {
 const t = useText();
 const task = useApp((s) => s.commitTasks[cwd]);
 const workspace = useApp((s) => s.workspaces.find((w) => w.path === cwd));
 const cardRef = useRef<HTMLDivElement>(null);
 const logRef = useRef<HTMLDivElement>(null);
 useDialogFocus(cardRef, true, closeCommitPanel);

 // 日志自动滚底（新行到达时）
 useEffect(() => {
  const el = logRef.current;
  if (el) el.scrollTop = el.scrollHeight;
 }, [task?.log.length]);

 if (!task) return null;
 const running = isCommitTaskRunning(task.phase);

 return (
  <div
   className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
   onClick={closeCommitPanel}
  >
   <div
    ref={cardRef}
    tabIndex={-1}
    role="dialog"
    aria-modal="true"
    aria-label={t.gitPanelTitle}
    className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-border bg-elevated shadow-dialog"
    onClick={(e) => e.stopPropagation()}
   >
    <div className="flex items-start gap-3 border-b border-border-soft p-5 pb-4">
     <div className="min-w-0 flex-1">
      <div className="text-[15px] font-semibold tracking-tight">{t.gitPanelTitle}</div>
      <div className="mt-1 min-w-0 truncate font-mono text-[12px] text-muted">
       {workspace ? workspaceLabel(workspace) : cwd}
      </div>
     </div>
     <PhaseBadge phase={task.phase} />
    </div>

    <div
     ref={logRef}
     className="min-h-[160px] flex-1 overflow-y-auto bg-surface/40 px-5 py-4 font-mono text-[12px] leading-5 break-words whitespace-pre-wrap text-muted"
    >
     {task.log.map((line, i) => (
      // 日志是追加流，index 即身份（内容可能重复，不能用内容当 key）
      <div key={i}>{line}</div>
     ))}
     {task.log.length === 0 && <div className="text-faint">…</div>}
    </div>

    {task.commits.length > 0 && (
     <div className="border-t border-border-soft px-5 py-3">
      <div className="mb-1.5 text-[11px] font-medium tracking-wide text-faint">{t.gitResultCommits}</div>
      <ul className="space-y-1">
       {task.commits.map((c) => (
        <li key={c.sha} className="flex items-baseline gap-2 text-[12px]">
         <span className="shrink-0 font-mono text-faint">{c.sha}</span>
         <span className="min-w-0 flex-1 break-words">{c.subject}</span>
        </li>
       ))}
      </ul>
     </div>
    )}

    {task.error && (
     <div className="border-t border-border-soft px-5 py-3">
      <pre className="max-h-32 overflow-y-auto font-mono text-[11.5px] leading-5 break-words whitespace-pre-wrap text-muted">
       {task.error}
      </pre>
      {task.hint && <p className="mt-2 text-[12px] leading-5 text-warn">{task.hint}</p>}
     </div>
    )}

    <div className="border-t border-border-soft px-5 py-2 text-[11px] text-faint">{t.gitPanelNote}</div>

    <div className="flex justify-end gap-2 p-4 pt-2">
     {running ? (
      <>
       <button
        type="button"
        onClick={() => cancelCommitTask(cwd)}
        className="cursor-pointer rounded-md border border-border px-3.5 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
       >
        {t.gitPanelCancel}
       </button>
       <button
        type="button"
        onClick={closeCommitPanel}
        className="cursor-pointer rounded-md border border-transparent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-foreground transition-colors duration-100 hover:opacity-90"
       >
        {t.gitPanelBackground}
       </button>
      </>
     ) : (
      <>
       {task.phase === "failed" && (
        <button
         type="button"
         onClick={() => startCommitTask(cwd)}
         className="cursor-pointer rounded-md border border-transparent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-foreground transition-colors duration-100 hover:opacity-90"
        >
         {t.gitPanelRetry}
        </button>
       )}
       {task.phase === "committed" && (
        <button
         type="button"
         onClick={() => pushCommits(cwd)}
         className="cursor-pointer rounded-md border border-transparent bg-accent px-3.5 py-1.5 text-[13px] font-medium text-accent-foreground transition-colors duration-100 hover:opacity-90"
        >
         {t.gitPanelPush}
        </button>
       )}
       <button
        type="button"
        onClick={closeCommitPanel}
        className="cursor-pointer rounded-md border border-border px-3.5 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
       >
        {t.gitPanelClose}
       </button>
      </>
     )}
    </div>
   </div>
  </div>
 );
}

/** 阶段徽章：图标 + 文案（颜色不是唯一信号——文案在旁）。 */
function PhaseBadge({ phase }: { phase: CommitPhase }) {
 const t = useText();
 const running = isCommitTaskRunning(phase);
 const Icon = phase === "failed" ? AlertTriangle : phase === "canceled" ? X : running ? Loader : CheckCircle;
 return (
  <span className={`flex shrink-0 items-center gap-1.5 text-[12px] font-medium ${PHASE_TONE[phase]}`}>
   <Icon size={13} aria-hidden className={running ? "animate-spin" : ""} />
   {t[PHASE_KEY[phase]]}
  </span>
 );
}
