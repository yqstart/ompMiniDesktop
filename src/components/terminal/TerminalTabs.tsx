import { BrowserTerminal, Plus, Settings, X } from "reicon-react";
import { useApp } from "../../stores/app";
import { newTerminalInActiveWorkspace } from "../../lib/workspaces";
import { useText } from "../../lib/useText";

/**
 * 标签栏（主区顶部**常驻**）：全部终端标签 + 设置标签（单例）+ `＋`。
 *
 * - 常驻是硬约束：设置标签激活时整栏仍在（用户点得回终端，也看得见有哪些终端在跑）；
 *   终端标签高亮要 `!settingsTabActive`——切去设置后不能有两个"选中"的标签；
 * - 标题优先用 OSC 标题（omp TUI 发的会话名），未来过就是工作区名（store 保证初始值）；
 * - 运行中终端的关闭走 `requestCloseTerminal`（弹确认，防误杀进行中的 agent）；
 * - 设置标签的关闭 = `closeSettingsTab`（回到上次的终端标签），不进确认流程；
 * - 整栏挂 `data-tauri-drag-region`：空白处可以拖窗口（按钮自身的 mousedown 不触发拖拽）。
 */
export function TerminalTabs() {
 const terminals = useApp((s) => s.terminals);
 const activeId = useApp((s) => s.activeTerminalId);
 const settingsTabOpen = useApp((s) => s.settingsTabOpen);
 const settingsTabActive = useApp((s) => s.settingsTabActive);
 const t = useText();
 return (
  <div
   className="flex h-10 shrink-0 items-stretch border-b border-border bg-sidebar"
   data-tauri-drag-region
  >
   <div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto px-1.5 py-1">
    {terminals.map((term) => {
     const active = term.id === activeId && !settingsTabActive;
     return (
      <div
       key={term.id}
       role="tab"
       tabIndex={0}
       aria-selected={active}
       title={term.cwd}
       onClick={() => useApp.getState().focusTerminal(term.id)}
       onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
         e.preventDefault();
         useApp.getState().focusTerminal(term.id);
        }
       }}
       className={`group flex min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors duration-100 ${active ? "bg-active text-foreground" : "text-muted hover:bg-hover"
        }`}
      >
       <BrowserTerminal
        className={`size-3.5 shrink-0 ${term.status === "running" ? "text-accent" : "text-faint"}`}
       />
       <span className="min-w-0 flex-1 truncate">{term.title}</span>
       <button
        onClick={(e) => {
         e.stopPropagation();
         useApp.getState().requestCloseTerminal(term.id);
        }}
        aria-label={t.termClose}
        className={`-mr-1 flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity duration-100 hover:bg-active ${active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"
         }`}
       >
        <X className="size-3" />
       </button>
      </div>
     );
    })}
    {settingsTabOpen && (
     <div
      role="tab"
      tabIndex={0}
      aria-selected={settingsTabActive}
      onClick={() => useApp.getState().openSettingsTab()}
      onKeyDown={(e) => {
       if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        useApp.getState().openSettingsTab();
       }
      }}
      className={`group flex min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] transition-colors duration-100 ${settingsTabActive ? "bg-active text-foreground" : "text-muted hover:bg-hover"
       }`}
     >
      <Settings className="size-3.5 shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate">{t.title}</span>
      <button
       onClick={(e) => {
        e.stopPropagation();
        useApp.getState().closeSettingsTab();
       }}
       aria-label={t.close}
       className={`-mr-1 flex size-4.5 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity duration-100 hover:bg-active ${settingsTabActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"
        }`}
      >
       <X className="size-3" />
      </button>
     </div>
    )}
   </div>
   <div className="flex items-center px-2">
    <button
     onClick={() => newTerminalInActiveWorkspace()}
     aria-label={t.termNew}
     title={t.termNewHint}
     className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     <Plus className="size-4" />
    </button>
   </div>
  </div>
 );
}
