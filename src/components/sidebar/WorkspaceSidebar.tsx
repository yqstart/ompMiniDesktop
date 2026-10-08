import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Folder, FolderPlus, Layers, Search, Settings, X } from "reicon-react";
import { api } from "@shared/api";
import type { ProjectView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { loadCheckouts } from "../../lib/checkouts";
import { pickDropTarget, planProjectMove, type ProjectDropHit, type ProjectDropTarget } from "../../lib/projectDrag";
import { pickAndAddProject } from "../../lib/projects";
import { isMacKeyboard } from "../../lib/termInput";
import { TEXT } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { LanguageToggle } from "../LanguageToggle";
import { ThemeToggle } from "../ThemeToggle";
import { AppUpdateChip } from "./AppUpdateChip";
import { DropLine } from "./DropLine";
import { OmpUpdateChip } from "./OmpUpdateChip";
import { ProjectGroup } from "./ProjectGroup";
import { SessionPopup } from "./SessionPopup";
import { WorkspaceGroupDialog } from "./WorkspaceGroupDialog";
import { WorkspaceGroupSection } from "./WorkspaceGroupSection";
/** 左栏刷新：项目列表 + 工作区 / 目录行清单（项目增删 / 重定位 / 移除 / 工作区编辑后都回这里）。 */
async function refreshSidebar(): Promise<{ ok: boolean; message: string | null }> {
 const [projects, checkouts] = await Promise.all([
  api.listProjects().then((list) => ({ ok: true as const, list })).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })),
  loadCheckouts().then((list) => ({ ok: true as const, list })).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })),
 ]);
 if (projects.ok) useApp.getState().set({ projects: projects.list });
 const failed: string[] = [];
 if (!projects.ok) failed.push(projects.message);
 if (!checkouts.ok) failed.push(checkouts.message);
 return failed.length === 0 ? { ok: true, message: null } : { ok: false, message: failed.join("；") };
}

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

export function WorkspaceSidebar() {
 const projects = useApp((s) => s.projects);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const checkouts = useApp((s) => s.checkouts);
 const t = useText();
 const [error, setError] = useState<string | null>(null);
 const [sessionsFor, setSessionsFor] = useState<ProjectView | null>(null);
 const [groupDialog, setGroupDialog] = useState<{ group: WorkspaceView | null } | null>(null);
 const [loading, setLoading] = useState(true);
 /** 拖拽中：被拖的项目 + 当前落点（落点画插入线；项目行留在原地压暗）。 */
 const [drag, setDrag] = useState<{ projectId: string; target: ProjectDropTarget | null } | null>(null);
 const scrollRef = useRef<HTMLDivElement | null>(null);
 const ghostRef = useRef<HTMLDivElement | null>(null);
 const dragRef = useRef<DragSession | null>(null);
 const rafRef = useRef(0);
 /** 拖完那一下松手会补一个 click（点在项目头上会误触折叠）：吞掉它。 */
 const swallowClickRef = useRef(false);
 const itemsFor = (projectId: string) => checkouts.filter((w) => w.projectId === projectId);
 const refresh = async () => {
  const res = await refreshSidebar();
  setError(res.ok ? null : res.message);
 };

 useEffect(() => {
  void refreshSidebar().then((res) => {
   if (!res.ok && res.message) setError(res.message);
   setLoading(false);
  });
 }, []);

 /**
  * 左栏拖拽（V26）：项目头按住后移动 → 幽灵跟手 + 插入线指示落点，松开 → 一次 `move_project`
  * （全局顺序 + 归属一次写）。落点判定读 DOM 矩形（`data-group-drop` 容器 / `data-proj-row` 项目块）
  * 与 `lib/projectDrag.ts` 的纯规则；贴上下缘自动滚动。
  */
 useEffect(() => {
  /** 视觉顺序的落点条目：容器（组头 / 空组 / 组的空白区）+ 项目块。 */
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
     // 归属变了 → 组视图范围跟着变（不变式：激活终端必须落在当前范围里，同 selectGroup）
     const sel = useApp.getState().selection;
     if (sel?.kind === "group") useApp.getState().selectGroup(sel.id);
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

 const retry = () => {
  setLoading(true);
  void refreshSidebar().then((res) => {
   setError(res.ok ? null : res.message);
   setLoading(false);
  });
 };

 return (
  <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar">
   <div data-tauri-drag-region className="h-10 shrink-0" aria-hidden />
   <div className="shrink-0 px-3 pb-3">
    <div data-tauri-drag-region className="flex h-9 items-center gap-2 px-1 pb-2">
     <span className="pointer-events-none text-[14px] font-semibold tracking-tight text-foreground">
      <span className="font-mono text-accent">omp</span>MiniDesktop
     </span>
     {/* 字标行右端 = 两个更新入口（V30）：本应用版本 chip + omp 运行时版本 chip */}
     <div className="ml-auto flex min-w-0 items-center gap-1.5">
      <AppUpdateChip />
      <OmpUpdateChip />
     </div>
    </div>
    <button
     onClick={() => useApp.getState().set({ quickSwitcherOpen: true })}
     aria-label={t.quickSwitcherAria}
     title={t.quickSwitcherTitle}
     className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-foreground transition-colors duration-100 hover:border-accent/30 hover:bg-hover"
    >
     <Search size={14} aria-hidden className="shrink-0 text-muted" />
     <span className="min-w-0 flex-1 truncate text-left">{t.quickSwitcher}</span>
     <kbd className="shrink-0 font-mono text-[11px] text-faint">{isMacKeyboard() ? "⇧⌘K" : "Ctrl+Shift+K"}</kbd>
    </button>
   </div>
   {
    error && (
     <div className="mx-3 mb-3 flex items-start gap-2 rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[11px] leading-relaxed text-danger">
      <span className="min-w-0 flex-1">{error}</span>
      <button
       onClick={() => setError(null)}
       className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm opacity-70 transition-opacity duration-100 hover:opacity-100"
       aria-label={t.dismissError}
      >
       <X size={12} />
      </button>
     </div>
    )
   }
   <div className="flex shrink-0 items-center gap-2 px-4 pb-2 text-[11px] font-medium tracking-wide text-faint">
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
     onClick={async () => {
      const res = await pickAndAddProject();
      if (res && !res.ok) setError(res.message);
      if (res?.ok) void refreshSidebar();
     }}
     aria-label={t.sidebarAddProjectAria}
     title={t.sidebarAddProjectTitle}
     className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     <FolderPlus size={14} aria-hidden />
    </button>
   </div>
   <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
    <div aria-busy={loading}>
     {loading ? (
      <p role="status" className="mx-1 px-3 py-4 text-[13px] text-muted">{t.archivedLoading}</p>
     ) : (
      <>
       {workspaceGroups.map((group) => (
        <WorkspaceGroupSection
         key={group.id}
         group={group}
         projects={projects.filter((p) => p.workspaceId === group.id)}
         itemsFor={itemsFor}
         onEdit={(g) => setGroupDialog({ group: g })}
         onChanged={refresh}
         onError={setError}
         onOpenSessions={setSessionsFor}
         dragActive={drag !== null}
         draggingId={drag?.projectId ?? null}
         dropTarget={drag?.target ?? null}
         onDragStart={startProjectDrag}
        />
       ))}
       {/* 「未分组」区：有未分组项目时常驻；拖拽中也渲染（空区 = 「拖到这里移出工作区」的落点） */}
       {workspaceGroups.length > 0 && (drag !== null || projects.some((p) => p.workspaceId === null)) && (
        <WorkspaceGroupSection
         group={null}
         projects={projects.filter((p) => p.workspaceId === null)}
         itemsFor={itemsFor}
         onEdit={null}
         onChanged={refresh}
         onError={setError}
         onOpenSessions={setSessionsFor}
         dragActive={drag !== null}
         draggingId={drag?.projectId ?? null}
         dropTarget={drag?.target ?? null}
         onDragStart={startProjectDrag}
        />
       )}
       {workspaceGroups.length === 0 && projects.map((project) => (
        <Fragment key={project.id}>
         {/* 平铺模式（没有自定义工作区）没有容器段：全部项目同属「未分组」容器 */}
         {drag?.target?.containerId === null && drag.target.beforeId === project.id && <DropLine />}
         <ProjectGroup
          project={project}
          items={itemsFor(project.id)}
          dragging={drag?.projectId === project.id}
          onChanged={refresh}
          onError={setError}
          onOpenSessions={() => setSessionsFor(project)}
          onDragStart={startProjectDrag}
         />
        </Fragment>
       ))}
       {drag?.target?.containerId === null && drag.target.beforeId === null && workspaceGroups.length === 0 && projects.length > 0 && <DropLine />}
       {projects.length === 0 && !error && (
        <p className="mx-1 rounded-lg border border-dashed border-border px-3 py-4 text-[13px] leading-relaxed text-muted">{t.noProjectsAdd}</p>
       )}
       {error && projects.length === 0 && (
        <div className="mx-1 flex flex-col items-start gap-2 rounded-lg border border-danger/20 bg-danger/10 px-3 py-4">
         <p role="alert" className="text-[13px] text-danger">{error}</p>
         <button
          onClick={retry}
          className="cursor-pointer rounded-md border border-danger/30 px-3 py-1.5 text-[13px] text-danger transition-colors duration-100 hover:bg-danger/15"
         >
          {t.retry}
         </button>
        </div>
       )}
      </>
     )}
    </div>
   </div>
   <div className="flex shrink-0 items-center gap-1.5 border-t border-border px-3 py-3">
    <button
     onClick={() => {
      useApp.getState().openSettingsTab();
      useApp.getState().set({ sidebarOpen: false });
     }}
     className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
     aria-label={t.settingsOpenAria}
     title={t.settingsOpenAria}
    >
     <Settings size={15} aria-hidden className="shrink-0" />
     <span className="whitespace-nowrap">{t.settingsOpenAria}</span>
    </button>
    <LanguageToggle />
    <ThemeToggle />
   </div>
   {groupDialog && (
    <WorkspaceGroupDialog
     key={groupDialog.group?.id ?? "new"}
     group={groupDialog.group}
     onClose={() => setGroupDialog(null)}
     onChanged={refresh}
    />
   )}
   {
    sessionsFor && (
     <SessionPopup
      key={sessionsFor.id}
      project={sessionsFor}
      onClose={() => setSessionsFor(null)}
     />
    )
   }
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
  </aside >
 );
}