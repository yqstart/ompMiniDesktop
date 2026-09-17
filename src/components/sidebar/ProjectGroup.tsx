import { useEffect, useState } from "react";
import { ChevronRight, Clock, Folder, Nodes } from "reicon-react";
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
  <div className="relative mb-1">
   <div className="group flex items-center rounded-md px-1 py-1 text-[13px] font-semibold text-muted transition-colors duration-100 hover:bg-hover">
    <button
     onClick={() => setExpanded((v) => !v)}
     className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
     aria-expanded={expanded}
    >
     <ChevronRight
      size={12}
      aria-hidden
      className={`shrink-0 transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}
     />
     <Folder size={13} aria-hidden className="shrink-0 text-faint" />
     <span className="min-w-0 flex-1 truncate">{project.name}</span>
     {project.missing && <span className="shrink-0 text-[10px] text-warn">{t.missingFolder}</span>}
    </button>
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
     <button
      onClick={onOpenSessions}
      className="flex size-6 cursor-pointer items-center justify-center rounded text-muted transition-colors duration-100 hover:bg-active hover:text-foreground"
      aria-label={t.wsSessionsAria}
      title={t.wsSessionsTitle}
     >
      <Clock size={13} />
     </button>
     <button
      onClick={() => setWtOpen((v) => !v)}
      className="flex size-6 cursor-pointer items-center justify-center rounded text-muted transition-colors duration-100 hover:bg-active hover:text-foreground"
      aria-label={t.wsNewWorktree}
      title={t.wsNewWorktreeTitle}
     >
      <Nodes size={13} />
     </button>
    </span>
   </div>

   {project.missing && (
    <div className="mt-0.5 flex items-center gap-1.5 px-2.5 py-1 text-[11px] text-warn">
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
    <div className="mt-0.5 space-y-px border-l border-border-soft pl-1.5">
     {items.map((ws) => (
      <WorkspaceRow key={ws.path} ws={ws} active={ws.path === activeWorkspacePath} />
     ))}
     {items.length === 0 && !project.missing && (
      <p className="px-2.5 py-1 text-[11px] text-faint">{t.unknownBranch}</p>
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
   className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12.5px] transition-colors duration-100 ${active ? "bg-active text-foreground" : "text-muted hover:bg-hover hover:text-foreground"
    } ${ws.missing ? "cursor-default opacity-50" : "cursor-pointer"}`}
  >
   <span
    aria-hidden
    className={`size-1.5 shrink-0 rounded-full ${ws.isMain ? "bg-accent" : "bg-faint"}`}
   />
   <span className="min-w-0 flex-1 truncate font-mono">{label}</span>
   {!ws.isMain && (
    <span className="shrink-0 rounded border border-border-soft px-1 py-px text-[10px] text-faint">
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
   className="absolute left-2 right-2 top-full z-20 mt-1 rounded-lg border border-border bg-elevated p-2 shadow-pop"
  >
   <input
    autoFocus
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder={t.wsBranchPlaceholder}
    disabled={busy}
    className="mb-1.5 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-[12px] outline-none focus:border-accent disabled:opacity-50"
   />
   <div className="max-h-44 overflow-y-auto">
    {canCreate && (
     <button
      onClick={() => void create(query, true)}
      disabled={busy}
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-accent transition-colors duration-100 hover:bg-hover disabled:opacity-50"
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
      className="flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50"
     >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-faint" />
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
