import { useEffect, useState } from "react";
import { X } from "reicon-react";
import { api } from "@shared/api";
import type { ProjectView, SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { resumeSessionInTerminal } from "../../lib/workspaces";
import { useText } from "../../lib/useText";
import { TEXT, fmt } from "../../lib/locale";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * 项目会话弹窗（V11）：列一个项目（含其 worktree）的全部会话。
 *
 * - 点击行 = 在新终端里 `omp --resume` 接着聊（cwd 用会话原目录）；
 * - 行内「归档 / 恢复」直发（写覆盖层，不碰 jsonl）；「删除」走二次确认（真删文件，不可恢复）；
 * - 数据 = `list_sessions`（归属已含 worktree）；挂载方用 `key={project.id}` 保证换项目即重挂载。
 */
export function SessionPopup({
 project,
 onClose,
}: {
 project: ProjectView;
 onClose: () => void;
}) {
 const t = useText();
 const locale = useApp((s) => s.locale);
 const [sessions, setSessions] = useState<SessionView[] | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [deleteTarget, setDeleteTarget] = useState<SessionView | null>(null);
 const [busyId, setBusyId] = useState<string | null>(null);

 useEffect(() => {
  let alive = true;
  void api
   .listSessions(project.id)
   .then((page) => {
    if (alive) setSessions(page.sessions);
   })
   .catch((e) => {
    if (!alive) return;
    setSessions([]);
    setError(e instanceof Error ? e.message : TEXT[useApp.getState().locale].sessLoadFailed);
   });
  return () => {
   alive = false;
  };
 }, [project]);

 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (e.key === "Escape") onClose();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
 }, [onClose]);

 const refresh = async () => {
  try {
   const page = await api.listSessions(project.id);
   setSessions(page.sessions);
  } catch {
   // 刷新失败保留旧列表（写操作本身已成功）
  }
 };

 const runAction = async (id: string, act: () => Promise<string | null>) => {
  setBusyId(id);
  setError(null);
  try {
   const failed = await act();
   if (failed) setError(failed);
   await refresh();
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e));
  } finally {
   setBusyId(null);
  }
 };

 const toggleArchive = (s: SessionView) =>
  runAction(s.id, async () => {
   const res = s.archived ? await api.unarchiveSessions([s.id]) : await api.archiveSessions([s.id]);
   return res.failed.length > 0 ? res.failed[0].message || null : null;
  });

 const doDelete = async () => {
  if (!deleteTarget) return;
  await runAction(deleteTarget.id, async () => {
   const res = await api.deleteSessions([deleteTarget.id]);
   return res.failed.length > 0 ? res.failed[0].message || null : null;
  });
  setDeleteTarget(null);
 };

 return (
  <>
   <div
    className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4"
    onClick={onClose}
   >
    <div
     role="dialog"
     aria-modal="true"
     aria-label={fmt(t.sessTitleOf, project.name)}
     className="flex max-h-[70vh] w-full max-w-lg flex-col rounded-lg border border-border bg-elevated shadow-pop"
     onClick={(e) => e.stopPropagation()}
    >
     <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
      <div className="min-w-0 flex-1">
       <div className="truncate text-sm font-medium">{fmt(t.sessTitleOf, project.name)}</div>
       <div className="truncate font-mono text-[11px] text-faint">{project.path}</div>
      </div>
      <button
       onClick={onClose}
       className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
       aria-label={t.close}
      >
       <X size={14} />
      </button>
     </div>
     {error && (
      <div className="mx-4 mt-2 shrink-0 rounded-md bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger">
       {error}
      </div>
     )}
     <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
      {sessions === null && <p className="px-2.5 py-2 text-[12px] text-faint">{t.sessLoading}</p>}
      {sessions?.length === 0 && (
       <p className="px-2.5 py-2 text-[12px] text-faint">{t.sessEmpty}</p>
      )}
      {sessions?.map((s) => (
       <div
        key={s.id}
        className="group flex items-center gap-2 rounded-md px-2.5 py-1.5 transition-colors duration-100 hover:bg-hover"
       >
        <button
         onClick={() => {
          resumeSessionInTerminal({ id: s.id, cwd: s.cwd, title: s.title, projectId: s.projectId });
          onClose();
         }}
         disabled={s.corrupt || busyId === s.id}
         title={t.sessResumeHint}
         className="min-w-0 flex-1 cursor-pointer text-left disabled:cursor-default disabled:opacity-50"
        >
         <div className="truncate text-[13px]">{s.title}</div>
         <div className="flex items-center gap-1.5 text-[11px] text-faint">
          <span className="font-mono">
           {new Date(s.timestamp).toLocaleString(locale, {
            month: "numeric",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
           })}
          </span>
          {s.archived && <span className="rounded border border-border-soft px-1">{t.archivedTag}</span>}
          {s.corrupt && <span className="text-warn">{t.corrupt}</span>}
         </div>
        </button>
        <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
         <button
          onClick={() => void toggleArchive(s)}
          disabled={busyId === s.id}
          className="cursor-pointer rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-active hover:text-foreground disabled:opacity-40"
         >
          {s.archived ? t.archivedRestore : t.sessArchive}
         </button>
         <button
          onClick={() => setDeleteTarget(s)}
          disabled={busyId === s.id}
          className="cursor-pointer rounded-sm border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:opacity-40"
         >
          {t.delete}
         </button>
        </span>
       </div>
      ))}
     </div>
    </div>
   </div>
   <ConfirmDialog
    open={deleteTarget !== null}
    title={deleteTarget?.title ?? ""}
    detail={t.sessDeleteConfirm}
    confirmLabel={t.delete}
    danger
    onConfirm={() => void doDelete()}
    onCancel={() => setDeleteTarget(null)}
   />
  </>
 );
}
