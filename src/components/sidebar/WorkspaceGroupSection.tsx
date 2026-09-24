import { useState } from "react";
import { ChevronRight, Layers, PenLine, Plus } from "reicon-react";
import type { CheckoutView, ProjectView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { newTerminalInSelection } from "../../lib/checkouts";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";
import { ProjectGroup } from "./ProjectGroup";

/**
 * 左栏工作区段（V21）：多项目容器的组头 + 成员项目（项目组复用 `ProjectGroup`）。
 *
 * - 组头点击 = 选中工作区（右栏范围切到组内全部目录的终端，激活终端自动收敛）；
 * - hover：`＋` 在组内首项目主目录开终端（自动挂工作区协作根）、`PenLine` 打开编辑对话框；
 * - `group = null` 是「未分组」区：不可编辑、不可删，只做收纳与选中。
 */
export function WorkspaceGroupSection({
 group,
 projects,
 itemsFor,
 onEdit,
 onChanged,
 onError,
 onOpenSessions,
}: {
 /** null = 未分组区。 */
 group: WorkspaceView | null;
 /** 成员项目（顺序 = 项目注册顺序）。 */
 projects: readonly ProjectView[];
 itemsFor: (projectId: string) => CheckoutView[];
 onEdit: ((group: WorkspaceView) => void) | null;
 onChanged: () => Promise<void>;
 onError: (message: string) => void;
 onOpenSessions: (project: ProjectView) => void;
}) {
 const t = useText();
 const selection = useApp((s) => s.selection);
 const [expanded, setExpanded] = useState(true);
 const gid = group?.id ?? null;
 const active = selection?.kind === "group" && selection.id === gid;
 const openTerminal = () => {
  // 先选中本组，新终端才不会被 openTerminal 切到目录视图（组视图里开终端保持组视图）
  useApp.getState().selectGroup(gid);
  newTerminalInSelection();
 };

 return (
  <section className="mb-2">
   <div
    aria-current={active ? "location" : undefined}
    className={`group flex min-h-9 items-center gap-0.5 rounded-md border-l-2 pr-1 transition-colors duration-100 ${active ? "border-accent bg-active" : "border-transparent hover:bg-hover"
     }`}
   >
    <button
     onClick={() => setExpanded((v) => !v)}
     aria-expanded={expanded}
     aria-label={group?.name ?? t.wsGroupUngrouped}
     className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-sm text-faint transition-colors duration-100 hover:text-foreground"
    >
     <ChevronRight
      size={12}
      aria-hidden
      className={`transition-transform duration-100 ${expanded ? "rotate-90" : ""}`}
     />
    </button>
    <button
     onClick={() => useApp.getState().selectGroup(gid)}
     title={t.wsGroupCollabHint}
     className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left text-[13px] font-semibold text-foreground"
    >
     <Layers size={13} aria-hidden className="shrink-0 text-muted" />
     <span className="min-w-0 flex-1 truncate">{group?.name ?? t.wsGroupUngrouped}</span>
     <span className="shrink-0 font-mono text-[10px] leading-none text-faint">{projects.length}</span>
    </button>
    <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
     <button
      onClick={openTerminal}
      disabled={projects.length === 0}
      aria-label={t.wsGroupOpenTerminal}
      title={t.wsGroupOpenTerminal}
      className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
     >
      <Plus size={13} aria-hidden />
     </button>
     {group && onEdit && (
      <button
       onClick={() => onEdit(group)}
       aria-label={fmt(t.wsGroupEditTitle, group.name)}
       title={fmt(t.wsGroupEditTitle, group.name)}
       className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       <PenLine size={13} aria-hidden />
      </button>
     )}
    </span>
   </div>
   {expanded && (
    <div className="ml-2 mt-0.5 border-l border-border-soft pl-1">
     {projects.map((project) => (
      <ProjectGroup
       key={project.id}
       project={project}
       items={itemsFor(project.id)}
       onChanged={onChanged}
       onError={onError}
       onOpenSessions={() => onOpenSessions(project)}
      />
     ))}
     {projects.length === 0 && (
      <p className="px-3 py-2 text-[11px] leading-relaxed text-faint">{t.wsGroupEmpty}</p>
     )}
    </div>
   )}
  </section>
 );
}
