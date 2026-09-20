import { useEffect, useState } from "react";
import { Archive, ChevronRight, FolderError, Loader, Refresh, Trash2, Undo } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { groupSessionsByProject } from "../lib/sessions";
import { runSessionBatch } from "../lib/sessionBatch";
import { resumeSessionInTerminal } from "../lib/workspaces";
import { fmt } from "../lib/locale";
import { useText } from "../lib/useText";
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
 const t = useText();
 const [rows, setRows] = useState<SessionView[] | null>(null);
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [loadError, setLoadError] = useState<string | null>(null);
 const [pending, setPending] = useState<PendingDelete | null>(null);
 /** 自增即重拉：挂载、点「刷新」、以及每次恢复/删除之后都走它。 */
 const [reloadKey, setReloadKey] = useState(0);
 /** 项目分组折叠态：key 缺席 = 展开，只有用户点过折叠的才收起。 */
 const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

 useEffect(() => {
  let alive = true;
  void api
   .listArchivedSessions()
   .then((list) => {
    if (!alive) return;
    setRows(list);
    setLoadError(null);
   })
   .catch((e: unknown) => {
    if (!alive) return;
    const message = e instanceof Error ? e.message : t.archivedLoadFailed;
    setRows((prev) => {
     if (!prev) setLoadError(message);
     else setError(`${t.listRefreshFailed}：${message}`);
     return prev;
    });
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
   setReloadKey((k) => k + 1);
   if (res.failed.length > 0) {
    const detail = res.failed.map((f) => f.message || f.id).join("；");
    const tpl = kind === "delete" ? t.archivedPartialDelete : t.archivedPartialRestore;
    setError(fmt(tpl, detail));
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : kind === "delete" ? t.archivedDelete : t.archivedRestore);
  } finally {
   setBusy(false);
  }
 };

 /** 恢复并在终端里继续（V11）：取消归档 + 新终端 `omp --resume`；
  *  V11 没有只读回放渲染器，归档会话的「继续」只能回到终端。 */
 const resumeInTerminal = async (s: SessionView) => {
  setBusy(true);
  setError(null);
  try {
   const res = await runSessionBatch("unarchive", [s.id]);
   if (res.failed.length > 0) {
    setError(fmt(t.archivedPartialRestore, res.failed.map((f) => f.message || f.id).join("；")));
    return;
   }
   resumeSessionInTerminal({ id: s.id, cwd: s.cwd, title: s.title, projectId: s.projectId });
   setReloadKey((k) => k + 1);
  } catch (e) {
   setError(e instanceof Error ? e.message : t.archivedRestore);
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
  <section aria-label={t.tabArchived} className="shrink-0 rounded-lg border border-border-soft bg-surface p-4 @min-[480px]/panel:p-5">
   <div className="flex flex-wrap items-center gap-2">
    <Archive size={16} aria-hidden className="text-muted" />
    <h2 className="text-sm font-semibold">{t.tabArchived}</h2>
    <span className="font-mono text-xs text-muted">{total}</span>
    <button
     onClick={() => setReloadKey((k) => k + 1)}
     disabled={busy || rows === null}
     className="ml-auto flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md bg-background px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     aria-label={t.archivedRefresh}
    >
     {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
     {t.archivedRefresh}
    </button>
   </div>
   <p className="mt-2 text-[13px] leading-relaxed text-faint">{t.archivedHint}</p>
   {error && (
    <p role="alert" className="mt-1.5 text-[13px] text-danger">
     {error}
    </p>
   )}

   {rows === null ? (
    loadError ? (
     <div className="mt-3 flex flex-col items-start gap-2">
      <p role="alert" className="text-[13px] text-danger">{loadError}</p>
      <button
       onClick={() => setReloadKey((k) => k + 1)}
       disabled={busy}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.retry}
      </button>
     </div>
    ) : (
     <p role="status" className="mt-3 text-[13px] text-muted">{t.archivedLoading}</p>
    )
   ) : total === 0 ? (
    <p className="mt-4 rounded-lg bg-background px-4 py-8 text-center text-[13px] leading-relaxed text-muted">{t.archivedEmpty}</p>
   ) : (
    <div className="mt-5 space-y-5">
     {buckets.map((b) => {
      const folded = collapsed[b.key] === true;
      return (
       <div key={b.key}>
        <div className="flex flex-wrap items-center gap-2 border-b border-border-soft pb-3">
         <button
          onClick={() => setCollapsed((m) => ({ ...m, [b.key]: !m[b.key] }))}
          aria-expanded={!folded}
          aria-label={`${b.name}`}
          className="flex min-h-8 min-w-0 basis-full cursor-pointer items-center gap-2 rounded-md text-left @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0"
         >
          <ChevronRight
           size={12}
           aria-hidden
           className={`shrink-0 text-muted transition-transform duration-100 ${folded ? "" : "rotate-90"}`}
          />
          {b.missing ? (
           <FolderError size={12} aria-hidden className="shrink-0 text-warn" />
          ) : (
           <Archive size={12} aria-hidden className="shrink-0 text-faint" />
          )}
          <span className="min-w-0 truncate text-[13px] font-semibold">{b.name}</span>
          {b.path && <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-faint">{b.path}</span>}
         </button>
         <span className="shrink-0 font-mono text-[11px] text-muted">{b.rows.length}</span>
         <button
          onClick={() => void act("unarchive", b.rows.map((s) => s.id))}
          disabled={busy}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
          aria-label={`${t.archivedRestoreAll} ${b.name}`}
         >
          <Undo size={11} aria-hidden />
          {t.archivedRestoreAll}
         </button>
         <button
          onClick={() =>
           setPending({
            ids: b.rows.map((s) => s.id),
            title: fmt(t.archivedDeleteConfirm, b.rows.length),
           })
          }
          disabled={busy}
          className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-danger transition-colors duration-100 hover:bg-danger/10 disabled:opacity-40"
          aria-label={`${t.archivedDeleteAll} ${b.name}`}
         >
          <Trash2 size={11} aria-hidden />
          {t.archivedDeleteAll}
         </button>
        </div>
        {!folded && (
         <div className="mt-0.5 space-y-px">
          {b.rows.map((s) => (
           <div key={s.id} className="flex min-h-11 min-w-0 flex-wrap items-center gap-2 rounded-md px-2 py-2 transition-colors duration-100 hover:bg-hover">
            <button
             onClick={() => void resumeInTerminal(s)}
             className="flex min-w-0 basis-full cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-left @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0"
             aria-label={s.title}
             title={t.archivedOpenHint}
            >
             <span className="min-w-0 basis-full truncate text-[13px] @min-[600px]/panel:flex-1 @min-[600px]/panel:basis-0">{s.title}</span>
             <span className="shrink-0 font-mono text-[11px] text-faint">
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
             className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-40"
             aria-label={`${t.archivedRestore} ${s.title}`}
            >
             <Undo size={12} aria-hidden />
             {t.archivedRestore}
            </button>
            <button
             onClick={() =>
              setPending({ ids: [s.id], title: fmt(t.archivedDeleteConfirm, 1) })
             }
             disabled={busy}
             className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-danger disabled:opacity-40"
             aria-label={`${t.archivedDelete} ${s.title}`}
            >
             <Trash2 size={12} aria-hidden />
             {t.archivedDelete}
            </button>
           </div>
          ))}
         </div>
        )}
       </div>
      );
     })}
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
