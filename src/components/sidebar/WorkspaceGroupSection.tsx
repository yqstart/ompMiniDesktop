import { Fragment, useState } from "react";
import { Layers, PenLine } from "reicon-react";
import type { CheckoutView, ProjectView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import type { ProjectDropTarget } from "../../lib/projectDrag";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";
import { DropLine } from "./DropLine";
import { ProjectGroup } from "./ProjectGroup";

/**
 * 左栏工作区段（V21）：多项目容器的组头 + 成员项目（项目组复用 `ProjectGroup`）。
 *
 * - 组头点击 = 选中工作区（右栏范围切到组内全部目录的终端，激活终端自动收敛）+ 展开/收起
 *  （没有独立折叠箭头；`Layers` 图标在展开时上强调色）；
 * - hover：`PenLine` 打开编辑对话框；
 * - `group = null` 是「未分组」区：不可编辑、不可删，只做收纳与选中。
 *
 * 拖拽（V26）：整段是**落点容器**（`data-group-drop`）——拖项目进来 = 加入本组（落在末尾）；
 * 成员行的前后插入线由 `dropTarget` 决定；空组的提示条在拖拽中变成「拖到这里加入」的落区。
 */
export function WorkspaceGroupSection({
 group,
 projects,
 itemsFor,
 onEdit,
 onChanged,
 onError,
 onOpenSessions,
 dragActive,
 draggingId,
 dropTarget,
 onDragStart,
}: {
 /** null = 未分组区。 */
 group: WorkspaceView | null;
 /** 成员项目（顺序 = 左栏顺序，可在左栏拖拽调整）。 */
 projects: readonly ProjectView[];
 itemsFor: (projectId: string) => CheckoutView[];
 onEdit: ((group: WorkspaceView) => void) | null;
 onChanged: () => Promise<void>;
 onError: (message: string) => void;
 onOpenSessions: (project: ProjectView) => void;
 /** 有项目正在被拖（空组提示条据此换成落区文案）。 */
 dragActive: boolean;
 /** 正在被拖的项目 id（`null` = 没有拖拽）。 */
 draggingId: string | null;
 /** 当前落点（只画与本段容器相关的指示线）。 */
 dropTarget: ProjectDropTarget | null;
 onDragStart: (projectId: string, e: React.PointerEvent<HTMLElement>) => void;
}) {
 const t = useText();
 const selection = useApp((s) => s.selection);
 const [expanded, setExpanded] = useState(true);
 const gid = group?.id ?? null;
 const active = selection?.kind === "group" && selection.id === gid;
 const target = dropTarget !== null && dropTarget.containerId === gid ? dropTarget : null;

 return (
  <section className="mb-2" data-group-drop={gid ?? ""}>
   <div
    aria-current={active ? "location" : undefined}
    className={`group flex min-h-9 items-center gap-0.5 rounded-md border-l-2 pr-1 transition-colors duration-100 ${active ? "border-accent bg-active" : "border-transparent hover:bg-hover"
     }`}
   >
    <button
     onClick={() => {
      useApp.getState().selectGroup(gid);
      setExpanded((v) => !v);
     }}
     aria-expanded={expanded}
     aria-label={group?.name ?? t.wsGroupUngrouped}
     title={t.wsGroupCollabHint}
     className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 pl-1.5 text-left text-[13px] font-semibold text-foreground"
    >
     <span className={`flex size-6 shrink-0 items-center justify-center rounded-sm bg-surface ${expanded ? "text-accent" : "text-muted"}`}>
      <Layers size={14} aria-hidden />
     </span>
     <span className={`min-w-0 flex-1 truncate transition-colors duration-100 ${expanded ? "text-accent" : ""}`}>{group?.name ?? t.wsGroupUngrouped}</span>
     <span className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-surface px-1 font-mono text-[10px] leading-none text-faint">
      {projects.length}
     </span>
    </button>
    {group && onEdit && (
     <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 group-focus-within:opacity-100">
      <button
       onClick={() => onEdit(group)}
       aria-label={fmt(t.wsGroupEditTitle, group.name)}
       title={fmt(t.wsGroupEditTitle, group.name)}
       className="flex size-6 cursor-pointer items-center justify-center rounded-sm text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       <PenLine size={13} aria-hidden />
      </button>
     </span>
    )}
   </div>
   {expanded && (
    <div className="ml-2 mt-0.5 border-l border-border-soft pl-1">
     {projects.map((project) => (
      <Fragment key={project.id}>
       {/* 拖拽落点正好在这一行之前 → 画插入线（零高度，不推挤列表） */}
       {target?.beforeId === project.id && <DropLine />}
       <ProjectGroup
        project={project}
        items={itemsFor(project.id)}
        dragging={draggingId === project.id}
        onChanged={onChanged}
        onError={onError}
        onOpenSessions={() => onOpenSessions(project)}
        onDragStart={onDragStart}
       />
      </Fragment>
     ))}
     {/* 落在容器末尾：线画在最后一个成员之后 */}
     {target !== null && target.beforeId === null && projects.length > 0 && <DropLine />}
     {projects.length === 0 && (
      dragActive ? (
       <p
        className={`mx-1 my-1 rounded-md border border-dashed px-3 py-2 text-[11px] leading-relaxed transition-colors duration-100 ${target !== null ? "border-accent/50 bg-accent/5 text-accent" : "border-border text-faint"
         }`}
       >
        {gid === null ? t.projDragOut : t.projDragInto}
       </p>
      ) : (
       <p className="px-3 py-2 text-[11px] leading-relaxed text-faint">{t.wsGroupEmpty}</p>
      )
     )}
    </div>
   )}
  </section>
 );
}
