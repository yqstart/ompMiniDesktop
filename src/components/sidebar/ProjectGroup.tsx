import { useEffect, useState } from "react";
import { ChevronRight, Clock, DiagramTree, Folder, Nodes } from "reicon-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import type { ProjectView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { openOrFocusWorkspace } from "../../lib/workspaces";
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
      <WorkspaceRow key={ws.path} ws={ws} active={ws.path === activeWorkspacePath} />
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
  </div>
 );
}

/** 一个工作区行：分支名 + 位置徽章；点击 = 打开/聚焦该目录的终端。 */
function WorkspaceRow({ ws, active }: { ws: WorkspaceView; active: boolean }) {
 const t = useText();
 const label = ws.branch ?? (ws.head ? `${t.wsDetached} ${ws.head.slice(0, 7)}` : t.unknownBranch);
 return (
  <button
   onClick={() => openOrFocusWorkspace(ws)}
   disabled={ws.missing}
   title={ws.path}
   aria-current={active ? "location" : undefined}
   className={`flex min-h-8 w-full items-center gap-2 rounded-md border-l-2 px-2 py-1 text-left text-[13px] transition-colors duration-100 ${active ? "border-accent bg-active text-foreground" : "border-transparent text-muted hover:bg-hover hover:text-foreground"
    } ${ws.missing ? "cursor-default opacity-50" : "cursor-pointer"}`}
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
 const [q, setQ] = useState("");
 const [busy, setBusy] = useState(false);
 const ref = useDropdown(true, onClose);

 useEffect(() => {
  let alive = true;
  void api
   .getGitInfo(project.path)
   .then((info) => {
    if (alive) setBranches(info.isRepo ? info.branches : []);
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
   await api.createWorktree(project.id, branch, isNew);
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
