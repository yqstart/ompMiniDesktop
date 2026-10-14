import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Archive, BranchDown, BranchUp, Check, ChevronRight, Folder, FolderError, FolderMinus, FolderPlus, Inbox, Layers, LinkOff, Loader, PenLine, Plus, Search, Trash2, X } from "reicon-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import type { ProjectView, SessionView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT, fmt } from "../../lib/locale";
import { loadCheckouts, newChatInDefaultCheckout, refreshSidebar } from "../../lib/checkouts";
import { pickDropTarget, planProjectMove, type ProjectDropHit, type ProjectDropTarget } from "../../lib/projectDrag";
import { pickAndAddProject, startChatInProject } from "../../lib/projects";
import { groupSessionsByProject } from "../../lib/sessions";
import { openSessionWithHistory } from "../../lib/sessionOpen";
import { runSessionBatch } from "../../lib/sessionBatch";
import { formatSessionFullTime, formatSessionTime } from "../../lib/sessionTime";
import { sessionTitleForDisplay } from "../../lib/sessionTitle";
import { isCommitTaskRunning, pushWorkspace } from "../../lib/commitTasks";
import { isMacKeyboard } from "../../lib/platform";
import { useText } from "../../lib/useText";
import { ConfirmDialog } from "../ConfirmDialog";
import { DropLine } from "./DropLine";
import { RowAction } from "./RowAction";
import { SidebarBottom } from "./SidebarBottom";
import { SidebarTop } from "./SidebarTop";
import { WorkspaceGroupDialog } from "./WorkspaceGroupDialog";

/** 每次「继续扫描」新增的窗口（与后端默认窗口一致，见 `commands::scan_window`）。 */
const SCAN_STEP = 500;
/** 扫描窗口上限：再大也不该一次解析上万个文件（后端同样夹到 5000）。 */
const SCAN_MAX = 5000;

/**
 * 拖拽会话（V26）：指针按下后先进「待定」，移动超过 4px 才激活（不影响点击）。
 * 高频数据放在 ref 里跑（指针移动本身不触发渲染），只有「激活 / 落点变化」才写 state。
 */
type DragSession = {
 projectId: string;
 pointerId: number;
 startX: number;
 startY: number;
 x: number;
 y: number;
 active: boolean;
 target: ProjectDropTarget | null;
};

/**
 * 会话行（V1–V10 的形状）：`● 标题 … 时间 [归档 · 删除]`。
 *
 * - 标题单行省略；右侧等宽短时间 = **紧凑相对时间**（刚刚 / N分 / N小时 / N天，对齐 ZCode 任务
 *   列表行；2026-10-13 前是固定 68px 的 `10/13 09:12`，窄侧栏里必截）——完整绝对时间在悬停
 *   `title` 上；
 * - **行级动作 = 悬浮图标（V43）**：行 hover / 聚焦时在时间右侧浮现「归档会话」/「删除对话」
 *   两枚裸图标键（删除先走 `ConfirmDialog`，真删 jsonl 会话文件）；
 * - 行首绿点 = 该会话的聊天进程在跑（后端 `running` 快照）；已损坏的会话标题落 `t.corrupt`；
 * - 点击 = 打开会话（`openSessionWithHistory`：起 / 聚焦长驻 RPC 并拉历史）。
 */
function SessionRow({
 s,
 busy,
 onArchive,
 onDelete,
}: {
 s: SessionView;
 busy: boolean;
 onArchive: (ids: string[]) => void;
 onDelete: (ids: string[]) => void;
}) {
 const activeSessionId = useApp((st) => st.activeSessionId);
 const locale = useApp((st) => st.locale);
 const unread = useApp((st) => !!st.unreadBySession[s.id]);
 const t = useText();
 const [confirmDelete, setConfirmDelete] = useState(false);
 const active = s.id === activeSessionId;
 // 行内 = 紧凑相对时间（ZCode 口径）；完整时间进悬停 title。
 const time = s.corrupt ? t.corrupt : formatSessionTime(s.timestamp, t);
 const fullTime = formatSessionFullTime(s.timestamp, locale);
 // 标题显示口径：去掉开头的 Nerd Font 图标码位（见 `lib/sessionTitle.ts`）；数据保持原样。
 const title = sessionTitleForDisplay(s.title);
 return (
  <>
   <div
    className={`group relative flex h-8 min-w-0 items-center rounded-md pr-1 pl-2 transition-colors duration-100 ${active ? "bg-active" : "hover:bg-hover"}`}
   >
    <button
     onClick={() => {
      // 打开即已读（v2 完成标）：先清标记，再走打开链路
      useApp.getState().clearUnread(s.id);
      void openSessionWithHistory(s.id, s);
     }}
     className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
     aria-label={fmt(t.chatAria, title)}
    >
     <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-semibold" : ""}`}>{title}</span>
    </button>
    {/* 互斥槽（V43 二次口径）：不悬浮时显示「状态标 + 时间」，悬浮 / 聚焦整行时淡出、动作键淡入——
        按钮常驻占位（决定槽宽，标题零重排），状态与时间是绝对定位的覆盖层（pointer-events-none）；
        聚焦判定 = `group-has-focus-visible`（键盘 Tab 到按钮才显形）。 */}
    <span className="relative flex shrink-0 items-center justify-end">
     <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-has-focus-visible:opacity-100">
      <RowAction label={s.running ? t.archiveChatRunning : t.archiveChat} icon={Archive} disabled={busy} onClick={() => onArchive([s.id])} />
      <RowAction label={t.deleteChat} title={t.sessDeleteConfirm} icon={Trash2} danger disabled={busy} onClick={() => setConfirmDelete(true)} />
     </span>
     <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 transition-opacity duration-100 group-hover:opacity-0 group-has-focus-visible:opacity-0">
      {/* 运行状态标（v2 §1.1）：running 转圈 / 后台跑完未读给勾；都没有时不占位 */}
      {s.running ? (
       <span className="flex shrink-0 text-accent" title={t.statusRunning} aria-label={t.statusRunning}>
        <Loader size={11} className="animate-spin" aria-hidden />
       </span>
      ) : unread ? (
       <span className="flex shrink-0 text-ok" title={t.statusDone} aria-label={t.statusDone}>
        <Check size={11} aria-hidden />
       </span>
      ) : null}
      <span className="font-mono text-[11px] text-faint" title={fullTime}>
       {time}
      </span>
     </span>
    </span>
   </div>
   <ConfirmDialog
    open={confirmDelete}
    danger
    title={title}
    detail={t.sessDeleteConfirm}
    confirmLabel={t.delete}
    onConfirm={() => {
     setConfirmDelete(false);
     onDelete([s.id]);
    }}
    onCancel={() => setConfirmDelete(false)}
   />
  </>
 );
}

/**
 * 左栏（v1 起唯一形态的左栏）：会话搜索 → **工作区标题行**（`Layers` 新建工作区、
 * `FolderPlus` 添加项目——同一条数据链、同一个对话框）→ **按工作区分段**
 * （V21 容器的投影：工作区头 = 名字 + 成员项目数，成员项目内是「项目分组（进行中会话列表）」；
 * 有自定义工作区才分段，没有就平铺；没进组的项目收进「未分组」段；空工作区不占段，
 * 拖拽中临时占一段当落区）→ 「未归属会话」组 → 扫描窗口提示；顶部与底部（顶栏 / 设置·语言·皮肤）。
 *
 * - 数据 = `list_sessions`（**本组件局部持有**，不写 `store.sessions`——那一份是聊天视图
 *   「已知会话」的合并集，窗口外的老会话不该被它顶掉）；项目 / 工作区清单用全局
 *   `projects` / `workspaceGroups`（都为空时各兜底拉一次）；
 * - 刷新时机：挂载、会话切换后（新建会话与 running 标记靠它进列表，防抖 400ms）、
 *   归档与添加项目后；「继续扫描」按 `SCAN_STEP` 递增窗口重拉；
 * - **项目拖拽排序（V26 控制器，v1 从终端左栏迁移进来）**：项目头按住后移动 → 幽灵跟手 +
 *   插入线指示落点，松开 → 一次 `move_project`（全局顺序 + 归属一次写）。落点判定读 DOM 矩形
 *   （`data-group-drop` 容器 / `data-proj-row` 项目块）与 `lib/projectDrag.ts` 的纯规则；
 *   拖到「未分组」= 移出工作区；贴上下缘自动滚动；
 * - **常驻挂载**：切去设置视图只是被覆盖，卸载会丢掉列表、搜索词与滚动位置。
 *
 * 边界：搜索只过滤**标题 / 目录**（V2 M7b 的正文搜索随 V11 的左栏会话列表删除，
 * 要回来得先恢复后端 `search_sessions` 并定交互）。列表只列**进行中**的会话，
 * 已归档的在设置 ›「已归档对话」里管理。工作区：新建走标题行的 `Layers`，**编辑 / 删除在段头**。
 * 行级动作（V43）全部是 hover 悬浮图标：会话行 =「归档会话 / 删除对话」（删除真删
 * jsonl，先走 ConfirmDialog）；项目分组头 =「新建会话 / 移除项目 / 归档本项目全部对话 /
 * 删除本项目全部对话」（后两项只在本项目列得出进行中会话时出现；「移除项目」只解绑覆盖层，
 * 走 ConfirmDialog）；「未归属会话」组 =「归档全部 / 删除全部未归属对话」。
 */
export function ChatSidebar() {
 const t = useText();
 const projects = useApp((s) => s.projects);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const activeSessionId = useApp((s) => s.activeSessionId);
 // 已打开会话的实时视图（标题真相）：改名 / 首条回退 / title_change 实时帧只写 store，
 // 本地扫描列表靠它覆盖行标题，否则改名后侧栏 permanent 陈旧（改名根本不触发重扫）。
 const storeSessions = useApp((s) => s.sessions);
 // git 行徽章的数据（刷新时机由 App 的 useWorkspaceGitRefresh 统一管）。
 const gitStates = useApp((s) => s.workspaceGitStates);
 const commitTasks = useApp((s) => s.commitTasks);
 // 目录行：项目头的分支 / 上游徽章判定用（主目录那一行；与 git 快照同源）。
 const checkouts = useApp((s) => s.checkouts);
 /** 新建会话入口（本组第一行钮 / ⌘T）的失败文案：与本地 `error` 共用下面同一条错误条。 */
 const newChatError = useApp((s) => s.newChatError);
 const [sessions, setSessions] = useState<SessionView[]>([]);
 const [scan, setScan] = useState<{ total: number; scanned: number }>({ total: 0, scanned: 0 });
 const [loaded, setLoaded] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 /** 工作区对话框：null = 关；`group: null` = 新建。 */
 const [groupDialog, setGroupDialog] = useState<{ group: WorkspaceView | null } | null>(null);
 /** 删除工作区的二次确认（段头悬浮图标入口）。 */
 const [confirmDelete, setConfirmDelete] = useState<WorkspaceView | null>(null);
 /** 移除项目的二次确认（项目分组头悬浮图标入口；只解绑覆盖层，不删文件）。 */
 const [confirmRemoveProject, setConfirmRemoveProject] = useState<ProjectView | null>(null);
 /** 「删除全部对话」的二次确认（项目分组头 / 未归属组悬浮图标，2026-10-13）：ids = 触发时列出的进行中对话。 */
 const [confirmDeleteAll, setConfirmDeleteAll] = useState<string[] | null>(null);
 /** 当前扫描窗口：state 给「继续扫描」按钮显示，ref 给不依赖它的 `reload` 读最新值。 */
 const [limit, setLimit] = useState(SCAN_STEP);
 const limitRef = useRef(SCAN_STEP);
 /** 拖拽中：被拖的项目 + 当前落点（落点画插入线；项目行留在原地压暗）。 */
 const [drag, setDrag] = useState<{ projectId: string; target: ProjectDropTarget | null } | null>(null);
 const scrollRef = useRef<HTMLDivElement | null>(null);
 const ghostRef = useRef<HTMLDivElement | null>(null);
 const dragRef = useRef<DragSession | null>(null);
 const rafRef = useRef(0);
 /** 拖完那一下松手会补一个 click（落在项目头上会误触折叠）：吞掉它。 */
 const swallowClickRef = useRef(false);
 /** 上一份 running 快照（v2 完成未读：对比出「后台刚跑完」的会话）。 */
 const runningRef = useRef(new Map<string, boolean>());

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
   // 完成未读标记（v2 左栏状态标）：后台会话的起止只有这份列表快照看得到——
   // running → 非 running 且不在前台 = 刚跑完一轮、用户还没看。前台会话不标（用户正看着）。
   const prev = runningRef.current;
   const next = new Map<string, boolean>();
   const activeSid = useApp.getState().activeSessionId;
   for (const s of page.sessions) {
    next.set(s.id, !!s.running);
    if (prev.get(s.id) === true && !s.running && s.id !== activeSid) {
     useApp.getState().markUnread(s.id);
    }
   }
   runningRef.current = next;
  } catch (e) {
   setLoaded(true);
   setError(e instanceof Error ? e.message : String(e));
  }
 }, []);

 // 挂载就重扫一次（其他形态 / omp TUI 里归档过的会话、新建的会话都能见到）。
 // 项目清单与工作区清单随侧栏一起拉；这里只兜冷路径（一个项目都没有 / 有项目但
 // 工作区还没拉回来），都只做一次。
 const coldLoaded = useRef(false);
 useEffect(() => {
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
 }, [reload]);

 // 会话切换（新建 / 打开 / 改名回读）后防抖补一次：新会话与 running 标记靠这一趟进列表。
 const prevSid = useRef(activeSessionId);
 useEffect(() => {
  if (prevSid.current === activeSessionId) return;
  prevSid.current = activeSessionId;
  const timer = window.setTimeout(() => void reload(), 400);
  return () => window.clearTimeout(timer);
 }, [activeSessionId, reload]);

 /**
  * 左栏拖拽（V26 控制器，v1 从终端左栏迁移）：项目头按住后移动 → 幽灵跟手 + 插入线指示落点，
  * 松开 → 一次 `move_project`（全局顺序 + 归属一次写）。落点判定读 DOM 矩形
  * （`data-group-drop` 容器 / `data-proj-row` 项目块）与 `lib/projectDrag.ts` 的纯规则；
  * 拖到「未分组」= 移出工作区；贴上下缘自动滚动。
  */
 useEffect(() => {
  /** 视觉顺序的落点条目：容器（段头 / 空段落区 / 段的空白区）+ 项目块。 */
  const buildHits = (): ProjectDropHit[] => {
   const scroll = scrollRef.current;
   if (scroll === null) return [];
   const list = useApp.getState().projects;
   const hits: ProjectDropHit[] = [];
   for (const el of scroll.querySelectorAll<HTMLElement>("[data-group-drop]")) {
    const r = el.getBoundingClientRect();
    hits.push({ kind: "container", containerId: el.dataset.groupDrop || null, top: r.top, bottom: r.bottom });
   }
   for (const el of scroll.querySelectorAll<HTMLElement>("[data-proj-row]")) {
    const id = el.dataset.projRow;
    if (id === undefined) continue;
    const r = el.getBoundingClientRect();
    hits.push({
     kind: "row",
     projectId: id,
     containerId: list.find((p) => p.id === id)?.workspaceId ?? null,
     top: r.top,
     bottom: r.bottom,
    });
   }
   hits.sort((a, b) => a.top - b.top);
   return hits;
  };

  /** 指针位置 → 落点；指到列表外（别的面板 / 侧栏头部）一律 null = 松开即取消。 */
  const targetAt = (x: number, y: number, projectId: string): ProjectDropTarget | null => {
   const scroll = scrollRef.current;
   if (scroll === null) return null;
   const r = scroll.getBoundingClientRect();
   if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
   return pickDropTarget(buildHits(), y, projectId);
  };

  const tick = () => {
   const s = dragRef.current;
   if (s === null || !s.active) return;
   const scroll = scrollRef.current;
   if (scroll !== null) {
    const r = scroll.getBoundingClientRect();
    const inside = s.x >= r.left && s.x <= r.right && s.y >= r.top && s.y <= r.bottom;
    if (inside) {
     // 贴上下缘自动滚动：长列表里拖到远处时不用先手动滚一遍
     if (s.y < r.top + 28) scroll.scrollTop -= 12;
     else if (s.y > r.bottom - 28) scroll.scrollTop += 12;
    }
    const next = inside ? pickDropTarget(buildHits(), s.y, s.projectId) : null;
    if (next?.containerId !== s.target?.containerId || next?.beforeId !== s.target?.beforeId) {
     s.target = next;
     setDrag({ projectId: s.projectId, target: next });
    }
   }
   const ghost = ghostRef.current;
   if (ghost !== null) ghost.style.transform = `translate3d(${s.x + 12}px, ${s.y + 8}px, 0)`;
   rafRef.current = window.requestAnimationFrame(tick);
  };

  const end = () => {
   dragRef.current = null;
   if (rafRef.current !== 0) {
    window.cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
   }
   document.body.style.cursor = "";
   document.body.style.userSelect = "";
   setDrag(null);
  };

  /** 落地：顺序 + 归属一次写；顺序与归属都没变（原地松开）不发请求。 */
  const commit = (movedId: string, target: ProjectDropTarget) => {
   const plan = planProjectMove(useApp.getState().projects, movedId, target);
   if (!plan.changed) return;
   void api
    .moveProject(movedId, plan.containerId, plan.order)
    .then((list) => {
     useApp.getState().set({ projects: list });
    })
    .catch((e: unknown) => {
     setError(e instanceof Error ? e.message : TEXT[useApp.getState().locale].projDragFailed);
    });
  };

  const onMove = (e: PointerEvent) => {
   const s = dragRef.current;
   if (s === null || e.pointerId !== s.pointerId) return;
   s.x = e.clientX;
   s.y = e.clientY;
   if (s.active) return;
   if (Math.abs(e.clientX - s.startX) + Math.abs(e.clientY - s.startY) < 4) return;
   s.active = true;
   swallowClickRef.current = true;
   document.body.style.userSelect = "none";
   document.body.style.cursor = "grabbing";
   setDrag({ projectId: s.projectId, target: null });
   rafRef.current = window.requestAnimationFrame(tick);
  };

  const onUp = (e: PointerEvent) => {
   const s = dragRef.current;
   if (s === null || e.pointerId !== s.pointerId) return;
   const active = s.active;
   const movedId = s.projectId;
   s.x = e.clientX;
   s.y = e.clientY;
   const target = active ? targetAt(s.x, s.y, movedId) : null;
   end();
   if (target !== null) commit(movedId, target);
   // 松手后浏览器补的那个 click 在下一个任务里到
   window.setTimeout(() => {
    swallowClickRef.current = false;
   }, 0);
  };

  const onCancel = (e: PointerEvent) => {
   const s = dragRef.current;
   if (s !== null && e.pointerId === s.pointerId) end();
  };

  const onKey = (e: KeyboardEvent) => {
   if (e.key === "Escape" && dragRef.current?.active) end();
  };

  const onClick = (e: MouseEvent) => {
   if (!swallowClickRef.current) return;
   swallowClickRef.current = false;
   e.stopPropagation();
   e.preventDefault();
  };

  const onBlur = () => {
   if (dragRef.current?.active) end();
  };

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("click", onClick, true);
  window.addEventListener("blur", onBlur);
  return () => {
   window.removeEventListener("pointermove", onMove);
   window.removeEventListener("pointerup", onUp);
   window.removeEventListener("pointercancel", onCancel);
   window.removeEventListener("keydown", onKey, true);
   window.removeEventListener("click", onClick, true);
   window.removeEventListener("blur", onBlur);
   if (rafRef.current !== 0) window.cancelAnimationFrame(rafRef.current);
   document.body.style.cursor = "";
   document.body.style.userSelect = "";
  };
 }, []);

 /** 项目头按下（左键）：只登记会话，移动到 4px 之外才真正开始拖。 */
 const startProjectDrag = (projectId: string, e: React.PointerEvent<HTMLElement>) => {
  swallowClickRef.current = false;
  if (e.button !== 0 || dragRef.current !== null) return;
  if ((e.target as HTMLElement | null)?.closest("[data-project-drag]") == null) return;
  dragRef.current = {
   projectId,
   pointerId: e.pointerId,
   startX: e.clientX,
   startY: e.clientY,
   x: e.clientX,
   y: e.clientY,
   active: false,
   target: null,
  };
 };

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

 /** 删除（会话行右键菜单）：真删 jsonl 会话文件、不可恢复——确认后走 `runSessionBatch`（分批 + 失败聚合）。 */
 const removeSessions = async (ids: string[]) => {
  if (ids.length === 0 || busy) return;
  setBusy(true);
  setError(null);
  try {
   const res = await runSessionBatch("delete", ids);
   await reload();
   if (res.failed.length > 0) {
    setError(fmt(t.sessBatchFailed, res.failed.length, res.failed.map((f) => f.message || f.id).join("；")));
   }
  } catch (e) {
   setError(e instanceof Error ? e.message : t.batchDeleteFailed);
  } finally {
   setBusy(false);
  }
 };

 /** 添加项目（标题行的 `FolderPlus`）：只写覆盖层；目录行与工作区树同步刷新，回来即是最新树。 */
 const addProject = async () => {
  const res = await pickAndAddProject();
  if (res && !res.ok) setError(res.message);
  if (res?.ok) {
   void loadCheckouts().catch(() => undefined);
   await reload();
  }
 };

 /**
  * 工作区变更后的刷新（新建工作区 / 对话框里就地加目录）：项目清单 + 目录行 / 工作区清单
  * ——走 `refreshSidebar`（项目归属变了必须重拉项目行，否则新工作区在左栏是「没有成员的空组」
  * 而不占段），再补一趟会话列表（新成员的会话立刻进列表）。刷新失败落内联错误条；
  * `reload` 成功会清错误，所以那句必须排在它后面。
  */
 const refreshWorkspaces = async () => {
  const res = await refreshSidebar();
  await reload();
  if (!res.ok && res.message) setError(res.message);
 };

 /** 删除工作区（段头悬浮图标入口）：成员回归未分组，不删项目 / 文件。 */
 const removeGroup = async (group: WorkspaceView) => {
  setError(null);
  try {
   await api.deleteWorkspace(group.id);
   await refreshWorkspaces();
  } catch (e) {
   setError(e instanceof Error ? e.message : t.wsGroupFailed);
  }
 };

 /** 移除项目（项目头悬浮图标入口，v1 自终端左栏迁移过来）：只解除覆盖层绑定，不删任何文件；
  *  该项目下的会话会被后端标记为已归档（在设置 ›「已归档对话」里找）。 */
 const removeProject = async (project: ProjectView) => {
  setError(null);
  try {
   await api.removeProject(project.id);
   await refreshWorkspaces();
  } catch (e) {
   setError(e instanceof Error ? e.message : t.projRemoveFailed);
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

 /**
  * 工作区分段（V21 容器在左栏的投影）：有自定义工作区时按组分段
  * （工作区头 = 名字 + 成员项目数，成员项目沿用下面的项目分组），没进组的收进「未分组」；
  * 没有自定义工作区时返回 `null` = 平铺（单项目 / 未分组用户无感）。
  * 空工作区平时不占段（聊天这里没有可聊的会话）；**拖拽中临时占一段当落区**
  * （拖进空组 = 加入成员，拖到空的「未分组」= 移出工作区）。
  */
 const dragging = drag !== null;
 const sections = useMemo<{ key: string; name: string | null; projectIds: string[] }[] | null>(() => {
  if (workspaceGroups.length === 0) return null;
  const out: { key: string; name: string | null; projectIds: string[] }[] = [];
  for (const g of workspaceGroups) {
   const ids = projects.filter((p) => p.workspaceId === g.id).map((p) => p.id);
   if (ids.length > 0 || dragging) out.push({ key: g.id, name: g.name, projectIds: ids });
  }
  const ungrouped = projects.filter((p) => p.workspaceId === null).map((p) => p.id);
  if (ungrouped.length > 0 || dragging) out.push({ key: "__ungrouped", name: null, projectIds: ungrouped });
  return out.length > 0 ? out : null;
 }, [workspaceGroups, projects, dragging]);

 /** 项目分组头的 git 状态徽章（dirty 点 / 待推送（可点）/ 落后（只读）/ 上游缺失标记 / 任务态（可点开面板））：按项目主目录的快照取。无快照时不占位。 */
 const gitBadgesFor = (project: ProjectView) => {
  if (project.missing) return null;
  const gs = gitStates[project.path];
  if (!gs?.isRepo) return null;
  const task = commitTasks[project.path];
  const running = task ? isCommitTaskRunning(task.phase) : false;
  const failed = task?.phase === "failed";
  const dirty = gs.dirty;
  const ahead = gs.ahead;
  const behind = gs.behind;
  // 上游缺失提示：没有上游 / 上游已被远程删除 → 与远程**无法比较**，不能留白
  // （否则会被读成「与远程一致」）。正常上游返回 null——差异由 ahead / behind 徽章表达；
  // detached（主目录没有分支名）与非仓库不标。
  const mainBranch = checkouts.find((c) => c.projectId === project.id && c.isMain)?.branch ?? null;
  const upstreamNote = mainBranch === null
   ? null
   : gs.upstreamGone
    ? fmt(t.gitUpstreamGoneTitle, gs.upstream ?? "")
    : gs.upstream === null
     ? t.gitNoUpstreamTitle
     : null;
  if (!dirty && ahead <= 0 && behind <= 0 && !running && !failed && upstreamNote === null) return null;
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
       pushWorkspace(project.path);
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
       useApp.getState().setActiveCommitCwd(project.path);
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
       useApp.getState().setActiveCommitCwd(project.path);
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
 /** 一个项目分组（分组头 + 进行中会话列表）：平铺与工作区分段两种排布共用同一份；
  *  `dragging` = 拖拽控制器正压暗这一行（落点由插入线表达）。 */
 const projectBlock = (project: ProjectView, active: SessionView[], dragging: boolean) => {
  return (
   <details
    key={project.id}
    data-proj-row={project.id}
    className={`group/proj mt-1 transition-opacity duration-100 ${dragging ? "opacity-40" : ""}`}
    open
   >
    {/* 项目头没有折叠箭头——点击整行即展开 / 收起；`data-project-drag` 区 = 拖拽手柄
        （按下后移动超过 4px 才真的开始拖，见拖拽控制器）。行级操作为 hover 悬浮图标（V43）：
        新建会话 / 移除项目 / 归档全部 / 删除全部——「提交」入口先行移除 */}
    <summary
     onPointerDown={(e) => startProjectDrag(project.id, e)}
     className="group/projhead relative flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden"
    >
     <Folder size={14} aria-hidden className={`shrink-0 transition-colors duration-100 ${project.missing ? "text-warn" : "text-muted group-open/proj:text-foreground"}`} />
     <span data-project-drag className="min-w-0 flex-1 truncate" title={t.projDragHint}>
      <span className="font-semibold text-foreground">{project.name}</span>
      {project.missing ? (
       <span className="ml-1.5 rounded bg-warn/15 px-1 py-px text-[11px] text-warn">{t.missingFolder}</span>
      ) : (
       <span className="ml-1.5 truncate font-mono text-[11px] text-faint">{project.path}</span>
      )}
     </span>
     {gitBadgesFor(project)}
     <span className="relative flex shrink-0 items-center justify-end">
      <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/projhead:opacity-100 group-has-focus-visible/projhead:opacity-100">
       <RowAction label={fmt(t.newSessionIn, project.name)} title={t.newSession} icon={Plus} disabled={project.missing || busy} onClick={() => void newChat(project)} />
       <RowAction label={t.projRemove} title={fmt(t.projRemoveTitle, project.name)} icon={FolderMinus} danger onClick={() => setConfirmRemoveProject(project)} />
       {active.length > 0 && (
        <>
         <RowAction label={fmt(t.archiveAllIn, project.name)} title={t.archiveAllInTitle} icon={Archive} disabled={busy} onClick={() => void archive(active.map((s) => s.id))} />
         <RowAction label={fmt(t.deleteAllIn, project.name)} title={t.sessDeleteAllDetail} icon={Trash2} danger disabled={busy} onClick={() => setConfirmDeleteAll(active.map((s) => s.id))} />
        </>
       )}
      </span>
      {active.length > 0 && (
       <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center font-mono text-faint transition-opacity duration-100 group-hover/projhead:opacity-0 group-has-focus-visible/projhead:opacity-0">
        {active.length}
       </span>
      )}
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
      <SessionRow key={s.id} s={s} busy={busy} onArchive={(ids) => void archive(ids)} onDelete={(ids) => void removeSessions(ids)} />
     ))}
    </div>
   </details>
  );
 };

 /** 拖拽落点 / 被拖项目（渲染期取一次，避免在 JSX 里反复判空）。 */
 const dragTarget = drag?.target ?? null;
 const draggingId = drag?.projectId ?? null;

 return (
  <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar">
   {/* 顶栏（红绿灯占位 + 两枚版本 chip） */}
   <SidebarTop />
   <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
    {/* 顶部固定区（v2 §1.1 常驻命令行 + 工作区标题行）：sticky 钉在列表上方，
        `-mx-3 px-3` 让底色铺满容器，滚过去的会话行不会从两侧露出。
        命令行两枚行钮 = 新建会话（主命令，视觉最重）/ 快速切换（⌘K；会话搜索与动作合成一栏）。 */}
    <div className="sticky top-0 z-10 -mx-3 bg-sidebar px-3 pt-1 pb-2">
     <div className="flex flex-col gap-0.5">
      <button
       onClick={() => {
        void newChatInDefaultCheckout().then((r) => useApp.getState().setNewChatError(r.ok ? null : r.message));
       }}
       className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] font-medium text-foreground transition-colors duration-100 hover:bg-hover"
       aria-label={t.newSession}
       title={t.newChatCommandTitle}
      >
       <Plus size={14} aria-hidden className="shrink-0" />
       <span className="min-w-0 flex-1 truncate text-left">{t.newSession}</span>
      </button>
      <button
       onClick={() => useApp.getState().set({ paletteOpen: true })}
       className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
       aria-label={t.quickSwitch}
       title={t.quickSwitch}
      >
       <Search size={14} aria-hidden className="shrink-0" />
       <span className="min-w-0 flex-1 truncate text-left">{t.quickSwitch}</span>
       <kbd className="shrink-0 text-[10px] text-faint">{isMacKeyboard() ? "⌘K" : "Ctrl+K"}</kbd>
      </button>
     </div>
     {/* 工作区标题行（标题在左、两枚键在右）：`Layers` = 新建工作区（`WorkspaceGroupDialog`）、
         `FolderPlus` = 添加项目（`pickAndAddProject`）。 */}
     <div className="mt-2 flex shrink-0 items-center gap-2 px-1 text-[11px] font-medium tracking-wide text-faint">
      <span className="min-w-0 flex-1 truncate">{t.workspaceTitle}</span>
      <button
       onClick={() => setGroupDialog({ group: null })}
       aria-label={t.wsGroupNew}
       title={t.wsGroupNewTitle}
       className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       <Layers size={14} aria-hidden />
      </button>
      <button
       onClick={() => void addProject()}
       aria-label={t.sidebarAddProjectAria}
       title={t.sidebarAddProjectTitle}
       className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       <FolderPlus size={14} aria-hidden />
      </button>
     </div>
    </div>
    {(error ?? newChatError) && (
     <div role="alert" className="mb-1 flex items-start gap-2 rounded-md border border-danger/40 bg-danger/5 px-2 py-1.5 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{error ?? newChatError}</span>
      <button
       onClick={() => {
        setError(null);
        useApp.getState().setNewChatError(null);
       }}
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
      {sections === null ? (
       /* 平铺模式（没有自定义工作区）：全部项目同属「未分组」容器——整段是拖拽落区 */
       <div data-group-drop="">
        {groups.map(({ project, active }) => (
         <Fragment key={project.id}>
          {/* 拖拽落点正好在这一行之前 → 画插入线（零高度，不推挤列表） */}
          {dragTarget?.containerId === null && dragTarget.beforeId === project.id && <DropLine />}
          {projectBlock(project, active, draggingId === project.id)}
         </Fragment>
        ))}
        {dragTarget?.containerId === null && dragTarget.beforeId === null && groups.length > 0 && <DropLine />}
       </div>
      ) : (
       sections.map((section) => {
        // 「未分组」段不可编辑 / 不可删（没有自定义工作区容器可改）；容器 id 为 null
        const sectionGroup = section.key === "__ungrouped" ? null : workspaceGroups.find((g) => g.id === section.key) ?? null;
        const containerId = section.key === "__ungrouped" ? null : section.key;
        const secTarget = dragTarget !== null && dragTarget.containerId === containerId ? dragTarget : null;
        const members = section.projectIds
         .map((id) => groups.find((g) => g.project.id === id))
         .filter((g): g is (typeof groups)[number] => g !== undefined);
        const countLabel = fmt(t.wsGroupCount, String(members.length));
        return (
         <details key={section.key} data-group-drop={section.key === "__ungrouped" ? "" : section.key} className="group/ws mt-2" open>
          {/* 工作区头：没有折叠箭头——点击整行即展开 / 收起，裸 `Layers` 图标（展开时上正文色），
              行尾是成员计数灰字；行级操作为 hover 悬浮图标（「编辑工作区」/「删除工作区」） */}
          <summary className="group/wshead flex cursor-pointer items-center gap-1.5 rounded-md px-1 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
           <Layers size={14} aria-hidden className="shrink-0 text-muted transition-colors duration-100 group-open/ws:text-foreground" />
           <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
            {section.name ?? t.wsGroupUngrouped}
           </span>
           {sectionGroup !== null ? (
            <span className="relative flex shrink-0 items-center justify-end">
             <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/wshead:opacity-100 group-has-focus-visible/wshead:opacity-100">
              <RowAction label={fmt(t.wsGroupEditTitle, sectionGroup.name)} icon={PenLine} onClick={() => setGroupDialog({ group: sectionGroup })} />
              <RowAction label={t.wsGroupDelete} icon={Trash2} danger onClick={() => setConfirmDelete(sectionGroup)} />
             </span>
             <span
              className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-1 font-mono text-[11px] leading-none text-faint transition-opacity duration-100 group-hover/wshead:opacity-0 group-has-focus-visible/wshead:opacity-0"
              title={countLabel}
              aria-label={countLabel}
             >
              {members.length}
             </span>
            </span>
           ) : (
            <span
             className="shrink-0 px-1 font-mono text-[11px] leading-none text-faint"
             title={countLabel}
             aria-label={countLabel}
            >
             {members.length}
            </span>
           )}
          </summary>
          <div className="pl-2">
           {members.map((g) => (
            <Fragment key={g.project.id}>
             {secTarget?.beforeId === g.project.id && <DropLine />}
             {projectBlock(g.project, g.active, draggingId === g.project.id)}
            </Fragment>
           ))}
           {/* 落在容器末尾：线画在最后一个成员之后 */}
           {secTarget !== null && secTarget.beforeId === null && members.length > 0 && <DropLine />}
           {/* 空工作区只在拖拽中占段：整段是落区（「拖到这里加入 / 移出」） */}
           {members.length === 0 && (
            <p
             className={`mx-1 my-1 rounded-md border border-dashed px-3 py-2 text-[11px] leading-relaxed transition-colors duration-100 ${secTarget !== null ? "border-accent/50 bg-accent/5 text-accent" : "border-border text-faint"}`}
            >
             {containerId === null ? t.projDragOut : t.projDragInto}
            </p>
           )}
          </div>
         </details>
        );
       })
      )}
      {orphanActive.length > 0 && (
       <details className="group/orphan mt-1" open>
        <summary className="group/orphhead flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[13px] font-semibold text-muted transition-colors duration-100 hover:bg-hover [&::-webkit-details-marker]:hidden">
         <ChevronRight size={12} aria-hidden className="transition-transform duration-150 group-open/orphan:rotate-90" />
         <Inbox size={13} aria-hidden className="shrink-0 text-faint" />
         <span className="min-w-0 flex-1 truncate">{t.orphanChats}</span>
         <span className="relative flex shrink-0 items-center justify-end">
          <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/orphhead:opacity-100 group-has-focus-visible/orphhead:opacity-100">
           <RowAction label={t.archiveOrphanAll} icon={Archive} disabled={busy} onClick={() => void archive(orphanActive.map((s) => s.id))} />
           <RowAction label={t.deleteOrphanAll} title={t.sessDeleteAllDetail} icon={Trash2} danger disabled={busy} onClick={() => setConfirmDeleteAll(orphanActive.map((s) => s.id))} />
          </span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center font-mono transition-opacity duration-100 group-hover/orphhead:opacity-0 group-has-focus-visible/orphhead:opacity-0">
           {orphanActive.length}
          </span>
         </span>
        </summary>
        <div className="mt-0.5 space-y-px border-l border-border pl-1.5">
         {orphanActive.map((s) => (
          <SessionRow key={s.id} s={s} busy={busy} onArchive={(ids) => void archive(ids)} onDelete={(ids) => void removeSessions(ids)} />
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
   {/* 工作区对话框（V21 的多项目容器）：新建 / 编辑共用——建完 `onChanged` 刷目录行 /
       工作区清单 / 会话列表。 */}
   {groupDialog && (
    <WorkspaceGroupDialog
     key={groupDialog.group?.id ?? "new"}
     group={groupDialog.group}
     onClose={() => setGroupDialog(null)}
     onChanged={refreshWorkspaces}
    />
   )}
   {/* 移除项目的二次确认（项目头悬浮图标入口）：只解绑覆盖层，不删文件 */}
   <ConfirmDialog
    open={confirmRemoveProject !== null}
    danger
    title={fmt(t.projRemoveTitle, confirmRemoveProject?.name ?? "")}
    detail={t.projRemoveBody}
    confirmLabel={t.projRemoveConfirm}
    cancelLabel={t.projRemoveCancel}
    onConfirm={() => {
     const project = confirmRemoveProject;
     setConfirmRemoveProject(null);
     if (project) void removeProject(project);
    }}
    onCancel={() => setConfirmRemoveProject(null)}
   />
   {/* 删除工作区的二次确认（段头悬浮图标入口，V43 起）：成员回归未分组，不删项目 / 文件 */}
   <ConfirmDialog
    open={confirmDelete !== null}
    danger
    title={fmt(t.wsGroupDeleteTitle, confirmDelete?.name ?? "")}
    detail={t.wsGroupDeleteBody}
    confirmLabel={t.wsGroupDelete}
    onConfirm={() => {
     const group = confirmDelete;
     setConfirmDelete(null);
     if (group) void removeGroup(group);
    }}
    onCancel={() => setConfirmDelete(null)}
   />
   {/* 「删除全部对话」的二次确认（项目分组头 / 未归属组悬浮图标，2026-10-13）：真删 jsonl 会话
       文件、不可恢复——确认后走 `runSessionBatch("delete")`（分批 + 失败聚合），范围 = 触发时
       列出的进行中对话（已归档的仍归设置 ›「已归档对话」管） */}
   <ConfirmDialog
    open={confirmDeleteAll !== null}
    danger
    title={fmt(t.sessDeleteAllConfirm, confirmDeleteAll?.length ?? 0)}
    detail={t.sessDeleteAllDetail}
    confirmLabel={t.delete}
    onConfirm={() => {
     const ids = confirmDeleteAll ?? [];
     setConfirmDeleteAll(null);
     if (ids.length > 0) void removeSessions(ids);
    }}
    onCancel={() => setConfirmDeleteAll(null)}
   />
   {/* 拖拽幽灵（V26）：跟手的小卡；定位由 rAF 直写 transform，不进 React 渲染 */}
   {drag !== null && createPortal(
    <div
     ref={ghostRef}
     aria-hidden
     data-drag-ghost={drag.projectId}
     className="pointer-events-none fixed top-0 left-0 z-30 flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-elevated px-2.5 py-1.5 text-[13px] font-semibold text-foreground shadow-pop will-change-transform"
    >
     <Folder size={13} aria-hidden className="shrink-0 text-muted" />
     <span className="min-w-0 truncate">{projects.find((p) => p.id === drag.projectId)?.name ?? ""}</span>
    </div>,
    document.body,
   )}
  </aside>
 );
}
