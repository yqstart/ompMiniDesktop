import { useState } from "react";
import { AlertTriangle, ArrowUpCircle, BranchDown, BranchUp, BrowserTerminal, Clock, DiagramTree, Folder, LinkOff, Loader, Trash2 } from "reicon-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import type { CheckoutView, ProjectView } from "@shared/types";
import { useApp } from "../../stores/app";
import { openOrFocusCheckout } from "../../lib/checkouts";
import { countRunningTerminalsIn, countTerminalsIn } from "../../lib/terminalScope";
import { isCommitTaskRunning, openCommitPanel, pushWorkspace } from "../../lib/commitTasks";
import { ConfirmDialog } from "../ConfirmDialog";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";

/**
 * 左栏项目组：项目头（折叠 / 会话入口 / 移除项目）+ **目录行**列表（主目录 + git worktree）。
 *
 * 目录行（V21 前叫「工作区行」）= 项目主目录或一个 git worktree（**只读展示**：壳侧不创建 /
 * 不删除 worktree，要建要走 `omp worktree add`）；点击行 = 打开/聚焦该目录的终端。
 * 折叠头没有独立箭头：点击（拖柄区，未拖动时）即展开/收起；文件夹图标 = 展开状态与「当前打开
 * 的项目」（项目落在右栏选中范围里）的高亮——两者任一成立用强调色，缺失目录优先 warn。
 * 目录缺失的项目给一条 warn 行 + 「重定位」（只改覆盖层路径，不动任何会话文件）。
 * 「移除项目」= 覆盖层解绑（后端把该项目会话标记为已归档，不删任何文件），走二次确认。
 */
export function ProjectGroup({
 project,
 items,
 dragging,
 onChanged,
 onError,
 onOpenSessions,
 onDragStart,
}: {
 project: ProjectView;
 items: CheckoutView[];
 /** 这个项目正在被拖拽（留在原地但压暗；落点由指示线表达）。 */
 dragging: boolean;
 onChanged: () => Promise<void>;
 onError: (message: string) => void;
 onOpenSessions: () => void;
 /** 项目头按下（左键）：由左栏的拖拽控制器决定何时真的开始拖（移动超过阈值才算）。 */
 onDragStart: (projectId: string, e: React.PointerEvent<HTMLElement>) => void;
}) {
 const t = useText();
 const [expanded, setExpanded] = useState(true);
 const [removeOpen, setRemoveOpen] = useState(false);
 const selection = useApp((s) => s.selection);
 // 「当前打开的项目」：项目落在右栏当前选中范围里——
 // 工作区视图（含未分组）= 项目的 workspaceId 命中；目录视图 = 它的某个目录被选中。
 const projectActive = selection?.kind === "group"
  ? project.workspaceId === selection.id
  : selection?.kind === "checkout"
   ? items.some((ws) => ws.path === selection.path)
   : false;

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

 const removeProject = async () => {
  try {
   await api.removeProject(project.id);
   await onChanged();
  } catch (e) {
   onError(e instanceof Error ? e.message : t.projRemoveFailed);
  }
 };

 return (
  <div
   className={`relative mb-3 transition-opacity duration-100 ${dragging ? "opacity-40" : ""}`}
   data-proj-row={project.id}
  >
   <div className="group flex min-h-9 items-center gap-1 rounded-md px-1 py-1 text-[13px] font-semibold text-foreground transition-colors duration-100 hover:bg-hover">
    <button
     data-project-drag
     onPointerDown={(e) => onDragStart(project.id, e)}
     onClick={() => setExpanded((v) => !v)}
     className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md text-left"
     aria-expanded={expanded}
     title={`${project.path}\n${t.projDragHint}`}
    >
     <span className={`flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface ${project.missing ? "text-warn" : projectActive || expanded ? "text-accent" : "text-muted"}`}>
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
      onClick={() => setRemoveOpen(true)}
      className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-danger"
      aria-label={t.projRemove}
      title={t.projRemove}
     >
      <Trash2 size={13} />
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
      <CheckoutRow key={ws.path} ws={ws} active={selection?.kind === "checkout" && ws.path === selection.path} />
     ))}
     {items.length === 0 && !project.missing && (
      <p className="px-2 py-2 text-[11px] text-faint">{t.unknownBranch}</p>
     )}
    </div>
   )}

   <ConfirmDialog
    open={removeOpen}
    danger
    title={fmt(t.projRemoveTitle, project.name)}
    detail={t.projRemoveBody}
    confirmLabel={t.projRemoveConfirm}
    cancelLabel={t.projRemoveCancel}
    onConfirm={() => {
     setRemoveOpen(false);
     void removeProject();
    }}
    onCancel={() => setRemoveOpen(false)}
   />
  </div>
 );
}

/** 一个目录行：分支名 + 位置徽章 + git 状态（改动点 / 领先·落后远程徽章 / 上游缺失标记）+ 任务徽章；
 *  hover 出现「提交…」（打开提交面板）。点击行 = 打开/聚焦该目录的终端。
 *
 *  **行标记**（同款：左侧 2px 强调竖条 + `bg-active` 填充 + 加粗分支名 + `aria-current`）两处来源：
 *  ①选中（目录视图的范围真相）；②**承载激活终端**——工作区视图下选中态在组头上，这一处是唯一能
 *  回答「现在这个终端在哪个项目的哪个分支」的信号（点组内终端不缩窄视图，V21 口径）。
 *
 *  状态区顺序固定为：终端数（`BrowserTerminal` + 数量，有运行中的上强调色；右栏只看当前选中范围，
 *  这个徽章是「别的分支还开着几个」的提示）→ dirty 点 → 领先（BranchUp ↑，可点=推）→
 *  落后（BranchDown ↓，只读）→ 上游缺失（LinkOff：无上游 / 上游已被删除）→ 任务徽章
 *  （运行中 / 失败；点击开任务浮层）；有任务记录时 hover 按钮让位（任务态优先，处理入口在浮层里）。 */
function CheckoutRow({
 ws,
 active,
}: {
 ws: CheckoutView;
 active: boolean;
}) {
 const t = useText();
 const gitState = useApp((s) => s.workspaceGitStates[ws.path]);
 const task = useApp((s) => s.commitTasks[ws.path]);
 // 右栏终端视图只显示当前工作区的终端，这里的徽章是「别的分支还开着几个」的入口提示
 const termCount = useApp((s) => countTerminalsIn(s.terminals, ws.path));
 const runningTerms = useApp((s) => countRunningTerminalsIn(s.terminals, ws.path));
 // 「终端在这里」：激活终端正落在本目录（工作区视图下凭它定位当前会话的分支；目录视图下与选中行重合）
 const hostsActiveTerminal = useApp((s) => s.terminals.find((t) => t.id === s.activeTerminalId)?.cwd === ws.path);
 const marked = active || hostsActiveTerminal;
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

 return (
  <div
   title={ws.path}
   aria-current={marked ? "location" : undefined}
   className={`group/row flex min-h-8 w-full items-center rounded-md border-l-2 text-[13px] transition-colors duration-100 ${marked ? "border-accent bg-active text-foreground" : "border-transparent text-muted hover:bg-hover hover:text-foreground"
    } ${ws.missing ? "opacity-50" : ""}`}
  >
   <button
    onClick={() => openOrFocusCheckout(ws)}
    disabled={ws.missing}
    className={`flex min-w-0 flex-1 items-center gap-2 py-1 pl-2 text-left ${ws.missing ? "cursor-default" : "cursor-pointer"}`}
   >
    <span className={`flex size-5 shrink-0 items-center justify-center rounded-sm bg-surface ${ws.isMain || marked ? "text-accent" : "text-faint"}`}>
     <DiagramTree size={13} aria-hidden />
    </span>
    <span className={`min-w-0 flex-1 truncate font-mono ${marked ? "font-semibold" : ""}`}>{label}</span>
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
      className={`flex h-5 items-center gap-0.5 rounded-sm bg-surface px-1 ${runningTerms > 0 ? "text-accent" : "text-faint"}`}
     >
      <BrowserTerminal size={11} aria-hidden />
      <span className="font-mono text-[10px] leading-none">{termCount}</span>
     </span>
    )}
    {dirty && (
     <span className="flex size-5 items-center justify-center rounded-sm bg-surface" title={t.gitDirtyTitle} aria-label={t.gitDirtyTitle}>
      <span className="size-1.5 rounded-full bg-accent" aria-hidden />
     </span>
    )}
    {ahead > 0 && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       pushWorkspace(ws.path);
      }}
      title={fmt(t.gitPushTitle, ahead)}
      aria-label={fmt(t.gitPushTitle, ahead)}
      className="flex h-5 cursor-pointer items-center gap-0.5 rounded-sm bg-surface px-1 text-accent transition-colors duration-100 hover:bg-hover"
     >
      <BranchUp size={11} aria-hidden />
      <span className="font-mono text-[10px] leading-none">{ahead}</span>
     </button>
    )}
    {behind > 0 && (
     <span
      title={fmt(t.gitBehindTitle, behind)}
      aria-label={fmt(t.gitBehindTitle, behind)}
      className="flex h-5 items-center gap-0.5 rounded-sm bg-surface px-1 text-warn"
     >
      <BranchDown size={11} aria-hidden />
      <span className="font-mono text-[10px] leading-none">{behind}</span>
     </span>
    )}
    {upstreamNote && (
     <span title={upstreamNote} aria-label={upstreamNote} className="flex size-5 items-center justify-center rounded-sm bg-surface text-faint">
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
      className="flex size-5 cursor-pointer items-center justify-center rounded-sm bg-surface text-accent transition-colors duration-100 hover:bg-hover"
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
      className="flex size-5 cursor-pointer items-center justify-center rounded-sm bg-surface text-danger transition-colors duration-100 hover:bg-hover"
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
      className={`flex size-5 items-center justify-center rounded-sm bg-surface opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 ${canStart ? "cursor-pointer text-muted hover:bg-hover hover:text-foreground" : "cursor-not-allowed text-faint"
       }`}
     >
      <ArrowUpCircle size={13} aria-hidden />
     </button>
    )}
   </span>
  </div>
 );
}
