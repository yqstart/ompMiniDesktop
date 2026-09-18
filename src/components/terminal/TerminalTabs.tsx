import { Folder, Plus, Settings, X } from "reicon-react";
import type { TermTabState } from "@shared/types";
import { useApp } from "../../stores/app";
import { newTerminalInActiveWorkspace } from "../../lib/workspaces";
import { useText } from "../../lib/useText";
import type { TextKey } from "../../lib/locale";

/** π 的颜色即 omp 状态（token 见 MASTER §2）：工作中呼吸、等你确认、就绪、结束、失败。 */
const STATE_TONE: Record<TermTabState, string> = {
 working: "animate-pulse text-accent",
 attention: "text-warn",
 ready: "text-ok",
 exited: "text-ok",
 failed: "text-danger",
 unknown: "text-faint",
};

/** 状态文字（屏幕阅读器与 π 的悬停提示；颜色不是唯一信号）。 */
const STATE_TEXT: Record<TermTabState, TextKey | null> = {
 working: "termStateWorking",
 attention: "termStateAttention",
 ready: "termStateReady",
 exited: "termStateExited",
 failed: "termStateFailed",
 unknown: null,
};

/**
 * 标签栏（主区顶部**常驻**）：全部终端标签 + 设置标签（单例）+ `＋`。
 *
 * - 常驻是硬约束：设置标签激活时整栏仍在（用户点得回终端，也看得见有哪些终端在跑）；
 *   终端标签高亮要 `!settingsTabActive`——切去设置后不能有两个"选中"的标签；
 * - 标签 = `π` 状态标 + 会话名：**π 的颜色就是 omp 的状态**（工作中 / 等你确认 / 就绪 / 已退出 /
 *   失败，见 `lib/termTitle.ts` 与 `STATE_TONE`）；标题用 OSC 标题解析出的会话名，
 *   还没来过就是工作区名（store 保证初始值）；
 * - 运行中终端的关闭走 `requestCloseTerminal`（弹确认，防误杀进行中的 agent）；
 * - 设置标签的关闭 = `closeSettingsTab`（回到上次的终端标签），不进确认流程；
 * - 整栏挂 `data-tauri-drag-region`：空白处可以拖窗口（按钮自身的 mousedown 不触发拖拽）。
 */
export function TerminalTabs() {
 const terminals = useApp((s) => s.terminals);
 const activeId = useApp((s) => s.activeTerminalId);
 const settingsTabOpen = useApp((s) => s.settingsTabOpen);
 const settingsTabActive = useApp((s) => s.settingsTabActive);
 const hasProjects = useApp((s) => s.projects.length > 0);
 const t = useText();
 return (
  <div
   className="flex h-12 shrink-0 items-stretch border-b border-border-soft bg-sidebar/50"
   data-tauri-drag-region
  >
   <button
    onClick={() => useApp.getState().set({ sidebarOpen: true })}
    aria-label={t.workspaceShow}
    title={t.workspaceShow}
    className="my-1 ml-2 flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted hover:bg-hover md:hidden"
   >
    <Folder size={16} aria-hidden />
   </button>
   <div
    role="tablist"
    aria-label={t.termPaneAria}
    className="no-scrollbar flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto px-2 py-2"
    // 滚动条隐藏后没有拖拽入口：垂直滚轮映射为横向滚动（触控板横滑、Shift+滚轮浏览器原生处理）
    onWheel={(e) => {
     if (e.deltaX !== 0) return;
     const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? e.currentTarget.clientWidth : 1;
     e.currentTarget.scrollLeft += e.deltaY * scale;
    }}
   >
    {terminals.length === 0 && !settingsTabOpen && (
     <div className="flex items-center gap-2 px-2 text-[12px] font-medium text-muted">
      <span aria-hidden className="font-mono text-[14px] leading-none text-faint">π</span>
      {t.workspaceTitle}
     </div>
    )}
    {terminals.map((term) => {
     const active = term.id === activeId && !settingsTabActive;
     const stateText = STATE_TEXT[term.state];
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
       className={`group flex min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12px] transition-colors duration-100 ${active ? "border-border bg-surface font-medium text-foreground" : "border-transparent text-muted hover:bg-hover"
        }`}
      >
       <span
        aria-hidden
        title={stateText ? t[stateText] : undefined}
        className={`shrink-0 font-mono text-[14px] leading-none ${STATE_TONE[term.state]}`}
       >
        π
       </span>
       <span className="min-w-0 flex-1 truncate">{term.title}</span>
       {stateText && <span className="sr-only">{t[stateText]}</span>}
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
      className={`group flex min-w-0 max-w-[220px] shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12px] transition-colors duration-100 ${settingsTabActive ? "border-border bg-surface font-medium text-foreground" : "border-transparent text-muted hover:bg-hover"
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
     disabled={!hasProjects}
     aria-label={t.termNew}
     title={t.termNewHint}
     className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-surface text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
     <Plus className="size-4" />
    </button>
   </div>
  </div>
 );
}
