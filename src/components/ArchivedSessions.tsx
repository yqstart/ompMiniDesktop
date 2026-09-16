import { useEffect, useState } from "react";
import { Archive, ArchiveRestore, FolderSearch, Loader2, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { groupSessionsByProject } from "../lib/sessions";
import { pruneDeletedSessions, runSessionBatch } from "../lib/sessionBatch";
import { loadSessions } from "../lib/sessionList";
import { openSessionWithHistory } from "../lib/sessionOpen";
import { SETTINGS_TEXT } from "../lib/locale";
import { ConfirmDialog } from "./ConfirmDialog";
import type { SessionView } from "@shared/types";

/** 确认浮层的入参：一次只确认一件事（单个删除 / 分组删除都走同一个 `ConfirmDialog`）。 */
type PendingDelete = { ids: string[]; title: string };

/**
 * 设置 ›「已归档对话」：归档会话的唯一管理面。
 *
 * 为什么单独一页：归档的意义是把老会话从左栏收起来（左栏只列进行中的），
 * 收起来之后总得有个地方能看见它们、能恢复、能真删。数据来自后端
 * `list_archived_sessions`——**不受左栏扫描窗口限制**，老到 500 个之外也找得到。
 * 操作一律经 `lib/sessionBatch`（与左栏分组头同一份分批 / 失败聚合），
 * 改完同时刷新本页与左栏列表：恢复的会话要立刻回到项目分组里。
 */
export function ArchivedSessions() {
 const { projects, locale } = useApp();
 const t = SETTINGS_TEXT[locale];
 const [rows, setRows] = useState<SessionView[] | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [pending, setPending] = useState<PendingDelete | null>(null);
 /** 自增即重拉：挂载、点「刷新」、以及每次恢复/删除之后都走它。 */
 const [reloadKey, setReloadKey] = useState(0);

 useEffect(() => {
  let alive = true;
  void api
   .listArchivedSessions()
   .then((list) => {
    if (!alive) return;
    setRows(list);
    setError(null);
   })
   .catch((e: unknown) => {
    if (!alive) return;
    setRows([]);
    setError(e instanceof Error ? e.message : t.archivedLoadFailed);
   });
  return () => {
   alive = false;
  };
 }, [reloadKey, t]);

 /** 恢复 / 删除：只传真正成功的 id 去清前端痕迹，失败的那些保持可读。 */
 const act = async (kind: "delete" | "unarchive", ids: string[]) => {
  if (ids.length === 0) return;
  setBusy(true);
  setError(null);
  try {
   const res = await runSessionBatch(kind, ids);
   if (kind === "delete") {
    pruneDeletedSessions(ids.filter((id) => !res.failed.some((f) => f.id === id)));
   }
   // 本页 + 左栏一起刷新：恢复的会话要立刻回到项目分组里
   setReloadKey((k) => k + 1);
   await loadSessions();
   if (res.failed.length > 0) {
    const detail = res.failed.map((f) => f.message || f.id).join("；");
    const tpl = kind === "delete" ? t.archivedPartialDelete : t.archivedPartialRestore;
    setError(tpl.replace("{v}", detail));
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : kind === "delete" ? t.archivedDelete : t.archivedRestore);
  } finally {
   setBusy(false);
  }
 };

 // 分类规则与左栏同一份：projectId 对得上就归项目，否则算未归属
 const { groups, orphanArchived } = groupSessionsByProject(projects, rows ?? []);
 const total = rows?.length ?? 0;
 const buckets = [
  ...groups
   .filter((g) => g.archived.length > 0)
   .map((g) => ({ key: g.project.id, name: g.project.name, path: g.project.path, missing: g.project.missing, rows: g.archived })),
  ...(orphanArchived.length > 0
   ? [{ key: "__orphan", name: t.archivedOrphan, path: "", missing: false, rows: orphanArchived }]
   : []),
 ];

 return (
  <section aria-label={t.tabArchived} className="rounded border border-border bg-surface p-3">
   <div className="flex flex-wrap items-center gap-2">
    <Archive size={14} aria-hidden className="text-muted" />
    <h2 className="text-sm font-medium">{t.tabArchived}</h2>
    <span className="font-mono text-xs text-muted">{total}</span>
    <button
     onClick={() => setReloadKey((k) => k + 1)}
     disabled={busy}
     className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background disabled:opacity-50"
     aria-label={t.archivedRefresh}
    >
     {busy ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <RefreshCw size={12} aria-hidden />}
     {t.archivedRefresh}
    </button>
   </div>
   <p className="mt-1.5 text-xs text-muted/70">{t.archivedHint}</p>
   {error && (
    <p role="alert" className="mt-1.5 text-xs text-danger">
     {error}
    </p>
   )}

   {rows === null ? (
    <p className="mt-3 text-xs text-muted">{t.archivedLoading}</p>
   ) : total === 0 ? (
    <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-3 text-xs text-muted">{t.archivedEmpty}</p>
   ) : (
    <div className="mt-2 space-y-3">
     {buckets.map((b) => (
      <div key={b.key}>
       <div className="flex items-center gap-2 border-b border-border/70 pb-1">
        {b.missing ? (
         <FolderSearch size={12} aria-hidden className="shrink-0 text-warn" />
        ) : (
         <Archive size={12} aria-hidden className="shrink-0 text-muted/70" />
        )}
        <span className="min-w-0 truncate text-xs font-semibold">{b.name}</span>
        {b.path && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted/60">{b.path}</span>}
        <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{b.rows.length}</span>
        <button
         onClick={() => void act("unarchive", b.rows.map((s) => s.id))}
         disabled={busy}
         className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] transition-colors duration-150 hover:bg-background disabled:opacity-40"
         aria-label={`${t.archivedRestoreAll} ${b.name}`}
        >
         <RotateCcw size={11} aria-hidden />
         {t.archivedRestoreAll}
        </button>
        <button
         onClick={() =>
          setPending({
           ids: b.rows.map((s) => s.id),
           title: t.archivedDeleteConfirm.replace("{v}", String(b.rows.length)),
          })
         }
         disabled={busy}
         className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-danger transition-colors duration-150 hover:bg-danger/10 disabled:opacity-40"
         aria-label={`${t.archivedDeleteAll} ${b.name}`}
        >
         <Trash2 size={11} aria-hidden />
         {t.archivedDeleteAll}
        </button>
       </div>
       <div className="mt-0.5 space-y-px">
        {b.rows.map((s) => (
         <div key={s.id} className="flex h-8 min-w-0 items-center gap-2 rounded-lg px-2 transition-colors duration-150 hover:bg-background/60">
          <button
           onClick={() => void openSessionWithHistory(s.id)}
           className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left"
           aria-label={s.title}
           title={t.archivedOpenHint}
          >
           <span className="min-w-0 flex-1 truncate text-[13px]">{s.title}</span>
           <span className="shrink-0 font-mono text-[11px] text-muted/80">
            {new Date(s.timestamp).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", {
             year: "numeric",
             month: "numeric",
             day: "numeric",
            })}
           </span>
          </button>
          <button
           onClick={() => void act("unarchive", [s.id])}
           disabled={busy}
           className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
           aria-label={`${t.archivedRestore} ${s.title}`}
          >
           <ArchiveRestore size={12} aria-hidden />
           {t.archivedRestore}
          </button>
          <button
           onClick={() =>
            setPending({ ids: [s.id], title: t.archivedDeleteConfirm.replace("{v}", "1") })
           }
           disabled={busy}
           className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
           aria-label={`${t.archivedDelete} ${s.title}`}
          >
           <Trash2 size={12} aria-hidden />
           {t.archivedDelete}
          </button>
         </div>
        ))}
       </div>
      </div>
     ))}
    </div>
   )}

   <ConfirmDialog
    open={pending !== null}
    title={pending?.title ?? ""}
    detail={t.archivedDeleteDetail}
    confirmLabel={t.archivedDelete}
    danger
    onCancel={() => setPending(null)}
    onConfirm={() => {
     const job = pending;
     setPending(null);
     if (job) void act("delete", job.ids);
    }}
   />
  </section>
 );
}
