import { BrowserTerminal } from "reicon-react";
import { useApp } from "../../stores/app";
import { newTerminalInActiveWorkspace } from "../../lib/workspaces";
import { useText } from "../../lib/useText";
import { ConfirmDialog } from "../ConfirmDialog";
import { TerminalTabs } from "./TerminalTabs";
import { TerminalPane } from "./TerminalPane";

/**
 * 右侧终端工作区（V11）：标签栏 + 全部终端面板。
 *
 * 面板**全部挂载**、靠 CSS 切显隐——切 tab 不销毁 xterm，滚动缓冲区与正在绘制的
 * TUI 都保持原样；隐藏面板的 fit/resize 由 TerminalPane 内部用 active 判断挡掉。
 */
export function TerminalView() {
 const terminals = useApp((s) => s.terminals);
 const activeId = useApp((s) => s.activeTerminalId);
 const closingId = useApp((s) => s.closingTerminalId);
 const t = useText();
 return (
  <div className="flex h-full min-w-0 flex-1 flex-col bg-background">
   {terminals.length > 0 && <TerminalTabs />}
   <div className="relative min-h-0 flex-1">
    {terminals.length === 0 ? (
     <EmptyTerminal />
    ) : (
     terminals.map((term) => (
      <div
       key={term.id}
       className={term.id === activeId ? "absolute inset-0" : "hidden"}
      >
       <TerminalPane term={term} active={term.id === activeId} />
      </div>
     ))
    )}
   </div>
   <ConfirmDialog
    open={closingId !== null}
    title={t.termCloseRunningTitle}
    detail={t.termCloseRunningBody}
    confirmLabel={t.termClose}
    danger
    onConfirm={() => useApp.getState().confirmCloseTerminal()}
    onCancel={() => useApp.getState().cancelCloseTerminal()}
   />
  </div>
 );
}

/** 空态：引导开第一个终端（左栏空态负责引导添加项目）。 */
function EmptyTerminal() {
 const hasProjects = useApp((s) => s.projects.length > 0);
 const t = useText();
 return (
  <div className="flex h-full items-center justify-center p-8">
   <div className="flex max-w-sm flex-col items-center gap-3 text-center">
    <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-surface">
     <BrowserTerminal className="size-6 text-faint" />
    </div>
    <h2 className="text-[15px] font-medium">{t.termEmptyTitle}</h2>
    <p className="text-[13px] leading-5 text-muted">{t.termEmptyBody}</p>
    {hasProjects ? (
     <button
      onClick={() => newTerminalInActiveWorkspace()}
      className="mt-1 cursor-pointer rounded-lg bg-accent px-3.5 py-1.5 text-[13px] text-white transition-opacity duration-100 hover:opacity-90"
     >
      {t.termNew}
     </button>
    ) : (
     <p className="text-[12px] text-faint">{t.emptyNoProjectTitle}</p>
    )}
   </div>
  </div>
 );
}
