import { useEffect, useState } from "react";
import {
 Archive,
 ChevronRight,
 Folder,
 FolderError,
 FolderMinus,
 FolderPlus,
 Inbox,
 Plus,
 Search,
 Settings,
 Trash2,
 X,
} from "reicon-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { pickAndAddProject, switchProject } from "../../lib/projects";
import { groupSessionsByProject } from "../../lib/sessions";
import { createSessionIn, openSessionWithHistory } from "../../lib/sessionOpen";
import { SCAN_MAX, SCAN_STEP, loadSessions, scanMoreSessions } from "../../lib/sessionList";
import { pruneDeletedSessions, runSessionBatch } from "../../lib/sessionBatch";
import { highlightParts } from "../../lib/search";
import { useText } from "../../lib/useText";
import { ConfirmDialog } from "../ConfirmDialog";
import type { SessionHit, SessionView } from "@shared/types";

/**
 * 会话行：单行结构 `● 标题 … 时间/操作`，对齐截图。
 * - 标题单行省略；右侧固定 68px 槽位：平时显示 mono 时间，hover / focus-within 时
 *   时间 visibility 隐藏（占位保留），操作按钮绝对覆盖同一槽位淡入——两者互斥、
 *   外层布局零变化，悬浮不跳动。
 * - 归档、删除都在行内展示，不另起第二行；删除二次确认以浮层覆盖，不撑布局。
 * - 行首无复选框：批量归档/删除收归项目分组头（见 Sidebar），行内只做单个会话操作。
 * - 选中态底色 = 顶部「添加项目」主按钮同色（`accent`）的稀释填充 `bg-accent/15`，
 *   左侧全色 3px 竖条；项目分组头（当前项目）用同一套，全项目只有这一种选中视觉。
 */
function SessionRow({ s, onChanged }: { s: SessionView; onChanged: () => void }) {
 const { activeSessionId, locale } = useApp();
 const t = useText();
 const [confirmDelete, setConfirmDelete] = useState(false);
 const active = s.id === activeSessionId;
 const time = s.corrupt
  ? t.corrupt
  : new Date(s.timestamp).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
 return (
  <div
   className={`group relative flex h-8 min-w-0 items-center rounded-md pr-1 pl-2 transition-colors duration-100 ${active ? "bg-active" : "hover:bg-hover"
    }`}
  >
   {active && <span aria-hidden className="absolute top-1/2 left-0 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-accent" />}
   <button
    // 打开逻辑与输入框上方项目下拉共用一份（lib/sessionOpen）
    onClick={() => void openSessionWithHistory(s.id)}
    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
    aria-label={fmt(t.chatAria, s.title)}
   >
    <span
     className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.running ? "bg-ok" : "bg-transparent"}`}
     aria-label={s.running ? t.statusRunning : undefined}
     aria-hidden={!s.running}
    />
    <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-semibold" : ""}`}>{s.title}</span>
    <span className="w-[68px] shrink-0 truncate text-right font-mono text-[11px] text-faint group-focus-within:invisible group-hover:invisible">
     {time}
    </span>
   </button>
   {!confirmDelete ? (
    <span className="invisible absolute top-1/2 right-1.5 flex w-[68px] -translate-y-1/2 items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
     <button
      onClick={() => api.archiveSession(s.id).then(onChanged)}
      className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-100 hover:bg-active hover:text-foreground"
      aria-label={s.running ? t.archiveChatRunning : t.archiveChat}
      title={s.running ? t.archiveChatRunning : t.archiveChat}
     >
      <Archive size={13} />
     </button>
     <button
      onClick={() => setConfirmDelete(true)}
      className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-100 hover:bg-danger/15 hover:text-danger"
      aria-label={t.deleteChat}
      title={t.deleteChat}
     >
      <Trash2 size={13} />
     </button>
    </span>
   ) : (
    <span className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-[13px] whitespace-nowrap shadow-lg">
     <span className="text-danger">{t.confirmDeleteShort}</span>
     <button
      onClick={() =>
       api.deleteSession(s.id).then(() => {
        onChanged();
        setConfirmDelete(false);
       })
      }
      className="cursor-pointer rounded-md bg-danger px-1.5 py-0.5 text-white"
      aria-label={t.confirmDeleteAria}
     >
      {t.delete}
     </button>
     <button
      onClick={() => setConfirmDelete(false)}
      className="cursor-pointer rounded-md border border-border px-1.5 py-0.5"
      aria-label={t.cancelDeleteAria}
     >
      {t.cancel}
     </button>
    </span>
   )}
  </div>
 );
}

export function Sidebar() {
 const { projects, sessions, activeProjectId, set, sessionScan, sessionScanLimit } = useApp();
 const t = useText();
 const [query, setQuery] = useState("");
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 // 正在二次确认的项目操作（浮层确认，不撑布局；一次只确认一个）：
 // purge = 删除该工作区全部对话（真删 jsonl）；remove = 删除工作区（解绑 + 名下对话全部归档）
 const [confirmProject, setConfirmProject] = useState<{ id: string; kind: "purge" | "remove" } | null>(null);
 /** 批量删除的通用二次确认（ConfirmDialog）；项目内联浮层仍走 confirmProject。 */
 const [confirmBatch, setConfirmBatch] = useState<{ ids: string[]; title: string; detail: string } | null>(null);

 useEffect(() => {
  // 会话一次全量拉取，前端按项目分组（修复：之前按 activeProjectId 传参，
  // 后端过滤不可靠会导致各项目会话全堆在“进行中”）。
  void loadSessions();
 }, []);

 const refreshAll = () =>
  Promise.all([
   api.listProjects().then((all) => set({ projects: all })).catch(() => undefined),
   loadSessions(),
  ]).then(() => undefined);

 const refreshSessions = () => loadSessions();

 // 打开/切换项目时刷新项目与会话：终端里新建的会话（同 cwd）会实时归属进来，
 // 而不是等下次启动才出现在项目下。左栏分组头只切上下文，既不新建也不打开会话；
 // 「切过去并在该项目下新建对话」只由输入框上方的项目下拉触发（`newSession`）。
 const openProject = (id: string) => {
  void switchProject(id);
 };

 /**
  * 目录缺失时的重定位：只改覆盖层里的项目路径（会话文件、备注、归档标记都不动），
  * 改完立刻刷新——原先按 cwd 归不到组的会话会重新回到该项目下。
  */
 const relocate = async (id: string, name: string) => {
  const picked = await open({ directory: true, multiple: false, title: fmt(t.relocateDialogTitle, name) });
  if (typeof picked !== "string" || !picked) return;
  setError(null);
  try {
   await api.relocateProject(id, picked);
   await refreshAll();
  } catch (e) {
   setError(e instanceof Error ? e.message : t.relocateFailed);
  }
 };

 /** 项目 / 分组级批量操作：分批与失败聚合收在 `lib/sessionBatch`（设置页归档管理共用同一份）。
  *  delete 先弹通用 ConfirmDialog（MASTER §8）；项目内浮层已二次确认时传 confirmed 跳过。
  *  左栏只列进行中的会话——已归档的对话在设置 ›「已归档对话」里管理，不在这里出现。 */
 const runBatch = async (
  kind: "archive" | "delete",
  ids: string[],
  opts: { confirmed?: boolean } = {},
 ) => {
  if (ids.length === 0) return;
  if (kind === "delete" && !opts.confirmed) {
   // 统一走 ConfirmDialog：此前这里用 window.confirm，成了第二种确认样式
   setConfirmBatch({
    ids,
    title: fmt(t.batchDeleteTitle, ids.length),
    detail: t.batchDeleteDetail,
   });
   return;
  }
  setBusy(true);
  setError(null);
  try {
   const res = await runSessionBatch(kind, ids);
   // 只清真正删掉的：失败的那些还在列表里，保留缓存供继续阅读
   if (kind === "delete") {
    pruneDeletedSessions(ids.filter((id) => !res.failed.some((f) => f.id === id)));
   }
   await refreshSessions();
   if (res.failed.length > 0) {
    setError(
     fmt(
      kind === "archive" ? t.batchArchivePartial : t.batchDeletePartial,
      res.failed.map((f) => f.message || f.id).join("；"),
     ),
    );
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : kind === "archive" ? t.batchArchiveFailed : t.batchDeleteFailed);
  } finally {
   setBusy(false);
  }
 };

 /** 删除工作区（解绑）：只摘掉项目条目，不删任何会话文件；
  *  名下全部对话由后端按 cwd 扫描后标记归档保留（含进行中与已归档）。 */
 const removeWorkspace = async (projectId: string) => {
  try {
   await api.removeProject(projectId);
   setConfirmProject(null);
   const st = useApp.getState();
   const nextProjects = st.projects.filter((p) => p.id !== projectId);
   // 被删工作区若是当前上下文，切到首个剩余项目；正看的会话若归属它，不断开阅读。
   set({
    projects: nextProjects,
    activeProjectId:
     st.activeProjectId === projectId
      ? (nextProjects.find((p) => !p.missing)?.id ?? nextProjects[0]?.id ?? null)
      : st.activeProjectId,
   });
   await refreshAll();
  } catch (e) {
   setError(e instanceof Error ? e.message : t.removeWorkspaceFailed);
  }
 };

 const { groups, orphanActive } = groupSessionsByProject(projects, sessions);
 const q = query.trim().toLowerCase();
 // 内容搜索（V2 M7b）：标题/备注过滤之外，按正文再搜一遍（后端有预算保护）。
 // 少于 2 个字不搜——单字会把几乎每个会话都命中，既慢又没信息量。
 const [content, setContent] = useState<{
  key: string;
  hits: SessionHit[];
  scannedFiles: number;
  truncated: boolean;
 }>({ key: "", hits: [], scannedFiles: 0, truncated: false });
 const contentReady = content.key === q;
 useEffect(() => {
  if (q.length < 2) return;
  let alive = true;
  // 打字期间不发请求：停 300ms 再搜
  const timer = setTimeout(() => {
   void api
    .searchSessions(q)
    .then((res) => {
     if (alive) setContent({ key: q, hits: res.hits, scannedFiles: res.scannedFiles, truncated: res.truncated });
    })
    .catch(() => undefined);
  }, 300);
  return () => {
   alive = false;
   clearTimeout(timer);
  };
 }, [q]);
 const contentHits = q.length >= 2 && contentReady ? content.hits : [];
 const matchSession = (s: (typeof sessions)[number]) =>
  q ? s.title.toLowerCase().includes(q) : true;
 // 左栏只列**进行中**的会话：已归档的对话在设置 ›「已归档对话」里管理（按项目分组、可恢复/删除）
 const visibleGroups = groups.map((g) => ({ project: g.project, active: g.active.filter(matchSession) }));
 const visibleOrphanActive = orphanActive.filter(matchSession);

 return (
  <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar">
   {/* macOS Overlay 红绿灯占位：与添加项目按钮错开，避免重叠 */}
   <div data-tauri-drag-region className="h-9 shrink-0" aria-hidden />
   {/* 滚动容器只负责会话列表；`scrollbar-gutter:stable` 恒定预留滚动条宽度，
          列表从「没滚动条」到「有滚动条」不再横向跳一下。 */}
   <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]">
    {/* 顶部固定区（添加项目 + 搜索框）：用 sticky 钉在列表上方，而不是拆成两个
            滚动容器——这样搜索框与下方会话行共用同一条滚动条留白，宽度始终对齐；
            `-mx-2 px-2` 让底色铺满容器，滚过去的会话行不会从两侧露出。 */}
    <div className="sticky top-0 z-10 -mx-2 bg-sidebar px-2 pb-2">
     {/* 顶部：添加项目（DSH 式主入口）——原先这里是「新建会话」，
            现在唯一主入口让给添加项目；新建会话下放到各项目分组内（分组头下方
            与空态），不与主入口抢位。 */}
     <button
      onClick={async () => {
       const res = await pickAndAddProject();
       if (res && !res.ok) setError(res.message);
      }}
      className="mb-2 flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-3 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-accent/20"
      aria-label={t.addProject}
     >
      <FolderPlus size={14} aria-hidden /> {t.addProject}
     </button>
     {/* 搜索入口：Cursor / DSH 式一体搜索框——图标内置、整块圆角、
            focus-within 时 accent 描边；清除按钮只在有字时出现，不占位跳动 */}
     <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-muted transition-colors duration-100 focus-within:border-accent/70 focus-within:text-foreground">
      <Search size={14} aria-hidden className="shrink-0" />
      <label htmlFor="sidebar-search" className="sr-only">
       {t.searchSessions}
      </label>
      <input
       id="sidebar-search"
       value={query}
       onChange={(e) => setQuery(e.target.value)}
       placeholder={t.searchPlaceholder}
       className="no-focus-ring w-full min-w-0 bg-transparent outline-none placeholder:text-faint"
      />
      {query && (
       <button
        onClick={() => setQuery("")}
        className="shrink-0 cursor-pointer rounded-full p-0.5 text-muted transition-colors duration-100 hover:bg-active hover:text-foreground"
        aria-label={t.clearSearch}
       >
        <X size={12} aria-hidden />
       </button>
      )}
     </div>
    </div>
    {/* 项目分组（Cursor / Codex 式单层结构）：分组头即项目入口，
            点击展开/折叠（details 原生），不再另起一排快捷卡片——之前红框那排
            快捷卡片与下方分组重复，造成“一个项目出现两次”，已删除。 */}
    {projects.length === 0 ? (
     <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted">
      {t.noProjectsAdd}
     </div>
    ) : (
     q && (
      <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted">
       {fmt(t.titleMatches, visibleGroups.reduce((n, g) => n + g.active.length, 0) + visibleOrphanActive.length)}
      </div>
     )
    )}
    {/* 内容命中（V2 M7b）：标题匹配之外按正文搜；命中行显示片段与命中次数，点开即打开会话 */}
    {q.length >= 2 && (
     <div className="mb-2">
      <div className="px-2 pb-1 text-[11px] font-medium tracking-wide text-muted">
       {contentReady ? fmt(t.contentMatches, contentHits.length) : t.contentSearching}
       {contentReady && content.truncated && <span className="ml-1 opacity-80">{t.contentTruncated}</span>}
      </div>
      {contentHits.map((h) => (
       <button
        key={h.id}
        onClick={() => void openSessionWithHistory(h.id)}
        title={fmt(t.hitTooltip, h.title, h.hits)}
        className="mb-0.5 block w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
       >
        <div className="flex items-center gap-1.5">
         <span className="min-w-0 flex-1 truncate text-[13px]">{h.title}</span>
         {h.archived && <span className="shrink-0 text-[10px] text-muted">{t.archivedTag}</span>}
         <span className="shrink-0 font-mono text-[10px] text-muted">{fmt(t.hitCount, h.hits)}</span>
        </div>
        <div className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted">
         {highlightParts(h.snippet, q).map((part, i) =>
          part.hit ? (
           <mark key={i} className="rounded-sm bg-accent/25 px-0.5 text-foreground">
            {part.text}
           </mark>
          ) : (
           <span key={i}>{part.text}</span>
          ),
         )}
        </div>
       </button>
      ))}
     </div>
    )}
    <div className="mt-2 px-1">
     {error && (
      <div role="alert" className="mb-1 rounded-md border border-danger/40 bg-danger/5 px-2 py-1.5 text-[13px] text-danger">
       {error}
       <button onClick={() => setError(null)} className="ml-2 cursor-pointer underline" aria-label={t.dismissError}>
        {t.close}
       </button>
      </div>
     )}
     {visibleGroups.map(({ project, active }) => {
      // 模板里 `{0}` 是项目名（渲染时加粗）：按它切开再各自填充其余占位，
      // EN 语序不同（名字在后）也对得上。
      const purgeTitle = t.purgeConfirmTitle.split("{0}");
      const removeTitle = t.removeConfirmTitle.split("{0}");
      return (
       <details
        key={project.id}
        className="group/proj mt-1"
        open={!q || active.length > 0}
       >
        <summary
         className={`relative flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] transition-colors duration-100 [&::-webkit-details-marker]:hidden ${project.id === activeProjectId
          ? "bg-active text-foreground"
          : "text-muted hover:bg-hover"
          }`}
         onClick={(e) => {
          // Cursor 式：点分组头即切换项目上下文（新建会话落到它），
          // 展开/折叠仍走 chevron 原生行为。
          if ((e.target as HTMLElement).closest("button")) return;
          openProject(project.id);
         }}
        >
         {project.id === activeProjectId && (
          <span aria-hidden className="absolute top-1/2 left-0 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-accent" />
         )}
         <ChevronRight
          size={12}
          aria-hidden
          className="shrink-0 transition-transform duration-150 group-open/proj:rotate-90"
         />
         <Folder size={13} aria-hidden className={`shrink-0 ${project.id === activeProjectId ? "text-accent" : "text-faint"}`} />
         <span className="min-w-0 flex-1 truncate">
          <span className="font-semibold text-foreground">{project.name}</span>
          {project.missing ? (
           <span className="ml-1.5 rounded bg-warn/15 px-1 py-px text-[11px] text-warn">{t.missingFolder}</span>
          ) : (
           <span className="ml-1.5 truncate font-mono text-[11px] text-faint">{project.path}</span>
          )}
         </span>
         {/* 右侧固定槽位：数量与批量按钮同槽互斥，垂直居中，悬浮零跳动。
                      三个批量入口常驻 hover 操作区——归档全部对话 / 删除全部对话 /
                      删除工作区（解绑 + 名下对话归档）；缺失态同样保留，保证可清理。 */}
         <span className="relative flex h-5 w-[76px] shrink-0 items-center justify-end">
          <span className="font-mono group-hover/proj:invisible">{active.length}</span>
          <span className="absolute inset-y-0 right-0 hidden items-center gap-0.5 group-hover/proj:flex" onClick={(e) => e.preventDefault()}>
           <button
            onClick={() => void runBatch("archive", active.map((s) => s.id))}
            disabled={busy || active.length === 0}
            className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-100 hover:bg-active hover:text-foreground disabled:opacity-40"
            aria-label={fmt(t.archiveAllIn, project.name)}
            title={t.archiveAllInTitle}
           >
            <Archive size={12} />
           </button>
           <button
            onClick={() => setConfirmProject({ id: project.id, kind: "purge" })}
            disabled={busy || active.length === 0}
            className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-100 hover:bg-danger/15 hover:text-danger disabled:opacity-40"
            aria-label={fmt(t.deleteAllIn, project.name)}
            title={fmt(t.deleteAllInTitle, active.length)}
           >
            <Trash2 size={12} />
           </button>
           <button
            onClick={() => setConfirmProject({ id: project.id, kind: "remove" })}
            disabled={busy}
            className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-100 hover:bg-danger/15 hover:text-danger disabled:opacity-40"
            aria-label={fmt(t.removeWorkspaceAria, project.name)}
            title={t.removeWorkspaceTitle}
           >
            <FolderMinus size={12} />
           </button>
          </span>
         </span>
        </summary>
        {/* 项目二次确认浮层：purge = 真删全部对话（不可恢复）；remove = 删除工作区（解绑，对话归档保留）。 */}
        {confirmProject?.id === project.id && (
         <div className="mx-1.5 mt-1 flex flex-col gap-1.5 rounded-lg border border-border bg-elevated px-2.5 py-2 text-[13px] shadow-pop">
          {confirmProject.kind === "purge" ? (
           <>
            <div>
             {fmt(purgeTitle[0], project.name, active.length)}
             <span className="font-medium text-foreground">{project.name}</span>
             {fmt(purgeTitle[1] ?? "", project.name, active.length)}
            </div>
            <div className="leading-5 text-muted">{fmt(t.purgeConfirmBody, active.length)}</div>
            <div className="flex flex-wrap justify-end gap-1.5">
             <button
              onClick={() => setConfirmProject(null)}
              className="cursor-pointer rounded-md border border-border px-2.5 py-1 transition-colors duration-100 hover:bg-hover"
              aria-label={t.cancel}
             >
              {t.cancel}
             </button>
             <button
              onClick={() =>
               void runBatch("delete", active.map((s) => s.id), { confirmed: true }).then(() =>
                setConfirmProject(null),
               )
              }
              disabled={busy}
              className="cursor-pointer rounded-md bg-danger px-2.5 py-1 text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
              aria-label={fmt(t.deleteAllIn, project.name)}
             >
              {fmt(t.purgeConfirmButton, active.length)}
             </button>
            </div>
           </>
          ) : (
           <>
            <div>
             {fmt(removeTitle[0], project.name)}
             <span className="font-medium text-foreground">{project.name}</span>
             {fmt(removeTitle[1] ?? "", project.name)}
            </div>
            <div className="leading-5 text-muted">
             {active.length > 0 ? fmt(t.removeConfirmBodyChats, active.length) : t.removeConfirmBodyEmpty}
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
             <button
              onClick={() => setConfirmProject(null)}
              className="cursor-pointer rounded-md border border-border px-2.5 py-1 transition-colors duration-100 hover:bg-hover"
              aria-label={t.cancel}
             >
              {t.cancel}
             </button>
             <button
              onClick={() => void removeWorkspace(project.id)}
              disabled={busy}
              className="cursor-pointer rounded-md border border-danger/60 px-2.5 py-1 text-danger transition-colors duration-100 hover:bg-danger/10 disabled:opacity-40"
              aria-label={fmt(t.removeWorkspaceAria, project.name)}
             >
              {t.removeWorkspace}
             </button>
            </div>
           </>
          )}
         </div>
        )}
        {project.missing && (
         <div className="mx-1.5 mb-1 flex items-center gap-1.5 rounded-md bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
          <FolderError size={12} aria-hidden className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t.missingFolderHint}</span>
          <button
           onClick={() => void relocate(project.id, project.name)}
           className="shrink-0 cursor-pointer rounded-sm border border-warn/40 px-1.5 py-0.5 transition-colors duration-100 hover:bg-warn/15"
           aria-label={fmt(t.relocateAria, project.name)}
           title={t.relocateTitle}
          >
           {t.relocate}
          </button>
         </div>
        )}
        <div className="mt-0.5 space-y-px border-l border-border-soft pl-1.5">
         <button
          onClick={async () => {
           const res = await createSessionIn(project.id, { projectName: project.name });
           setError(res.ok ? null : res.message);
          }}
          disabled={project.missing || busy}
          className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={fmt(t.newSessionIn, project.name)}
         >
          <Plus size={12} /> {t.newSession}
         </button>
         {active.length === 0 && (
          <div className="px-2.5 py-1 text-[11px] text-faint">{t.noActiveChats}</div>
         )}
         {active.map((s) => (
          <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
         ))}
        </div>
       </details>
      );
     })}
     {visibleOrphanActive.length > 0 && (
      <details className="group/orphan mt-1">
       <summary className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] font-semibold text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
        <ChevronRight size={12} aria-hidden className="transition-transform duration-150 group-open/orphan:rotate-90" />
        <Inbox size={13} aria-hidden className="shrink-0 text-faint" />
        <span className="min-w-0 flex-1 truncate">{t.orphanChats}</span>
        <span className="relative flex h-5 w-[52px] shrink-0 items-center justify-end">
         <span className="font-mono group-hover/orphan:invisible">{visibleOrphanActive.length}</span>
         <span className="absolute inset-y-0 right-0 hidden items-center gap-0.5 group-hover/orphan:flex" onClick={(e) => e.preventDefault()}>
          <button
           onClick={() => void runBatch("archive", visibleOrphanActive.map((s) => s.id))}
           disabled={busy || visibleOrphanActive.length === 0}
           className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-100 hover:bg-active hover:text-foreground disabled:opacity-40"
           aria-label={t.archiveOrphanAll}
           title={t.archiveOrphanAll}
          >
           <Archive size={12} />
          </button>
          <button
           onClick={() => void runBatch("delete", visibleOrphanActive.map((s) => s.id))}
           disabled={busy || visibleOrphanActive.length === 0}
           className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-100 hover:bg-danger/15 hover:text-danger disabled:opacity-40"
           aria-label={t.deleteOrphanAll}
           title={t.deleteOrphanAllTitle}
          >
           <Trash2 size={12} />
          </button>
         </span>
        </span>
       </summary>
       <div className="mt-0.5 space-y-px border-l border-border pl-1.5">
        {visibleOrphanActive.map((s) => (
         <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
        ))}
       </div>
      </details>
     )}
     {projects.length === 0 && (
      <div className="px-1.5 py-1 text-[13px] text-muted">{t.noSessionsAddProject}</div>
     )}
    </div>
   </div>
   {/* 扫描窗口提示（V2 M7a）：超出窗口的老会话不是不存在，给一次性入口继续往老里扫 */}
   {sessionScan.totalFiles > sessionScan.scannedFiles && (
    <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted">
     <div>
      {fmt(t.scanScanned, sessionScan.scannedFiles, sessionScan.totalFiles)}
     </div>
     <button
      onClick={() => void scanMoreSessions()}
      disabled={sessionScanLimit >= SCAN_MAX}
      className="mt-1 cursor-pointer rounded-md border border-border px-2 py-0.5 transition-colors duration-100 hover:bg-active hover:text-foreground disabled:cursor-default disabled:opacity-50"
     >
      {sessionScanLimit >= SCAN_MAX ? fmt(t.scanLimitReached, SCAN_MAX) : fmt(t.scanMore, SCAN_STEP)}
     </button>
    </div>
   )}
   <div className="shrink-0 border-t border-border px-2 py-2">
    {/* 底部只留设置：「添加项目」已上移到顶部主入口，不在两处重复。 */}
    <button
     onClick={() => set({ settingsOpen: true, sidebarOpen: false })}
     className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
     aria-label={t.settingsOpenAria}
    >
     <Settings size={15} /> {t.settingsOpenAria}
    </button>
   </div>
   <ConfirmDialog
    open={confirmBatch !== null}
    title={confirmBatch?.title ?? ""}
    detail={confirmBatch?.detail}
    confirmLabel={t.delete}
    danger
    onCancel={() => setConfirmBatch(null)}
    onConfirm={() => {
     const batch = confirmBatch;
     setConfirmBatch(null);
     if (batch) void runBatch("delete", batch.ids, { confirmed: true });
    }}
   />
  </aside>
 );
}
