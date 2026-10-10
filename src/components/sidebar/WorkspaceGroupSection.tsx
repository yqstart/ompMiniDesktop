import { Fragment, useState } from "react";
import { Layers, PenLine, Trash2 } from "reicon-react";
import type { CheckoutView, ProjectView, WorkspaceView } from "@shared/types";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import type { ProjectDropTarget } from "../../lib/projectDrag";
import { useContextMenu } from "../../lib/contextMenu";
import type { ContextMenuEntry } from "../../lib/contextMenu";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";
import { ConfirmDialog } from "../ConfirmDialog";
import { DropLine } from "./DropLine";
import { ProjectGroup } from "./ProjectGroup";

/**
 * 左栏工作区段（V21）：多项目容器的组头 + 成员项目（项目组复用 `ProjectGroup`）。
 *
 * - 组头点击 = 选中工作区（右栏范围切到组内全部目录的终端，激活终端自动收敛）+ 展开/收起
 *   （没有独立折叠箭头；`Layers` 图标在展开时上强调色）；
 * - **组内操作收进右键菜单（2026-10-10）**：组头上不再挂 hover 按钮——
 *   「编辑工作区…」开 `WorkspaceGroupDialog`，「删除工作区」就地二次确认后删
 *   （成员项目回归未分组，不删项目 / 文件；选中项与激活终端由 `refreshSidebar` 收敛）；
 * - 行尾是成员项目计数小盒（24px `bg-surface`，`title` / `aria-label` = 「N 个项目」）；
 * - `group = null` 是「未分组」区：不可编辑、不可删，只做收纳与选中（右键无菜单）。
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
 const [confirmDelete, setConfirmDelete] = useState(false);
 const menu = useContextMenu();
 const gid = group?.id ?? null;
 const active = selection?.kind === "group" && selection.id === gid;
 const target = dropTarget !== null && dropTarget.containerId === gid ? dropTarget : null;

 /** 删除工作区（右键菜单入口）：成员回归未分组，不删项目 / 文件。 */
 const removeGroup = async () => {
  if (group === null) return;
  try {
   await api.deleteWorkspace(group.id);
   await onChanged();
  } catch (e) {
   onError(e instanceof Error ? e.message : t.wsGroupFailed);
  }
 };

 const menuItems: ContextMenuEntry[] = group === null || onEdit === null
  ? []
  : [
   { label: t.wsGroupEdit, icon: PenLine, onSelect: () => onEdit(group) },
   { separator: true },
   { label: t.wsGroupDelete, icon: Trash2, danger: true, onSelect: () => setConfirmDelete(true) },
  ];

 return (
  <section className="mb-2" data-group-drop={gid ?? ""}>
   <div
    aria-current={active ? "location" : undefined}
    onContextMenu={menuItems.length > 0 ? (e) => menu.open(e, menuItems) : undefined}
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
    </button>
    <span
     title={fmt(t.wsGroupCount, projects.length)}
     aria-label={fmt(t.wsGroupCount, projects.length)}
     className="flex h-6 min-w-6 shrink-0 items-center justify-center rounded-sm bg-surface px-1 font-mono text-[10px] leading-none text-faint"
    >
     {projects.length}
    </span>
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
   <ConfirmDialog
    open={confirmDelete}
    danger
    title={fmt(t.wsGroupDeleteTitle, group?.name ?? "")}
    detail={t.wsGroupDeleteBody}
    confirmLabel={t.wsGroupDelete}
    onConfirm={() => {
     setConfirmDelete(false);
     void removeGroup();
    }}
    onCancel={() => setConfirmDelete(false)}
   />
  </section>
 );
}
