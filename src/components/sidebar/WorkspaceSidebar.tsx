import { useEffect, useState } from "react";
import { FolderPlus, Settings, X } from "reicon-react";
import { api } from "@shared/api";
import type { ProjectView } from "@shared/types";
import { useApp } from "../../stores/app";
import { loadWorkspaces } from "../../lib/workspaces";
import { pickAndAddProject } from "../../lib/projects";
import { useText } from "../../lib/useText";
import { LanguageToggle } from "../LanguageToggle";
import { ThemeToggle } from "../ThemeToggle";
import { ProjectGroup } from "./ProjectGroup";
import { SessionPopup } from "./SessionPopup";

/** 左栏刷新：项目列表 + 工作区清单（项目增删 / worktree 创建后都回这里）。 */
async function refreshSidebar(): Promise<void> {
 const [projects] = await Promise.all([
  api.listProjects().catch(() => null),
  loadWorkspaces().catch(() => null),
 ]);
 if (projects) useApp.getState().set({ projects });
}

/**
 * 左栏（V11）：项目 → 工作区（主目录 + git worktree）树。
 *
 * - 顶部「添加项目」仍是唯一添加主入口（中央空态的引导按钮走同一实现）；
 * - 项目行悬浮槽位：会话弹窗入口（Clock）与新建 worktree（Nodes，直接开面板）；
 * - 工作区行点击 = 打开/聚焦该目录的终端（`lib/workspaces.ts` 收敛动作）；
 * - 底部行 = 设置 + 语言 + 皮肤（V1 起不变；侧栏宽度下限由这一行内容决定）。
 */
export function WorkspaceSidebar() {
 const projects = useApp((s) => s.projects);
 const workspaces = useApp((s) => s.workspaces);
 const updateReady = useApp((s) => s.update.status === "available" || s.update.status === "ready");
 const t = useText();
 const [error, setError] = useState<string | null>(null);
 const [sessionsFor, setSessionsFor] = useState<ProjectView | null>(null);

 useEffect(() => {
  void refreshSidebar();
 }, []);

 return (
  <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar">
   {/* macOS Overlay 红绿灯占位 */}
   <div data-tauri-drag-region className="h-10 shrink-0" aria-hidden />
   <div className="shrink-0 px-3 pb-3">
    <div data-tauri-drag-region className="flex h-9 items-center px-1 pb-2">
     <span className="pointer-events-none text-[14px] font-semibold tracking-tight text-foreground">
      <span className="font-mono text-accent">omp</span>MiniDesktop
     </span>
    </div>
    <button
     onClick={async () => {
      const res = await pickAndAddProject();
      if (res && !res.ok) setError(res.message);
      if (res?.ok) void refreshSidebar();
     }}
     className="flex h-9 w-full cursor-pointer items-center gap-2 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-foreground transition-colors duration-100 hover:border-accent/30 hover:bg-hover"
     aria-label={t.addProject}
    >
     <FolderPlus size={15} aria-hidden className="shrink-0 text-accent" />
     {t.addProject}
    </button>
   </div>
   {error && (
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
   )}
   <div className="shrink-0 px-4 pb-2 text-[11px] font-medium tracking-wide text-faint">
    {t.workspaceTitle}
   </div>
   {/* 滚动容器：`scrollbar-gutter:stable` 恒定预留滚动条宽度，有无滚动条不横跳 */}
   <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3 [scrollbar-gutter:stable]">
    <div>
     {projects.map((project) => (
      <ProjectGroup
       key={project.id}
       project={project}
       items={workspaces.filter((w) => w.projectId === project.id)}
       onChanged={refreshSidebar}
       onError={setError}
       onOpenSessions={() => setSessionsFor(project)}
      />
     ))}
     {projects.length === 0 && (
      <p className="mx-1 rounded-lg border border-dashed border-border px-3 py-4 text-[13px] leading-relaxed text-muted">{t.noProjectsAdd}</p>
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
   {sessionsFor && (
    <SessionPopup
     key={sessionsFor.id}
     project={sessionsFor}
     onClose={() => setSessionsFor(null)}
    />
   )}
  </aside>
 );
}