import { useCallback, type ReactNode } from "react";
import { ClipboardList, FilePlus, FolderFiles, MinimizeSquare, Plus, Target } from "reicon-react";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";

/**
 * 输入卡「+」菜单（v2 §3 卡底工具行左端；2026-10-20 按 DeepSeek Harness 的 composer 菜单重做）：
 * 两条口径同时成立——**分组**（「添加」/「指令」）与**行**（图标 + 标题 + 命令名）。
 *
 * 添加组：**文件**（系统文件选择器：图片进附件、其余文件插 `@真路径` 芯片）、
 * **工作区文件**（⌘⇧P 的跨项目引用浮层，ompMiniDesktop 特有）、
 * **目标**（goal 弹窗：查看 / 设置 / 暂停 / 恢复 / 清除）、
 * **计划**（入口先留：omp 的 rpc-ui 命令面还没有 `/plan`，点击落一条说明）。
 * 指令组：**压缩**（走 `compact_session`，与工具行的压缩行动点同一条后端通路）。
 *
 * **行是单行**（2026-10-20 用户口径）：图标 + 标题 + 命令名（mono、faint），
 * 全部垂直居中——不再有第二行说明（说明行会把菜单撑高、也让标题列与图标列错位）。
 */
export function PlusMenu({
 onPickFiles,
 onPickRef,
 onOpenGoal,
 onOpenPlan,
 onCompact,
 compactBusy,
 disabled,
}: {
 /** 系统文件选择器：图片 → 附件；其他文件 → `@绝对/相对路径` 引用芯片。 */
 onPickFiles: () => void;
 /** 引用**其他**工作区成员项目的文件（⌘⇧P 同一入口）。 */
 onPickRef: () => void;
 /** 目标：打开 GoalDialog（查看当前目标 / 设置新目标 / 暂停·恢复·清除）。 */
 onOpenGoal: () => void;
 /** 计划：入口先留（点击给一条本地说明，不发假命令）。 */
 onOpenPlan: () => void;
 /** 压缩以上对话内容（`compact_session`）。 */
 onCompact: () => void;
 /** 运行中压缩会被 omp 拒绝：只禁用这一行，不锁整张菜单。 */
 compactBusy?: boolean;
 disabled?: boolean;
}) {
 const t = useText();
 const open = useApp((s) => s.composerMenu === "plus");
 const setOpen = useCallback((v: boolean) => useApp.setState({ composerMenu: v ? "plus" : null }), []);
 const ref = useDropdown(open, () => setOpen(false));

 const item = (
  icon: ReactNode,
  label: string,
  command: string,
  onClick: () => void,
  rowDisabled?: boolean,
 ) => (
  <button
   type="button"
   role="menuitem"
   disabled={rowDisabled}
   onClick={() => {
    setOpen(false);
    onClick();
   }}
   className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left transition-colors duration-100 enabled:hover:bg-hover disabled:cursor-default disabled:opacity-40"
  >
   <span className="shrink-0 text-muted">{icon}</span>
   {/* 标题与命令名按基线对齐，整组再与图标垂直居中（items-center） */}
   <span className="flex min-w-0 items-baseline gap-1.5">
    <span className="min-w-0 truncate text-[13px] text-muted">{label}</span>
    <span className="shrink-0 font-mono text-[10px] text-faint">{command}</span>
   </span>
  </button>
 );

 const section = (title: string) => (
  <div role="presentation" className="px-2 pt-2 pb-0.5 text-[11px] font-medium text-faint">
   {title}
  </div>
 );

 return (
  <div className="relative" ref={ref}>
   <button
    onClick={() => setOpen(!open)}
    disabled={disabled}
    className={`flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-100 hover:bg-hover disabled:cursor-default disabled:opacity-40 ${open ? "bg-active text-foreground" : "text-muted hover:text-foreground"}`}
    aria-label={t.plusMenuAria}
    aria-expanded={open}
    title={t.plusMenuAria}
   >
    <Plus size={16} aria-hidden />
   </button>
   {open && (
    <div
     role="menu"
     aria-label={t.plusMenuAria}
     className="absolute bottom-8 left-0 z-10 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-elevated p-1 pb-1.5 shadow-pop"
    >
     {section(t.plusGroupAdd)}
     {item(<FilePlus size={13} aria-hidden />, t.plusFileTitle, "file", onPickFiles)}
     {item(<FolderFiles size={13} aria-hidden />, t.refPickTitle, "workspace", onPickRef)}
     {item(<Target size={13} aria-hidden />, t.plusGoalTitle, "goal", onOpenGoal)}
     {item(<ClipboardList size={13} aria-hidden />, t.plusPlanTitle, "plan", onOpenPlan)}
     {section(t.plusGroupCommands)}
     {item(<MinimizeSquare size={13} aria-hidden />, t.plusCompactTitle, "compact", onCompact, compactBusy)}
    </div>
   )}
  </div>
 );
}
