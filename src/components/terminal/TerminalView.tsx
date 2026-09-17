import { BrowserTerminal } from "reicon-react";
import { useApp } from "../../stores/app";
import { newTerminalInActiveWorkspace } from "../../lib/workspaces";
import { useText } from "../../lib/useText";
import { TerminalPane } from "./TerminalPane";

/**
 * 终端面板区（V11）：全部终端面板。标签栏在 `App.tsx` 里常驻（设置标签激活时也要可见），
 * 这里只负责面板本身与空态；关闭终端的 ConfirmDialog 同样挂在 App（任何标签下都要弹得出来）。
 *
 * 面板**全部挂载**、靠 CSS 切显隐——切标签不销毁 xterm，滚动缓冲区与正在绘制的
 * TUI 都保持原样；隐藏面板的 fit/resize 由 TerminalPane 内部用 active 判断挡掉。
 *
 * `visible=false`（设置标签激活）同样只隐藏、不卸载：PTY 必须活过设置标签的开合，
 * 面板按隐藏处理（不量尺寸 / 不推 resize），回来时按「切到本 tab」重新 fit + 聚焦。
 */
export function TerminalView({ visible = true }: { visible?: boolean }) {
 const terminals = useApp((s) => s.terminals);
 const activeId = useApp((s) => s.activeTerminalId);
 return (
  <div className={visible ? "relative min-h-0 flex-1" : "hidden"}>
   {terminals.length === 0 ? (
    <EmptyTerminal />
   ) : (
    terminals.map((term) => (
     <div
      key={term.id}
      className={term.id === activeId && visible ? "absolute inset-0" : "hidden"}
     >
      <TerminalPane term={term} active={term.id === activeId && visible} />
     </div>
    ))
   )}
  </div>
 );
}

/** 空态：引导开第一个终端（左栏空态负责引导添加项目）。 */
function EmptyTerminal() {
 const hasProjects = useApp((s) => s.projects.length > 0);
 const t = useText();
 return (
  <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-10">
   <div className="flex w-full max-w-md flex-col items-center text-center">
    <div className="mb-7 flex size-16 items-center justify-center rounded-2xl border border-border bg-surface text-accent">
     <BrowserTerminal size={28} aria-hidden />
    </div>
    <p className="mb-3 font-mono text-[11px] tracking-[0.16em] text-faint">omp / {t.termPaneAria}</p>
    <h2 className="text-[24px] leading-tight font-semibold tracking-tight sm:text-[28px]">{t.termEmptyTitle}</h2>
    <p className="mt-4 max-w-[340px] text-[13px] leading-6 text-muted">{t.termEmptyBody}</p>
    {hasProjects ? (
     <button
      onClick={() => newTerminalInActiveWorkspace()}
      className="mt-7 flex cursor-pointer items-center gap-4 rounded-md border border-accent/25 bg-accent/10 px-4 py-2.5 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-hover"
     >
      {t.termNew}
      <kbd className="font-mono text-[11px] opacity-75">⌘ T</kbd>
     </button>
    ) : (
     <p className="mt-7 rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[12px] text-muted">{t.emptyNoProjectTitle}</p>
    )}
    <div className="mt-12 flex flex-wrap justify-center gap-x-6 gap-y-3 border-t border-border-soft pt-5 text-[11px] text-faint">
     <span className="flex items-center gap-2"><kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono">⌘ T</kbd>{t.termNew}</span>
     <span className="flex items-center gap-2"><kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono">⌘ 1–9</kbd>{t.termSwitch}</span>
    </div>
   </div>
  </div>
 );
}
