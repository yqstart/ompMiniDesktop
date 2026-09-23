import { useEffect, useState } from "react";
import { AlertTriangle, ArrowUpCircle, BranchDown, BranchUp, Broom, BrowserTerminal, ChevronRight, Clock, DiagramTree, Eraser, Folder, LinkOff, Loader, Nodes, Trash2 } from "reicon-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import type { OrphanWorktree, ProjectView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { loadWorkspaces, openOrFocusWorkspace } from "../../lib/workspaces";
import { countRunningTerminalsIn, countTerminalsIn } from "../../lib/terminalScope";
import { isCommitTaskRunning, openCommitPanel, pushWorkspace, refreshWorkspaceGitState } from "../../lib/commitTasks";
import { ConfirmDialog } from "../ConfirmDialog";
import { useDropdown } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";

/**
 * 左栏项目组（V11）：项目头（折叠 / 会话入口 / 新建 worktree）+ 工作区行列表。
 *
 * 工作区行 = 项目主目录或一个 git worktree；点击 = 打开/聚焦该目录的终端。
 * 目录缺失的项目给一条 warn 行 + 「重定位」（只改覆盖层路径，不动任何会话文件）。
 */
export function ProjectGroup({
 project,
 items,
 onChanged,
 onError,
 onOpenSessions,
}: {
 project: ProjectView;
 items: WorkspaceView[];
 onChanged: () => Promise<void>;
 onError: (message: string) => void;
 onOpenSessions: () => void;
}) {
 const t = useText();
 const [expanded, setExpanded] = useState(true);
 const [wtOpen, setWtOpen] = useState(false);
 const [maintOpen, setMaintOpen] = useState(false);
 const activeWorkspacePath = useApp((s) => s.activeWorkspacePath);

 const relocate = async () => {
  const picked = await open({
   directory: true,
   multiple: false,
   title: fmt(t.relocateDialogTitle, project.name),
  });
  if (typeof picked !== "string" || !picked) return;
  try {
   await api.relocateProject(project.id, picked);
   await onChanged();
  } catch (e) {
   onError(e instanceof Error ? e.message : t.relocateFailed);
  }
 };

 return (
  <div className="relative mb-3">
   <div className="group flex min-h-9 items-center gap-1 rounded-md px-1 py-1 text-[13px] font-semibold text-foreground transition-colors duration-100 hover:bg-hover">
    <button
     onClick={() => setExpanded((v) => !v)}
     className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left"
     aria-expanded={expanded}
     title={project.path}
    >
     <ChevronRight
      size={12}
      aria-hidden
      className={`shrink-0 text-faint transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
     />
     <span className={`flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface ${project.missing ? "text-warn" : "text-muted"}`}>
      <Folder size={14} aria-hidden />
     </span>
     <span className="min-w-0 flex-1 truncate">{project.name}</span>
    </button>
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
     <button
      onClick={onOpenSessions}
      className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      aria-label={t.wsSessionsAria}
      title={t.wsSessionsTitle}
     >
      <Clock size={13} />
     </button>
     <button
      onClick={() => setWtOpen((v) => !v)}
      className={`flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors duration-100 ${wtOpen ? "bg-active text-accent" : "text-muted hover:bg-hover hover:text-foreground"}`}
      aria-label={t.wsNewWorktree}
      title={t.wsNewWorktreeTitle}
      aria-expanded={wtOpen}
     >
      <Nodes size={13} />
     </button>
     <button
      onClick={() => setMaintOpen((v) => !v)}
      className={`flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors duration-100 ${maintOpen ? "bg-active text-accent" : "text-muted hover:bg-hover hover:text-foreground"}`}
      aria-label={t.gitProjectMenu}
      title={t.gitProjectMenu}
      aria-expanded={maintOpen}
     >
      <Broom size={13} />
     </button>
    </span>
   </div>

   {project.missing && (
    <div className="ml-5 mt-1 flex items-start gap-2 rounded-md border border-warn/20 bg-warn/5 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
     <span className="min-w-0 flex-1">{t.missingFolderHint}</span>
     <button
      onClick={() => void relocate()}
      className="shrink-0 cursor-pointer rounded-sm border border-warn/40 px-1.5 py-0.5 transition-colors duration-100 hover:bg-warn/15"
      aria-label={fmt(t.relocateAria, project.name)}
      title={t.relocateTitle}
     >
      {t.relocate}
     </button>
    </div>
   )}

   {expanded && (
    <div className="ml-5 mt-1 space-y-1 border-l border-border-soft pl-2">
     {items.map((ws) => (
      <WorkspaceRow key={ws.path} ws={ws} active={ws.path === activeWorkspacePath} onError={onError} />
     ))}
     {items.length === 0 && !project.missing && (
      <p className="px-2 py-2 text-[11px] text-faint">{t.unknownBranch}</p>
     )}
    </div>
   )}

   {wtOpen && (
    <WorktreePanel
     project={project}
     taken={items.map((w) => w.branch).filter((b): b is string => !!b)}
     onDone={onChanged}
     onError={onError}
     onClose={() => setWtOpen(false)}
    />
   )}

   {maintOpen && (
    <MaintenancePanel project={project} onError={onError} onClose={() => setMaintOpen(false)} />
   )}
  </div>
 );
}

/** 一个工作区行：分支名 + 位置徽章 + git 状态（改动点 / 领先·落后远程徽章 / 上游缺失标记）+ 任务徽章；
 *  hover 出现「提交…」（打开提交面板）与 worktree 行的「删除」按钮。点击行 = 打开/聚焦该目录的终端。
 *
 *  状态区顺序固定为：终端数（`BrowserTerminal` + 数量，有运行中的上强调色；右栏只看当前工作区，
 *  这个徽章是「别的分支还开着几个」的提示）→ dirty 点 → 领先（BranchUp ↑，可点=推）→
 *  落后（BranchDown ↓，只读）→ 上游缺失（LinkOff：无上游 / 上游已被删除）→ 任务徽章
 *  （运行中 / 失败；点击开任务浮层）；有任务记录时 hover 按钮让位（任务态优先，处理入口在浮层里）。
 *
 *  删除语义（V19）：先探脏（后端 `WORKTREE_DIRTY`）→ 弹二次确认（文案带变更文件数）→ 带 `force` 重删；
 *  有终端开在该目录时直接拒绝（终端表在前端，Rust 侧看不到）。主目录不给删除入口。 */
function WorkspaceRow({
 ws,
 active,
 onError,
}: {
 ws: WorkspaceView;
 active: boolean;
 onError: (message: string) => void;
}) {
 const t = useText();
 const [wtBusy, setWtBusy] = useState(false);
 const [wtDirtyNote, setWtDirtyNote] = useState<string | null>(null);
 const gitState = useApp((s) => s.workspaceGitStates[ws.path]);
 const task = useApp((s) => s.commitTasks[ws.path]);
 // 右栏终端视图只显示当前工作区的终端，这里的徽章是「别的分支还开着几个」的入口提示
 const termCount = useApp((s) => countTerminalsIn(s.terminals, ws.path));
 const runningTerms = useApp((s) => countRunningTerminalsIn(s.terminals, ws.path));
 const termBadge = termCount === 0
  ? null
  : runningTerms > 0
   ? fmt(t.wsTerminalsRunning, termCount, runningTerms)
   : fmt(t.wsTerminals, termCount);
 const label = ws.branch ?? (ws.head ? `${t.wsDetached} ${ws.head.slice(0, 7)}` : t.unknownBranch);

 const running = task ? isCommitTaskRunning(task.phase) : false;
 const failed = task?.phase === "failed";
 const repoKnown = gitState !== undefined;
 const notRepo = gitState?.isRepo === false;
 const dirty = gitState?.isRepo === true && gitState.dirty;
 const ahead = gitState?.isRepo === true ? gitState.ahead : 0;
 const behind = gitState?.isRepo === true ? gitState.behind : 0;
 // 上游缺失提示：没有上游 / 上游已被远程删除 → 与远程**无法比较**，不能留白（否则会被读成「与远程一致」）。
 // 正常上游返回 null——差异由 ahead / behind 徽章表达；detached（没有分支名）与非仓库不标。
 const upstreamNote =
  gitState?.isRepo === true && ws.branch !== null
   ? gitState.upstreamGone
    ? fmt(t.gitUpstreamGoneTitle, gitState.upstream ?? "")
    : gitState.upstream === null
     ? t.gitNoUpstreamTitle
     : null
   : null;
 // 入口可用性：有改动（可提交）或 ahead / 无上游（可推送）才给按钮；干净且同步 = 没东西可做。
 // 快照未知（还没拉到）时不拦——面板里的变更集与暂存校验才是最终裁决。
 const hasNothing = repoKnown && !notRepo && !dirty && ahead === 0 && gitState.upstream !== null;
 const canStart = !notRepo && !hasNothing;
 const startTitle = notRepo ? t.gitCommitNotRepo : hasNothing ? t.gitCommitDisabledTitle : t.gitCommitTitle;

 // 删除 worktree：终端占用先拒（前端才知道终端表），再走后端「探脏 → 确认 → force」
 const removeWorktree = async (force: boolean) => {
  const busy = useApp
   .getState()
   .terminals.some((term) => term.cwd === ws.path || term.cwd.startsWith(`${ws.path}/`));
  if (busy) {
   onError(t.gitWorktreeBusy);
   return;
  }
  setWtBusy(true);
  try {
   await api.removeWorktree(ws.projectId, ws.path, force);
   setWtDirtyNote(null);
   await loadWorkspaces();
   void refreshWorkspaceGitState();
  } catch (e) {
   const code = (e as { cause?: { code?: string } }).cause?.code;
   if (!force && code === "WORKTREE_DIRTY") {
    // 脏目录：把后端给的那句话（带变更文件数）原样拿去做二次确认
    setWtDirtyNote(e instanceof Error ? e.message.split("\n")[0] : t.gitWorktreeDirtyConfirm);
   } else {
    onError(e instanceof Error ? e.message : t.gitWorktreeRemoveFailed);
   }
  } finally {
   setWtBusy(false);
  }
 };

 return (
  <div
   title={ws.path}
   aria-current={active ? "location" : undefined}
   className={`group/row flex min-h-8 w-full items-center rounded-md border-l-2 text-[13px] transition-colors duration-100 ${active ? "border-accent bg-active text-foreground" : "border-transparent text-muted hover:bg-hover hover:text-foreground"
    } ${ws.missing ? "opacity-50" : ""}`}
  >
   <button
    onClick={() => openOrFocusWorkspace(ws)}
    disabled={ws.missing}
    className={`flex min-w-0 flex-1 items-center gap-2 py-1 pl-2 text-left ${ws.missing ? "cursor-default" : "cursor-pointer"}`}
   >
    <span className={`flex size-5 shrink-0 items-center justify-center ${ws.isMain || active ? "text-accent" : "text-faint"}`}>
     <DiagramTree size={13} aria-hidden />
    </span>
    <span className={`min-w-0 flex-1 truncate font-mono ${active ? "font-semibold" : ""}`}>{label}</span>
    {!ws.isMain && (
     <span className="shrink-0 rounded-sm border border-border-soft bg-surface/60 px-1.5 py-px text-[10px] leading-4 text-faint">
      worktree
     </span>
    )}
   </button>

   <span className="flex shrink-0 items-center gap-1 pr-1.5">
    {termBadge && (
     <span
      title={termBadge}
      aria-label={termBadge}
      className={`flex h-5 items-center gap-0.5 px-0.5 ${runningTerms > 0 ? "text-accent" : "text-faint"}`}
     >
      <BrowserTerminal size={11} aria-hidden />
      <span className="font-mono text-[10px] leading-none">{termCount}</span>
     </span>
    )}
    {dirty && <span className="size-1.5 rounded-full bg-accent" title={t.gitDirtyTitle} aria-label={t.gitDirtyTitle} />}
    {ahead > 0 && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       pushWorkspace(ws.path);
      }}
      title={fmt(t.gitPushTitle, ahead)}
      aria-label={fmt(t.gitPushTitle, ahead)}
      className="flex h-5 cursor-pointer items-center gap-0.5 rounded-sm px-0.5 text-accent transition-colors duration-100 hover:bg-hover"
     >
      <BranchUp size={11} aria-hidden />
      <span className="font-mono text-[10px] leading-none">{ahead}</span>
     </button>
    )}
    {behind > 0 && (
     <span
      title={fmt(t.gitBehindTitle, behind)}
      aria-label={fmt(t.gitBehindTitle, behind)}
      className="flex h-5 items-center gap-0.5 px-0.5 text-warn"
     >
      <BranchDown size={11} aria-hidden />
      <span className="font-mono text-[10px] leading-none">{behind}</span>
     </span>
    )}
    {upstreamNote && (
     <span title={upstreamNote} aria-label={upstreamNote} className="flex size-5 items-center justify-center text-faint">
      <LinkOff size={12} aria-hidden />
     </span>
    )}
    {running && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       useApp.getState().setActiveCommitCwd(ws.path);
      }}
      title={t.gitRunningTitle}
      aria-label={t.gitRunningTitle}
      className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-accent transition-colors duration-100 hover:bg-hover"
     >
      <Loader size={12} aria-hidden className="animate-spin" />
     </button>
    )}
    {failed && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       useApp.getState().setActiveCommitCwd(ws.path);
      }}
      title={t.gitFailedTitle}
      aria-label={t.gitFailedTitle}
      className="flex size-5 cursor-pointer items-center justify-center rounded-sm text-danger transition-colors duration-100 hover:bg-hover"
     >
      <AlertTriangle size={12} aria-hidden />
     </button>
    )}
    {!task && !ws.missing && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       openCommitPanel(ws.path);
      }}
      disabled={!canStart}
      title={startTitle}
      aria-label={startTitle}
      className={`flex size-5 items-center justify-center rounded-sm opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 ${canStart ? "cursor-pointer text-muted hover:bg-hover hover:text-foreground" : "cursor-not-allowed text-faint"
       }`}
     >
      <ArrowUpCircle size={13} aria-hidden />
     </button>
    )}
    {!ws.isMain && !ws.missing && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       void removeWorktree(false);
      }}
      disabled={wtBusy}
      title={t.gitWorktreeRemoveTitle}
      aria-label={t.gitWorktreeRemove}
      className="flex size-5 items-center justify-center rounded-sm text-muted opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 hover:bg-hover hover:text-danger disabled:cursor-not-allowed disabled:opacity-40"
     >
      <Trash2 size={12} aria-hidden />
     </button>
    )}
   </span>

   <ConfirmDialog
    open={wtDirtyNote !== null}
    danger
    title={t.gitConfirmTitle}
    detail={wtDirtyNote ?? ""}
    confirmLabel={t.gitConfirmDelete}
    cancelLabel={t.gitConfirmCancel}
    onConfirm={() => {
     setWtDirtyNote(null);
     void removeWorktree(true);
    }}
    onCancel={() => setWtDirtyNote(null)}
   />
  </div>
 );
}

/**
 * 项目维护面板（V19）：两件与 worktree 登记有关的清理动作，都只动「已经无效」的条目。
 *
 * - 「清理失效登记」= `git worktree prune -v`：目录已被手工删掉、git 还记着的那些（本项目）；
 * - 「清理孤儿 worktree」= `omp worktree clear`：`~/.omp/wt` 下的孤儿条目（**全局**，不限于本项目，
 *   所以确认框里写明了范围）；打开面板时才去数，没勾选就不打扰。
 */
function MaintenancePanel({
 project,
 onError,
 onClose,
}: {
 project: ProjectView;
 onError: (message: string) => void;
 onClose: () => void;
}) {
 const t = useText();
 const [orphans, setOrphans] = useState<OrphanWorktree[] | null>(null);
 const [busy, setBusy] = useState(false);
 const [note, setNote] = useState<string | null>(null);
 const [confirmOrphans, setConfirmOrphans] = useState(false);
 const ref = useDropdown(true, onClose);

 useEffect(() => {
  let alive = true;
  void api
   .listOrphanWorktrees()
   .then((list) => {
    if (alive) setOrphans(list);
   })
   .catch(() => {
    if (alive) setOrphans([]);
   });
  return () => {
   alive = false;
  };
 }, []);

 const prune = async () => {
  setBusy(true);
  try {
   const lines = await api.pruneWorktrees(project.id);
   setNote(lines.length > 0 ? fmt(t.gitPruneDone, lines.length) : t.gitPruneNone);
  } catch (e) {
   onError(e instanceof Error ? e.message : t.gitPrune);
  } finally {
   setBusy(false);
  }
 };

 const clearOrphans = async () => {
  setConfirmOrphans(false);
  setBusy(true);
  try {
   const result = await api.clearOrphanWorktrees();
   setOrphans([]);
   setNote(
    result.failed > 0
     ? `${fmt(t.gitOrphansDone, result.removed)} · ${fmt(t.gitOrphansFailed, result.failed)}`
     : fmt(t.gitOrphansDone, result.removed),
   );
  } catch (e) {
   onError(e instanceof Error ? e.message : t.gitOrphans);
  } finally {
   setBusy(false);
  }
 };

 const orphanCount = orphans?.length ?? 0;

 return (
  <div
   ref={ref}
   className="absolute left-0 right-0 top-full z-20 mt-2 rounded-lg border border-border bg-elevated p-3 shadow-pop"
  >
   <button
    type="button"
    disabled={busy}
    onClick={() => void prune()}
    className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
   >
    <Eraser size={12} aria-hidden className="shrink-0 text-faint" />
    <span className="min-w-0 flex-1 truncate">{t.gitPrune}</span>
   </button>
   <button
    type="button"
    disabled={busy || orphans === null || orphanCount === 0}
    onClick={() => setConfirmOrphans(true)}
    className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
   >
    <Broom size={12} aria-hidden className="shrink-0 text-faint" />
    <span className="min-w-0 flex-1 truncate">
     {orphans === null ? t.gitOrphansLoading : orphanCount === 0 ? t.gitOrphansNone : `${t.gitOrphans}（${orphanCount}）`}
    </span>
   </button>
   {orphanCount > 0 && (
    <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto rounded-md border border-border-soft bg-surface/40 p-1.5">
     {orphans?.map((orphan) => (
      <li key={orphan.path} className="min-w-0 text-[11px] leading-4">
       <div className="truncate font-mono text-muted" title={orphan.path}>
        {orphan.path}
       </div>
       <div className="truncate text-faint" title={orphan.orphanReason}>
        {orphan.orphanReason}
        {orphan.parentRepo ? ` · ${orphan.parentRepo}` : ""}
       </div>
      </li>
     ))}
    </ul>
   )}
   {note && <p className="mt-2 text-[11px] leading-4 text-ok">{note}</p>}

   <ConfirmDialog
    open={confirmOrphans}
    danger
    title={t.gitOrphans}
    detail={fmt(t.gitOrphansConfirm, orphanCount)}
    confirmLabel={t.gitConfirmDelete}
    cancelLabel={t.gitConfirmCancel}
    onConfirm={() => void clearOrphans()}
    onCancel={() => setConfirmOrphans(false)}
   />
  </div>
 );
}

/**
 * 「新建 worktree」面板：输入过滤本地分支 + 「新建分支」选项。
 * 候选只列**未被任何工作区检出**的分支（已检出的在树里已经有一行）。
 * 创建走 `omp worktree add`（clone-first + `~/.omp/wt` 管理目录都是 omp 的既有约定）。
 */
function WorktreePanel({
 project,
 taken,
 onDone,
 onError,
 onClose,
}: {
 project: ProjectView;
 taken: string[];
 onDone: () => Promise<void>;
 onError: (message: string) => void;
 onClose: () => void;
}) {
 const t = useText();
 const [branches, setBranches] = useState<string[] | null>(null);
 const [remoteDefault, setRemoteDefault] = useState<string | null>(null);
 const [base, setBase] = useState<"head" | "remote">("head");
 const [q, setQ] = useState("");
 const [busy, setBusy] = useState(false);
 const ref = useDropdown(true, onClose);

 useEffect(() => {
  let alive = true;
  void api
   .getGitInfo(project.path)
   .then((info) => {
    if (!alive) return;
    setBranches(info.isRepo ? info.branches : []);
    setRemoteDefault(info.isRepo ? info.remoteDefault : null);
   })
   .catch(() => {
    if (alive) setBranches([]);
   });
  return () => {
   alive = false;
  };
 }, [project.path]);

 const takenSet = new Set(taken);
 const query = q.trim();
 const queryLower = query.toLowerCase();
 const candidates = (branches ?? [])
  .filter((b) => !takenSet.has(b))
  .filter((b) => !queryLower || b.toLowerCase().includes(queryLower));
 const canCreate = query.length > 0 && !takenSet.has(query) && !(branches ?? []).includes(query);

 const create = async (branch: string, isNew: boolean) => {
  setBusy(true);
  try {
   // 基线只在新建分支时有意义：`"remote"` = 后端先 fetch 再基于远端默认分支的最新
   await api.createWorktree(project.id, branch, isNew, isNew && base === "remote" ? "remote" : null);
   await onDone();
   onClose();
  } catch (e) {
   onError(e instanceof Error ? e.message : t.wsCreateFailed);
  } finally {
   setBusy(false);
  }
 };

 return (
  <div
   ref={ref}
   className="absolute left-0 right-0 top-full z-20 mt-2 rounded-lg border border-border bg-elevated p-3 shadow-pop"
  >
   <input
    autoFocus
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder={t.wsBranchPlaceholder}
    aria-label={t.wsBranchPlaceholder}
    disabled={busy}
    className="mb-2 h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent disabled:opacity-50"
   />
   {canCreate && remoteDefault && (
    <div className="mb-2 flex items-center justify-between gap-3">
     <span className="text-[12px] text-muted">{t.gitBaseLabel}</span>
     <div
      role="radiogroup"
      aria-label={t.gitBaseLabel}
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-border bg-surface/60 p-0.5"
     >
      {(["head", "remote"] as const).map((value) => {
       const selected = value === base;
       const label = value === "head" ? t.gitBaseHead : fmt(t.gitBaseRemote, remoteDefault);
       return (
        <button
         key={value}
         type="button"
         role="radio"
         aria-checked={selected}
         disabled={busy}
         onClick={() => setBase(value)}
         title={label}
         className={`h-6 cursor-pointer rounded-sm px-2 text-[11px] transition-colors duration-100 ${
          selected ? "bg-active text-accent" : "text-muted hover:bg-hover hover:text-foreground"
         } disabled:cursor-not-allowed disabled:opacity-40`}
        >
         {label}
        </button>
       );
      })}
     </div>
    </div>
   )}
   <div className="max-h-44 space-y-1 overflow-y-auto">
    {canCreate && (
     <button
      onClick={() => void create(query, true)}
      disabled={busy}
      className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-accent transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     >
      <Nodes size={12} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{fmt(t.wsBranchNew, query)}</span>
     </button>
    )}
    {branches === null && <p className="px-2 py-1.5 text-[12px] text-faint">…</p>}
    {candidates.map((b) => (
     <button
      key={b}
      onClick={() => void create(b, false)}
      disabled={busy}
      className="flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50"
     >
      <DiagramTree size={13} aria-hidden className="shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate font-mono">{b}</span>
     </button>
    ))}
    {branches !== null && candidates.length === 0 && !canCreate && (
     <p className="px-2 py-1.5 text-[12px] text-faint">{t.noBranches}</p>
    )}
   </div>
  </div>
 );
}
