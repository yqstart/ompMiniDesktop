import { useEffect, useState } from "react";
import { FolderPlus, Layers, Search, Settings, X } from "reicon-react";
import { api } from "@shared/api";
import type { ProjectView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { loadCheckouts } from "../../lib/checkouts";
import { pickAndAddProject } from "../../lib/projects";
import { isMacKeyboard } from "../../lib/termInput";
import { useText } from "../../lib/useText";
import { LanguageToggle } from "../LanguageToggle";
import { ThemeToggle } from "../ThemeToggle";
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

export function WorkspaceSidebar() {
 const projects = useApp((s) => s.projects);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const checkouts = useApp((s) => s.checkouts);
 const updateReady = useApp((s) => s.update.status === "available" || s.update.status === "ready");
 const t = useText();
 const [error, setError] = useState<string | null>(null);
 const [sessionsFor, setSessionsFor] = useState<ProjectView | null>(null);
 const [groupDialog, setGroupDialog] = useState<{ group: WorkspaceView | null } | null>(null);
 const [loading, setLoading] = useState(true);
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
    <div data-tauri-drag-region className="flex h-9 items-center px-1 pb-2">
     <span className="pointer-events-none text-[14px] font-semibold tracking-tight text-foreground">
      <span className="font-mono text-accent">omp</span>MiniDesktop
     </span>
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
   <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
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
        />
       ))}
       {workspaceGroups.length > 0 && projects.some((p) => p.workspaceId === null) && (
        <WorkspaceGroupSection
         group={null}
         projects={projects.filter((p) => p.workspaceId === null)}
         itemsFor={itemsFor}
         onEdit={null}
         onChanged={refresh}
         onError={setError}
         onOpenSessions={setSessionsFor}
        />
       )}
       {workspaceGroups.length === 0 && projects.map((project) => (
        <ProjectGroup
         key={project.id}
         project={project}
         items={itemsFor(project.id)}
         onChanged={refresh}
         onError={setError}
         onOpenSessions={() => setSessionsFor(project)}
        />
       ))}
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
     className="relative flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
     aria-label={t.settingsOpenAria}
     title={t.settingsOpenAria}
    >
     <Settings size={15} aria-hidden className="shrink-0" />
     <span className="whitespace-nowrap">{t.settingsOpenAria}</span>
     {/* 有可用更新：设置入口点亮小点（顶栏 UpdateBell 退场后的常驻提醒） */}
     {updateReady && (
      <span
       aria-hidden
       className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent"
      />
     )}
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
  </aside >
 );
}