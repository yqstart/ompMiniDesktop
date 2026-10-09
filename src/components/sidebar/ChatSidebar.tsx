import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Archive, ArrowUpCircle, BranchDown, BranchUp, ChevronRight, Folder, FolderError, FolderPlus, Inbox, Layers, Loader, Plus, Search, X } from "reicon-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import type { ProjectView, SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { loadCheckouts } from "../../lib/checkouts";
import { pickAndAddProject, startChatInProject } from "../../lib/projects";
import { groupSessionsByProject } from "../../lib/sessions";
import { openSessionWithHistory } from "../../lib/sessionOpen";
import { runSessionBatch } from "../../lib/sessionBatch";
import { isCommitTaskRunning, openCommitPanel, pushWorkspace } from "../../lib/commitTasks";
import { useText } from "../../lib/useText";
import { SidebarBottom } from "./SidebarBottom";
import { SidebarTop } from "./SidebarTop";

/** 每次「继续扫描」新增的窗口（与后端默认窗口一致，见 `commands::scan_window`）。 */
const SCAN_STEP = 500;
/** 扫描窗口上限：再大也不该一次解析上万个文件（后端同样夹到 5000）。 */
const SCAN_MAX = 5000;

/**
 * 会话行（V1–V10 的形状）：`● 标题 … 时间 / 归档`。
 *
 * - 标题单行省略；右侧固定 68px 槽位：平时显示等宽时间，hover / focus-within 时换成归档键
 *   （两者同槽互斥、零位移，悬浮不跳动）；
 * - 行首绿点 = 该会话的聊天进程在跑（后端 `running` 快照）；已损坏的会话标题落 `t.corrupt`；
 * - 点击 = 打开会话（`openSessionWithHistory`：起 / 聚焦长驻 RPC 并拉历史）。
 */
function SessionRow({
 s,
 busy,
 onArchive,
}: {
 s: SessionView;
 busy: boolean;
 onArchive: (ids: string[]) => void;
}) {
 const activeSessionId = useApp((st) => st.activeSessionId);
 const locale = useApp((st) => st.locale);
 const t = useText();
 const active = s.id === activeSessionId;
 const time = s.corrupt
  ? t.corrupt
  : new Date(s.timestamp).toLocaleString(locale, { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
 return (
  <div className={`group relative flex h-8 min-w-0 items-center rounded-md pr-1 pl-2 transition-colors duration-100 ${active ? "bg-active" : "hover:bg-hover"}`}>
   {active && <span aria-hidden className="absolute top-1/2 left-0 h-3.5 w-[2px] -translate-y-1/2 rounded-full bg-accent" />}
   <button
    onClick={() => void openSessionWithHistory(s.id, s)}
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
   <span className="invisible absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center justify-end opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
    <button
     onClick={() => onArchive([s.id])}
     disabled={busy}
     className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-100 hover:bg-active hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
     aria-label={s.running ? t.archiveChatRunning : t.archiveChat}
     title={s.running ? t.archiveChatRunning : t.archiveChat}
    >
     <Archive size={13} />
    </button>
   </span>
  </div>
 );
}

/**
 * 聊天形态的左栏（V32 二次口径：左栏随形态切换，V1–V10 的 Sidebar 骨架恢复并适配）。
 *
 * - 形态：添加项目主入口 → 会话搜索 → **按工作区分段**（V21 容器的投影：工作区头 =
 *   名字 + 成员项目数，成员项目内是「项目分组（进行中会话列表，含 worktree 归属）」；
 *   有自定义工作区才分段，没有就平铺；没进组的项目收进「未分组」段；空工作区不占段）→
 *   「未归属会话」组 → 扫描窗口提示；顶部与底部（顶栏 / 设置·语言·皮肤）与终端侧栏共用；
 * - 数据 = `list_sessions`（**本组件局部持有**，不写 `store.sessions`——那一份是聊天视图
 *   「已知会话」的合并集，窗口外的老会话不该被它顶掉）；项目 / 工作区清单用全局
 *   `projects` / `workspaceGroups`（都为空时各兜底拉一次）；
 * - 刷新时机：挂载 / 切到聊天形态、会话切换后（新建会话与 running 标记靠它进列表，防抖 400ms）、
 *   归档与添加项目后；「继续扫描」按 `SCAN_STEP` 递增窗口重拉；
 * - 与终端侧栏一样**常驻挂载、只切显隐**（`visible`）：卸载会丢掉列表与搜索词，切回来还得重扫盘。
 *
 * 边界：搜索只过滤**标题 / 目录**（V2 M7b 的正文搜索随 V11 的左栏会话列表删除，
 * V32 未恢复；要回来得先恢复后端 `search_sessions` 并定交互）。列表只列**进行中**的会话，
 * 已归档的在设置 ›「已归档对话」里管理。工作区本身在这里只读（编辑 / 新建仍在终端形态的左栏）。
 */
export function ChatSidebar({ visible }: { visible: boolean }) {
 const t = useText();
 const projects = useApp((s) => s.projects);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const activeSessionId = useApp((s) => s.activeSessionId);
 // 已打开会话的实时视图（标题真相）：改名 / 首条回退 / title_change 实时帧只写 store，
 // 本地扫描列表靠它覆盖行标题，否则改名后侧栏 permanent 陈旧（改名根本不触发重扫）。
 const storeSessions = useApp((s) => s.sessions);
 // git 行徽章的数据（与终端目录行同一份快照；刷新时机由 App 的 useWorkspaceGitRefresh 统一管）。
 const gitStates = useApp((s) => s.workspaceGitStates);
 const commitTasks = useApp((s) => s.commitTasks);
 const [sessions, setSessions] = useState<SessionView[]>([]);
 const [scan, setScan] = useState<{ total: number; scanned: number }>({ total: 0, scanned: 0 });
 const [loaded, setLoaded] = useState(false);
 const [query, setQuery] = useState("");
 const [error, setError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 /** 当前扫描窗口：state 给「继续扫描」按钮显示，ref 给不依赖它的 `reload` 读最新值。 */
 const [limit, setLimit] = useState(SCAN_STEP);
 const limitRef = useRef(SCAN_STEP);

 /** 拉一次会话列表（`want` 不传 = 保持当前窗口）。失败不抛，落在内联错误条上。 */
 const reload = useCallback(async (want?: number) => {
  const n = Math.min(SCAN_MAX, Math.max(SCAN_STEP, want ?? limitRef.current));
  try {
   const page = await api.listSessions(undefined, n);
   limitRef.current = n;
   setLimit(n);
   setSessions(page.sessions);
   setScan({ total: page.totalFiles, scanned: page.scannedFiles });
   setLoaded(true);
   setError(null);
  } catch (e) {
   setLoaded(true);
   setError(e instanceof Error ? e.message : String(e));
  }
 }, []);

 // 挂载 / 切到聊天形态就重扫一次（终端形态里归档过的会话、omp TUI 新建的会话都能见到）。
 // 项目清单与工作区清单由终端侧栏在启动时拉过一次（两栏都常驻）；这里只兜冷路径
 // （一个项目都没有 / 有项目但工作区还没拉回来），都只做一次，不每次切形态都补。
 const coldLoaded = useRef(false);
 useEffect(() => {
  if (!visible) return;
  if (!coldLoaded.current) {
   coldLoaded.current = true;
   const st = useApp.getState();
   if (st.projects.length === 0) {
    api
     .listProjects()
     .then((list) => useApp.getState().set({ projects: list }))
     .catch(() => undefined);
   }
   if (st.workspaceGroups.length === 0 && st.projects.length > 0) {
    api
     .listWorkspaces()
     .then((list) => useApp.getState().set({ workspaceGroups: list }))
     .catch(() => undefined);
   }
  }
  void reload();
 }, [visible, reload]);

 // 会话切换（新建 / 打开 / 改名回读）后防抖补一次：新会话与 running 标记靠这一趟进列表。
 const prevSid = useRef(activeSessionId);
 useEffect(() => {
  if (prevSid.current === activeSessionId) return;
  prevSid.current = activeSessionId;
  if (!visible) return;
  const timer = window.setTimeout(() => void reload(), 400);
  return () => window.clearTimeout(timer);
 }, [activeSessionId, visible, reload]);

 /** 归档（行内单条 / 分组全部）：分批 + 失败聚合走 `lib/sessionBatch`；完成后刷新列表。 */
 const archive = async (ids: string[]) => {
  if (ids.length === 0 || busy) return;
  setBusy(true);
  setError(null);
  try {
   const res = await runSessionBatch("archive", ids);
   await reload();
   if (res.failed.length > 0) {
    setError(fmt(t.batchArchivePartial, res.failed.map((f) => f.message || f.id).join("；")));
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : t.batchArchiveFailed);
  } finally {
   setBusy(false);
  }
 };

 /** 添加项目（顶部主入口）：只写覆盖层；目录行与工作区树同步刷新，回来即是最新树。 */
 const addProject = async () => {
  const res = await pickAndAddProject();
  if (res && !res.ok) setError(res.message);
  if (res?.ok) {
   void loadCheckouts().catch(() => undefined);
   await reload();
  }
 };

 /** 目录缺失的重定位：只改覆盖层里的绑定路径（会话文件、备注、归档标记都不动）。 */
 const relocate = async (id: string, name: string) => {
  const picked = await open({ directory: true, multiple: false, title: fmt(t.relocateDialogTitle, name) });
  if (typeof picked !== "string" || !picked) return;
  setError(null);
  try {
   await api.relocateProject(id, picked);
   const list = await api.listProjects();
   useApp.getState().set({ projects: list });
   void loadCheckouts().catch(() => undefined);
   await reload();
  } catch (e) {
   setError(e instanceof Error ? e.message : t.relocateFailed);
  }
 };

 /** 项目分组头「＋」：在该项目主目录下新建聊天（懒写盘；选中由 store 的 activeSessionId 落定）。 */
 const newChat = async (project: ProjectView) => {
  const res = await startChatInProject(project.id, { projectName: project.name });
  if (!res.ok) setError(res.message);
 };

 const q = query.trim().toLowerCase();
 const matchSession = (s: SessionView) => (q ? `${s.title}\n${s.cwd}`.toLowerCase().includes(q) : true);
 // 扫描行 × 已打开会话的实时视图：同 id 以 store 为准（标题/归档/running 的真相），
 // 扫描窗口外的新会话（打开过但扫不到）也补一行——否则刚建的会话在列表里看不见。
 const mergedSessions = useMemo(() => {
  const live: Record<string, SessionView> = {};
  for (const s of storeSessions) live[s.id] = s;
  const out = sessions.map((s) => live[s.id] ?? s);
  for (const s of storeSessions) {
   if (!s.archived && !out.some((x) => x.id === s.id)) out.unshift(s);
  }
  return out;
 }, [sessions, storeSessions]);
 const { groups, orphanActive } = useMemo(() => groupSessionsByProject(projects, mergedSessions), [projects, mergedSessions]);
 const visibleGroups = groups.map((g) => ({ project: g.project, active: g.active.filter(matchSession) }));
 const visibleOrphan = orphanActive.filter(matchSession);
 const matchCount = visibleGroups.reduce((n, g) => n + g.active.length, 0) + visibleOrphan.length;

 /**
  * 工作区分段（V21 的容器在聊天形态的投影，2026-10-09）：有自定义工作区时按组分段
  * （工作区头 = 名字 + 成员项目数，成员项目沿用下面的项目分组），没进组的收进「未分组」；
  * 没有自定义工作区时返回 `null` = 平铺（单项目 / 未分组用户无感，与终端树同一条口径）。
  * 空工作区不占段（聊天这里没有可聊的会话；容器的编辑仍只在终端形态）。
  */
 const sections = useMemo<{ key: string; name: string | null; projectIds: string[] }[] | null>(() => {
  if (workspaceGroups.length === 0) return null;
  const out: { key: string; name: string | null; projectIds: string[] }[] = [];
  for (const g of workspaceGroups) {
   const ids = projects.filter((p) => p.workspaceId === g.id).map((p) => p.id);
   if (ids.length > 0) out.push({ key: g.id, name: g.name, projectIds: ids });
  }
  const ungrouped = projects.filter((p) => p.workspaceId === null).map((p) => p.id);
  if (ungrouped.length > 0) out.push({ key: "__ungrouped", name: null, projectIds: ungrouped });
  return out.length > 0 ? out : null;
 }, [workspaceGroups, projects]);

 /** 分组头与「未归属」共用的动作键（＋ / 归档全部）——图标槽与计数同槽互斥，悬浮零跳动。 */
 const actionButton =
  "flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-100 hover:bg-active hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40";
 /** 项目分组头的 git 状态徽章（与终端目录行同一份快照同一套语义，只是按项目主目录取）：dirty 点 / 待推送（可点）/ 落后（只读）/ 任务态（可点开面板）。无快照时不占位。 */
 const gitBadgesFor = (path: string, missing: boolean) => {
  if (missing) return null;
  const gs = gitStates[path];
  if (!gs?.isRepo) return null;
  const task = commitTasks[path];
  const running = task ? isCommitTaskRunning(task.phase) : false;
  const failed = task?.phase === "failed";
  const dirty = gs.dirty;
  const ahead = gs.ahead;
  const behind = gs.behind;
  if (!dirty && ahead <= 0 && behind <= 0 && !running && !failed) return null;
  return (
   <span className="flex shrink-0 items-center gap-1" onClick={(e) => e.preventDefault()}>
    {dirty && (
     <span className="flex size-5 items-center justify-center rounded-sm bg-surface" title={t.gitDirtyTitle} aria-label={t.gitDirtyTitle}>
      <span className="size-1.5 rounded-full bg-accent" aria-hidden />
     </span>
    )}
    {ahead > 0 && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       pushWorkspace(path);
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
    {running && (
     <button
      onClick={(e) => {
       e.stopPropagation();
       useApp.getState().setActiveCommitCwd(path);
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
       useApp.getState().setActiveCommitCwd(path);
      }}
      title={t.gitFailedTitle}
      aria-label={t.gitFailedTitle}
      className="flex size-5 cursor-pointer items-center justify-center rounded-sm bg-surface text-danger transition-colors duration-100 hover:bg-hover"
     >
      <AlertTriangle size={12} aria-hidden />
     </button>
    )}
   </span>
  );
 };
 /** 一个项目分组（分组头 + 进行中会话列表）：平铺与工作区分段两种排布共用同一份。 */
 const projectBlock = (project: ProjectView, active: SessionView[]) => (
  <details key={project.id} className="group/proj mt-1" open={!q || active.length > 0}>
   {/* 项目头与终端形态的项目头同款（`ProjectGroup`）：没有折叠箭头——点击整行即展开 / 收起，
       文件夹图标进 `bg-surface` 小盒（展开时上强调色、目录缺失上 warn） */}
   <summary className="relative flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
    <span className={`flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface transition-colors duration-100 ${project.missing ? "text-warn" : "text-muted group-open/proj:text-accent"}`}>
     <Folder size={14} aria-hidden />
    </span>
    <span className="min-w-0 flex-1 truncate">
     <span className="font-semibold text-foreground">{project.name}</span>
     {project.missing ? (
      <span className="ml-1.5 rounded bg-warn/15 px-1 py-px text-[11px] text-warn">{t.missingFolder}</span>
     ) : (
      <span className="ml-1.5 truncate font-mono text-[11px] text-faint">{project.path}</span>
     )}
    </span>
    {gitBadgesFor(project.path, project.missing)}
    <span className="relative flex h-5 w-[72px] shrink-0 items-center justify-end">
     <span className={`font-mono ${active.length === 0 ? "invisible" : "group-hover/proj:invisible"}`}>{active.length}</span>
     <span
      className={`absolute inset-y-0 right-0 items-center gap-0.5 ${active.length === 0 ? "flex" : "hidden group-hover/proj:flex"}`}
      onClick={(e) => e.preventDefault()}
     >
      <button
       onClick={() => openCommitPanel(project.path)}
       disabled={project.missing || busy}
       className={actionButton}
       aria-label={t.gitCommitTitle}
       title={project.missing ? t.gitCommitNotRepo : t.gitCommitTitle}
      >
       <ArrowUpCircle size={12} />
      </button>
      <button
       onClick={() => void newChat(project)}
       disabled={project.missing || busy}
       className={actionButton}
       aria-label={fmt(t.newSessionIn, project.name)}
       title={t.newSession}
      >
       <Plus size={12} />
      </button>
      {active.length > 0 && (
       <button
        onClick={() => void archive(active.map((s) => s.id))}
        disabled={busy}
        className={actionButton}
        aria-label={fmt(t.archiveAllIn, project.name)}
        title={t.archiveAllInTitle}
       >
        <Archive size={12} />
       </button>
      )}
     </span>
    </span>
   </summary>
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
    {active.length === 0 && <div className="px-2.5 py-1 text-[11px] text-faint">{t.noActiveChats}</div>}
    {active.map((s) => (
     <SessionRow key={s.id} s={s} busy={busy} onArchive={(ids) => void archive(ids)} />
    ))}
   </div>
  </details>
 );

 return (
  <aside className={`${visible ? "flex" : "hidden"} h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar`}>
   {/* 顶栏（红绿灯占位 + 形态切换 + 两枚版本 chip）：与终端形态的 `WorkspaceSidebar` 共用同一份 */}
   <SidebarTop />
   <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
    {/* 顶部固定区（添加项目 + 搜索框）：sticky 钉在列表上方，`-mx-3 px-3` 让底色铺满容器，
        滚过去的会话行不会从两侧露出 */}
    <div className="sticky top-0 z-10 -mx-3 bg-sidebar px-3 pt-1 pb-2">
     <button
      onClick={() => void addProject()}
      className="mb-2 flex h-8 w-full cursor-pointer items-center justify-center gap-1.5 rounded-md border border-accent/25 bg-accent/10 px-3 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-accent/20"
      aria-label={t.addProject}
     >
      <FolderPlus size={14} aria-hidden /> {t.addProject}
     </button>
     <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] text-muted transition-colors duration-100 focus-within:border-accent/70 focus-within:text-foreground">
      <Search size={14} aria-hidden className="shrink-0" />
      <label htmlFor="chat-sidebar-search" className="sr-only">
       {t.searchSessions}
      </label>
      <input
       id="chat-sidebar-search"
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
    {error && (
     <div role="alert" className="mb-1 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 px-2 py-1.5 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{error}</span>
      <button
       onClick={() => setError(null)}
       className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-70 transition-opacity duration-100 hover:opacity-100"
       aria-label={t.dismissError}
      >
       <X size={12} />
      </button>
     </div>
    )}
    {!loaded ? (
     <p role="status" className="px-2 py-4 text-[13px] text-muted">
      {t.archivedLoading}
     </p>
    ) : (
     <>
      {projects.length === 0 && (
       <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted">{t.noProjectsAdd}</div>
      )}
      {q.length > 0 && projects.length > 0 && (
       <div className="px-1 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted">{fmt(t.titleMatches, matchCount)}</div>
      )}
      {sections === null
       ? visibleGroups.map(({ project, active }) => projectBlock(project, active))
       : sections.map((section) => {
        const members = section.projectIds
         .map((id) => visibleGroups.find((g) => g.project.id === id))
         .filter((g): g is (typeof visibleGroups)[number] => g !== undefined);
        const hits = members.reduce((n, g) => n + g.active.length, 0);
        const countLabel = fmt(t.wsGroupCount, String(members.length));
        return (
         <details key={section.key} className="group/ws mt-2" open={!q || hits > 0}>
          {/* 工作区头与终端形态的组头同款（`WorkspaceGroupSection`）：没有折叠箭头——点击整行即展开 / 收起，
              图标进 `bg-surface` 小盒，展开时 `Layers` 与名字上强调色，行尾是成员计数小盒 */}
          <summary className="flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
           <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface text-muted transition-colors duration-100 group-open/ws:text-accent">
            <Layers size={14} aria-hidden />
           </span>
           <span className="min-w-0 flex-1 truncate font-semibold text-foreground transition-colors duration-100 group-open/ws:text-accent">
            {section.name ?? t.wsGroupUngrouped}
           </span>
           <span
            className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-surface px-1 font-mono text-[10px] leading-none text-faint"
            title={countLabel}
            aria-label={countLabel}
           >
            {members.length}
           </span>
          </summary>
          <div className="pl-2">{members.map((g) => projectBlock(g.project, g.active))}</div>
         </details>
        );
       })}
      {visibleOrphan.length > 0 && (
       <details className="group/orphan mt-1" open={!q || visibleOrphan.length > 0}>
        <summary className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] font-semibold text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
         <ChevronRight size={12} aria-hidden className="transition-transform duration-150 group-open/orphan:rotate-90" />
         <Inbox size={13} aria-hidden className="shrink-0 text-faint" />
         <span className="min-w-0 flex-1 truncate">{t.orphanChats}</span>
         <span className="relative flex h-5 w-[28px] shrink-0 items-center justify-end">
          <span className="font-mono group-hover/orphan:invisible">{visibleOrphan.length}</span>
          <span
           className="absolute inset-y-0 right-0 hidden items-center gap-0.5 group-hover/orphan:flex"
           onClick={(e) => e.preventDefault()}
          >
           <button
            onClick={() => void archive(visibleOrphan.map((s) => s.id))}
            disabled={busy || visibleOrphan.length === 0}
            className={actionButton}
            aria-label={t.archiveOrphanAll}
            title={t.archiveOrphanAll}
           >
            <Archive size={12} />
           </button>
          </span>
         </span>
        </summary>
        <div className="mt-0.5 space-y-px border-l border-border pl-1.5">
         {visibleOrphan.map((s) => (
          <SessionRow key={s.id} s={s} busy={busy} onArchive={(ids) => void archive(ids)} />
         ))}
        </div>
       </details>
      )}
     </>
    )
    }
   </div >
   {/* 扫描窗口提示（V2 M7a 口径）：超出窗口的老会话不是不存在，给一次性入口继续往老里扫。
       窗口状态由本组件持有（`limit` / `scan`），不再进全局 store——只有这一处读它。 */}
   {
    scan.total > scan.scanned && (
     <div className="shrink-0 border-t border-border px-3 py-2 text-[11px] text-muted">
      <div>{fmt(t.scanScanned, scan.scanned, scan.total)}</div>
      <button
       onClick={() => void reload(limit + SCAN_STEP)}
       disabled={limit >= SCAN_MAX}
       className="mt-1 cursor-pointer rounded-md border border-border px-2 py-0.5 transition-colors duration-100 hover:bg-active hover:text-foreground disabled:cursor-default disabled:opacity-50"
      >
       {limit >= SCAN_MAX ? fmt(t.scanLimitReached, SCAN_MAX) : fmt(t.scanMore, SCAN_STEP)}
      </button>
     </div>
    )
   }
   <SidebarBottom />
  </aside>
 );
}
