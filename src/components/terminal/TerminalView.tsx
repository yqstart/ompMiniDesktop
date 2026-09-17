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
