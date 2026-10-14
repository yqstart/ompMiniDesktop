import { BranchDown, BranchUp, Check, Loader, Refresh } from "reicon-react";
import { useApp } from "../../stores/app";
import { resolveContext } from "../../lib/context";
import { useGitInfo } from "../../lib/useGitInfo";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";
import { openCommitPanel, pushWorkspace, isCommitTaskRunning } from "../../lib/commitTasks";
import { PanelSection } from "./PanelSection";

/**
 * 右栏「变更」区块（v2，对齐 Codex 的 Environment 卡 + 本站的提交/推送链路）：
 * 分支 + dirty 点、行级 `+X −Y`、ahead / behind、提交与推送入口（接 `CommitTaskPanel`）。
 *
 * 数据三源：`get_git_info`（分支 / dirty / 行数，`useGitInfo`）、工作区 git 快照
 * （ahead / behind，App 的轮询维护）、提交任务表（运行中 / 失败徽章）。都不改数据层。
 */
export function ChangesSection() {
 const t = useText();
 const projects = useApp((s) => s.projects);
 const sessions = useApp((s) => s.sessions);
 const activeSessionId = useApp((s) => s.activeSessionId);
 const { cwd } = resolveContext(projects, sessions, activeSessionId);
 const state = useApp((s) => (cwd ? (s.workspaceGitStates[cwd] ?? null) : null));
 const task = useApp((s) => (cwd ? (s.commitTasks[cwd] ?? null) : null));
 const { info, loading, reload } = useGitInfo(cwd);
 if (!cwd) return null;
 const isRepo = !!info?.isRepo;
 const added = info?.added ?? 0;
 const removed = info?.removed ?? 0;
 const ahead = state?.ahead ?? 0;
 const behind = state?.behind ?? 0;
 const running = task ? isCommitTaskRunning(task.phase) : false;
 const failed = task?.phase === "failed";
 return (
  <PanelSection
   title={t.panelChanges}
   anchor="panel-changes"
   action={
    isRepo ? (
     <button
      onClick={reload}
      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-faint transition-colors duration-100 hover:bg-hover hover:text-foreground"
      aria-label={t.refreshGit}
      title={t.refreshGit}
     >
      <Refresh size={11} aria-hidden />
     </button>
    ) : undefined
   }
  >
   {!info && loading ? (
    <p className="text-[12px] text-faint">{t.panelLoading}</p>
   ) : !isRepo ? (
    <p className="text-[12px] text-faint" title={info?.error ?? undefined}>
     {t.notGitRepo}
    </p>
   ) : (
    <div className="space-y-1.5">
     <div className="flex items-center gap-1.5 text-[12px]">
      <BranchUp size={12} className="shrink-0 text-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground" title={info?.branch ?? undefined}>
       {info?.branch ?? t.panelNoBranch}
       {info?.detached ? ` · ${t.detachedBadge}` : ""}
      </span>
      {(info?.dirty ?? false) && (
       <span className="size-1.5 shrink-0 rounded-full bg-accent" title={t.gitDirtyTitle} aria-label={t.gitDirtyTitle} />
      )}
     </div>
     {(added > 0 || removed > 0) && (
      <div className="flex items-center gap-2 pl-[18px] font-mono text-[12px]">
       {added > 0 && <span className="text-ok">+{added}</span>}
       {removed > 0 && <span className="text-danger">−{removed}</span>}
      </div>
     )}
     {(ahead > 0 || behind > 0) && (
      <div className="flex items-center gap-2 pl-[18px] font-mono text-[11px]">
       {ahead > 0 && (
        <span className="flex items-center gap-0.5 text-accent" title={fmt(t.gitPushTitle, ahead)}>
         <BranchUp size={10} aria-hidden />
         {ahead}
        </span>
       )}
       {behind > 0 && (
        <span className="flex items-center gap-0.5 text-warn" title={fmt(t.gitBehindTitle, behind)}>
         <BranchDown size={10} aria-hidden />
         {behind}
        </span>
       )}
      </div>
     )}
     <div className="flex items-center gap-1.5 pt-0.5">
      <button
       onClick={() => openCommitPanel(cwd)}
       className="flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {running ? (
        <Loader size={11} className="animate-spin" aria-hidden />
       ) : failed ? (
        <span className="size-1.5 rounded-full bg-danger" aria-hidden />
       ) : (
        <Check size={11} aria-hidden />
       )}
       {t.gitCommitTitle}
      </button>
      {ahead > 0 && (
       <button
        onClick={() => pushWorkspace(cwd)}
        className="cursor-pointer rounded-md border border-border px-2 py-1 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
        title={fmt(t.gitPushTitle, ahead)}
       >
        {fmt(t.gitPushTitle, ahead)}
       </button>
      )}
     </div>
    </div>
   )}
  </PanelSection>
 );
}
