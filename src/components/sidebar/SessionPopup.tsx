import { useEffect, useMemo, useRef, useState } from "react";
import { Clock, X } from "reicon-react";
import { api } from "@shared/api";
import type { ProjectView, SessionPage, SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { resumeSessionInTerminal } from "../../lib/checkouts";
import { runSessionBatch } from "../../lib/sessionBatch";
import { useText } from "../../lib/useText";
import { TEXT, fmt } from "../../lib/locale";
import { ConfirmDialog } from "../ConfirmDialog";
import { useDialogFocus } from "../../lib/useDropdown";

/**
 * 项目会话弹窗（V11）：列一个项目（含其 worktree）的全部会话。
 *
 * - 点击行 = 在新终端里 `omp --resume` 接着聊（cwd 用会话原目录）；
 * - 行内「归档 / 恢复」直发（写覆盖层，不碰 jsonl）；「删除」走二次确认（真删文件，不可恢复）；
 * - **无勾选**（V17 增补）：底部固定两个动作——「全部归档」「全部删除」，作用于**当前过滤结果**
 *   （搜索之后就是搜出来的那批）；按钮带数量，全部归档只数未归档的那些（无适用项 = 禁用）；
 *   批量走 `lib/sessionBatch`，与设置页「已归档对话」同一份分批与失败聚合；
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
 const [page, setPage] = useState<SessionPage | null>(null);
 const [error, setError] = useState<string | null>(null);
 const [loadError, setLoadError] = useState<string | null>(null);
 /** 删除的待确认目标：单条与批量共用同一个确认框（`ids` 长度 1 = 单条）。 */
 const [pendingDelete, setPendingDelete] = useState<{ ids: string[]; title: string; detail: string } | null>(null);
 const [busy, setBusy] = useState(false);
 const [query, setQuery] = useState("");
 const cardRef = useRef<HTMLDivElement>(null);
 const actionRef = useRef(false);
 useDialogFocus(cardRef, true, onClose);

 useEffect(() => {
  let alive = true;
  void api
   .listSessions(project.id)
   .then((page) => {
    if (!alive) return;
    setPage(page);
    setSessions(page.sessions);
    setLoadError(null);
   })
   .catch((e) => {
    if (!alive) return;
    setLoadError(e instanceof Error ? e.message : TEXT[useApp.getState().locale].sessLoadFailed);
   });
  return () => {
   alive = false;
  };
 }, [project]);


 const refresh = async () => {
  try {
   const next = await api.listSessions(project.id);
   setPage(next);
   setSessions(next.sessions);
  } catch (e) {
   // 写操作本身已成功：刷新失败保留旧列表，只提示刷新失败，不诱导重复破坏性操作。
   setError(`${t.sessRefreshFailedNote}：${e instanceof Error ? e.message : String(e)}`);
  }
 };

 /** 写操作（单条 / 批量）的统一收口：防重入、忙态、失败明细、完成后刷新列表。 */
 const runAction = async (act: () => Promise<string | null>) => {
  if (actionRef.current) return;
  actionRef.current = true;
  setBusy(true);
  setError(null);
  try {
   const failed = await act();
   if (failed) setError(failed);
   await refresh();
  } catch (e) {
   setError(e instanceof Error ? e.message : String(e));
  } finally {
   actionRef.current = false;
   setBusy(false);
  }
 };

 /** 批量失败明细的展示文案（成功即静默；与「已归档对话」同一口径）。 */
 const failedDetail = (failed: { id: string; message: string }[]): string | null =>
  failed.length === 0
   ? null
   : fmt(t.sessBatchFailed, failed.length, failed.map((f) => f.message || f.id).join("；"));

 const toggleArchive = (s: SessionView) =>
  void runAction(async () => {
   const res = s.archived ? await api.unarchiveSessions([s.id]) : await api.archiveSessions([s.id]);
   return res.failed.length > 0 ? res.failed[0].message || null : null;
  });

 const doDelete = async () => {
  const target = pendingDelete;
  // 与归档页一致：确认即收起；异步完成不能再关闭用户后来打开的确认。
  setPendingDelete(null);
  if (!target) return;
  await runAction(async () => {
   const res = await api.deleteSessions(target.ids);
   return failedDetail(res.failed);
  });
 };

 const cleaned = query.trim().toLowerCase();
 const filtered = useMemo(
  () => (sessions ?? []).filter((s) => !cleaned || `${s.title}\n${s.cwd}\n${s.id}`.toLowerCase().includes(cleaned)),
  [sessions, cleaned],
 );
 // 批量动作作用于**当前过滤结果**：「全部归档」只数未归档的那些（没有适用项 = 按钮禁用），
 // 「全部删除」覆盖列出的每一行（含已归档）。
 const archiveIds = filtered.filter((s) => !s.archived).map((s) => s.id);
 const deleteIds = filtered.map((s) => s.id);

 const actionButton =
  "min-h-8 cursor-pointer rounded-md border border-border px-2.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40";

 return (
  <>
   <div
    className="fixed inset-0 z-30 flex items-center justify-center bg-black/35 p-4 backdrop-blur-[3px]"
    onClick={onClose}
   >
    <div
     ref={cardRef}
     tabIndex={-1}
     role="dialog"
     aria-modal="true"
     aria-label={fmt(t.sessTitleOf, project.name)}
     className="flex max-h-[70vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-dialog"
     onClick={(e) => e.stopPropagation()}
    >
     <div className="flex shrink-0 items-center gap-3 border-b border-border px-5 py-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border-soft bg-surface text-accent">
       <Clock size={16} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
       <div className="truncate text-[14px] font-semibold">{fmt(t.sessTitleOf, project.name)}</div>
       <div className="mt-1 truncate font-mono text-[11px] text-faint" title={project.path}>{project.path}</div>
      </div>
      <button
       type="button"
       onClick={onClose}
       className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
       aria-label={t.close}
      >
       <X size={14} aria-hidden />
      </button>
     </div>
     {error && (
      <div role="alert" className="mx-4 mt-3 shrink-0 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[13px] leading-relaxed text-danger">
       {error}
      </div>
     )}
     <div className="shrink-0 space-y-1.5 px-4 pt-3">
      <input
       value={query}
       onChange={(e) => setQuery(e.target.value)}
       onKeyDown={(e) => {
        if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
        if (!query) return;
        e.preventDefault();
        e.stopPropagation();
        setQuery("");
       }}
       placeholder={t.sessSearch}
       aria-label={t.sessSearch}
       className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
      />
      {sessions !== null && (
       <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-faint">
        <span>{fmt(t.sessLoadedCount, sessions.length)}</span>
        {query.trim() && <span>{fmt(t.sessMatchCount, filtered.length)}</span>}
        {page && page.scannedFiles < page.totalFiles && (
         <span>{fmt(t.sessScanNote, page.scannedFiles, page.totalFiles)}</span>
        )}
       </div>
      )}
     </div>
     <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
      {sessions === null && (loadError ? (
       <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
        <p role="alert" className="text-[13px] text-danger">{loadError}</p>
        <button
         onClick={() => {
          setLoadError(null);
          void api.listSessions(project.id).then((next) => {
           setPage(next);
           setSessions(next.sessions);
          }).catch((e) => {
           setLoadError(e instanceof Error ? e.message : t.sessLoadFailed);
          });
         }}
         className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
        >
         {t.retry}
        </button>
       </div>
      ) : (
       <p role="status" className="px-3 py-8 text-center text-[13px] text-faint">{t.sessLoading}</p>
      ))}
      {sessions !== null && (sessions.length === 0 ? (
       <p className="px-3 py-8 text-center text-[13px] leading-relaxed text-muted">{t.sessEmpty}</p>
      ) : filtered.length === 0 ? (
       <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
        <p className="text-[13px] text-muted">{t.sessNoMatch}</p>
        <button
         onClick={() => setQuery("")}
         className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
        >
         {t.quickSwitcherClear}
        </button>
       </div>
      ) : (
       filtered.map((s) => (
        <div
         key={s.id}
         className="group flex items-center gap-3 rounded-lg border border-border-soft bg-surface px-3 py-3 transition-colors duration-100 hover:bg-hover"
        >
         <button
          onClick={() => {
           resumeSessionInTerminal({ id: s.id, cwd: s.cwd, title: s.title, projectId: s.projectId });
           onClose();
          }}
          disabled={s.corrupt || busy}
          title={`${t.sessResumeHint}\n${s.cwd}`}
          className="min-w-0 flex-1 cursor-pointer rounded-sm text-left disabled:cursor-default disabled:opacity-50"
         >
          <div className="truncate text-[13px] font-medium">{s.title}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-faint" title={s.cwd}>{s.cwd.split("/").filter(Boolean).pop() ?? s.cwd}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
           <span className="font-mono">
            {new Date(s.timestamp).toLocaleString(locale, {
             month: "numeric",
             day: "numeric",
             hour: "2-digit",
             minute: "2-digit",
            })}
           </span>
           {s.archived && <span className="rounded-sm border border-border-soft px-1.5">{t.archivedTag}</span>}
           {s.corrupt && <span className="text-warn">{t.corrupt}</span>}
          </div>
         </button>
         <span className="flex shrink-0 items-center gap-1 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100 min-[hover:hover]:opacity-0">
          <button
           onClick={() => void toggleArchive(s)}
           disabled={busy}
           className={actionButton}
          >
           {s.archived ? t.archivedRestore : t.sessArchive}
          </button>
          <button
           onClick={() => setPendingDelete({ ids: [s.id], title: s.title, detail: t.sessDeleteConfirm })}
           disabled={busy}
           className="min-h-8 cursor-pointer rounded-md border border-border px-2.5 text-[12px] text-muted transition-colors duration-100 hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:cursor-default disabled:opacity-40"
          >
           {t.delete}
          </button>
         </span>
        </div>
       ))
      ))}
     </div>
     {filtered.length > 0 && (
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
       <button
        onClick={() =>
         void runAction(async () => {
          const res = await runSessionBatch("archive", archiveIds);
          return failedDetail(res.failed);
         })
        }
        disabled={busy || archiveIds.length === 0}
        className={actionButton}
       >
        {fmt(t.sessArchiveAll, archiveIds.length)}
       </button>
       <button
        onClick={() =>
         setPendingDelete({
          ids: deleteIds,
          title: fmt(t.sessDeleteAllConfirm, deleteIds.length),
          detail: t.sessDeleteAllDetail,
         })
        }
        disabled={busy}
        className="min-h-8 cursor-pointer rounded-md border border-border px-2.5 text-[12px] text-muted transition-colors duration-100 hover:border-danger/40 hover:bg-danger/10 hover:text-danger disabled:cursor-default disabled:opacity-40"
       >
        {fmt(t.sessDeleteAll, deleteIds.length)}
       </button>
      </div>
     )}
    </div>
   </div>
   <ConfirmDialog
    open={pendingDelete !== null}
    title={pendingDelete?.title ?? ""}
    detail={pendingDelete?.detail ?? ""}
    confirmLabel={t.delete}
    danger
    onConfirm={() => void doDelete()}
    onCancel={() => setPendingDelete(null)}
   />
  </>
 );
}
