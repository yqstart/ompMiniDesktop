import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Folder, Plus, Search, Settings, X } from "reicon-react";
import { useApp } from "../../stores/app";
import type { TerminalView } from "@shared/types";
import { newTerminalInSelection, resolveNewTerminalCheckout } from "../../lib/checkouts";
import { terminalsInScope } from "../../lib/terminalScope";
import { selectionScopePaths } from "../../lib/workspaceGroups";
import { useText } from "../../lib/useText";
import { fmt } from "../../lib/locale";
import { STATE_TEXT, STATE_TONE } from "../../lib/termState";
import { terminalDisplayName } from "../../lib/termTitle";
import { canRenameSession, renameTerminalSession, sanitizeSessionTitle, SESSION_TITLE_MAX } from "../../lib/termRename";

/**
 * 标签栏（主区顶部**常驻**）：**当前工作区**的终端标签 + 设置标签（单例）+ `＋`。
 *
 * - 终端标签按左栏选中工作区**过滤**（`lib/terminalScope.ts`）：选中 `login` 分支就只列
 *   `login` 目录的终端——别的分支的终端照常跑，只是不在这个视图里（左栏工作区行上的终端
 *   徽章与 `⌘K` 快速切换是它们的入口）；
 * - 常驻是硬约束：设置标签激活时整栏仍在（用户点得回终端，也看得见有哪些终端在跑）；
 *   终端标签高亮要 `!settingsTabActive`——切去设置后不能有两个"选中"的标签；
 * - 标签 = `π` 状态标 + 会话名（**单行**；V18 起不再显示 cwd 第二行——工作目录由左栏选中项与
 *   本栏的工作区过滤表达，完整 cwd 留在标签的悬停提示里）：**π 的颜色就是 omp 的状态**（工作中 / 等你确认 / 就绪 / 已退出 /
 *   失败，见 `lib/termTitle.ts` 与 `STATE_TONE`）；标题用 OSC 标题解析出的会话名，
 *   还没来过就是工作区名（store 保证初始值）；
 * - 运行中终端的关闭走 `requestCloseTerminal`（弹确认，防误杀进行中的 agent）；
 * - 设置标签的关闭 = `closeSettingsTab`（回到上次的终端标签），不进确认流程；
 * - 整栏挂 `data-tauri-drag-region`：空白处可以拖窗口（按钮自身的 mousedown 不触发拖拽）。
 */
export function TerminalTabs() {
 const allTerminals = useApp((s) => s.terminals);
 const checkouts = useApp((s) => s.checkouts);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const projects = useApp((s) => s.projects);
 const selection = useApp((s) => s.selection);
 const activeId = useApp((s) => s.activeTerminalId);
 const settingsTabOpen = useApp((s) => s.settingsTabOpen);
 const settingsTabActive = useApp((s) => s.settingsTabActive);
 const t = useText();
 const target = resolveNewTerminalCheckout(checkouts, selection, projects);
 const listRef = useRef<HTMLDivElement>(null);
 const [roam, setRoam] = useState<string | null>(null);
 // 只列当前选中范围的终端（范围 = 左栏选中项；下面整段渲染与键盘导航都走这个列表）
 const scope = useMemo(
  () => selectionScopePaths(selection, workspaceGroups, checkouts, projects),
  [selection, workspaceGroups, checkouts, projects],
 );
 const terminals = useMemo(() => terminalsInScope(allTerminals, scope), [allTerminals, scope]);
 const order = useMemo(() => [...terminals.map((term) => term.id), ...(settingsTabOpen ? ["settings"] : [])], [settingsTabOpen, terminals]);
 const focusedKey = roam && order.includes(roam) ? roam : settingsTabActive ? "settings" : activeId;
 useEffect(() => {
  const list = listRef.current;
  if (!list || !focusedKey) return;
  const el = list.querySelector<HTMLElement>(`[data-tab-key="${focusedKey}"]`);
  if (!el) return;
  if (el.offsetLeft < list.scrollLeft) list.scrollLeft = el.offsetLeft - 8;
  else if (el.offsetLeft + el.offsetWidth > list.scrollLeft + list.clientWidth) {
   list.scrollLeft = el.offsetLeft + el.offsetWidth - list.clientWidth + 8;
  }
 }, [activeId, focusedKey, settingsTabActive, settingsTabOpen, terminals.length]);
 const moveRoam = (key: string, delta: number) => {
  const index = order.indexOf(key);
  if (index < 0 || order.length === 0) return null;
  return order[(index + delta + order.length) % order.length];
 };
 /** 会话重命名（双击 tab）：draft 只存在于编辑期间，提交走 omp 原生的 `/rename` 注入
  *  （见 `lib/termRename.ts`）——新名字由 omp 的 OSC 标题回来，这里不写本地 override。 */
 const [renaming, setRenaming] = useState<{ id: string; draft: string; error: string | null } | null>(null);
 const startRename = (term: TerminalView) => {
  setRenaming((cur) => (cur ? cur : { id: term.id, draft: term.title ?? "", error: null }));
 };
 const submitRename = () => {
  if (!renaming) return;
  const term = terminals.find((x) => x.id === renaming.id);
  if (!term) {
   setRenaming(null);
   return;
  }
  const name = sanitizeSessionTitle(renaming.draft);
  if (name === null) {
   setRenaming({ ...renaming, error: t.termRenameInvalid });
   return;
  }
  if (!canRenameSession(term)) {
   setRenaming({ ...renaming, error: t.termRenameBusy });
   return;
  }
  renameTerminalSession(term.id, name);
  setRenaming(null);
 };
 const renameKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
  // 编辑期间键盘完全归输入框：别让标签栏的 ArrowLeft/Right（roam）与 Enter/Space（激活）接走
  e.stopPropagation();
  if (e.nativeEvent.isComposing) return;
  if (e.key === "Enter") {
   e.preventDefault();
   submitRename();
  } else if (e.key === "Escape") {
   e.preventDefault();
   setRenaming(null);
  }
 };
 return (
  <div
   className="flex h-14 shrink-0 items-stretch border-b border-border-soft bg-sidebar/50"
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
    ref={listRef}
    role="tablist"
    aria-label={t.termPaneAria}
    className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 py-2"
    onKeyDown={(e) => {
     const el = e.target as HTMLElement;
     const key = el.closest<HTMLElement>("[data-tab-key]")?.dataset.tabKey;
     if (!key) return;
     if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = moveRoam(key, e.key === "ArrowRight" ? 1 : -1);
      if (next) {
       setRoam(next);
       listRef.current?.querySelector<HTMLElement>(`[data-tab-key="${next}"]`)?.focus({ preventScroll: true });
      }
     } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const next = e.key === "Home" ? order[0] : order[order.length - 1];
      if (next) {
       setRoam(next);
       listRef.current?.querySelector<HTMLElement>(`[data-tab-key="${next}"]`)?.focus({ preventScroll: true });
      }
     }
    }}
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
       data-tab-key={term.id}
       role="tab"
       id={`terminal-tab-${term.id}`}
       aria-controls={`terminal-panel-${term.id}`}
       tabIndex={focusedKey === term.id ? 0 : -1}
       aria-selected={active}
       title={
        renaming?.id === term.id
         ? undefined
         : [term.cwd, term.collab.length > 0 ? fmt(t.termCollab, term.collab.join("\n")) : null, t.termRenameHint]
          .filter(Boolean)
          .join("\n")
       }
       onClick={() => useApp.getState().focusTerminal(term.id)}
       onDoubleClick={(e) => {
        e.preventDefault();
        // 双击默认会选中名字文本：重命名入口不需要那层选区
        window.getSelection()?.removeAllRanges();
        startRename(term);
       }}
       onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
         e.preventDefault();
         e.stopPropagation();
         useApp.getState().focusTerminal(term.id);
        }
       }}
       className={`group flex min-h-9 min-w-0 w-40 max-w-60 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12px] transition-colors duration-100 sm:w-48 ${active ? "border-border bg-surface font-medium text-foreground" : "border-transparent text-muted hover:bg-hover"
        }`}
      >
       <span
        aria-hidden
        title={stateText ? t[stateText] : undefined}
        className={`shrink-0 font-mono text-[14px] leading-none ${STATE_TONE[term.state]}`}
       >
        π
       </span>
       <span className="min-w-0 flex-1">
        {renaming?.id === term.id ? (
         <input
          autoFocus
          value={renaming.draft}
          onChange={(e) => setRenaming((cur) => (cur ? { ...cur, draft: e.target.value, error: null } : cur))}
          onKeyDown={renameKeyDown}
          onBlur={() => setRenaming(null)}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={t.termRenameAria}
          aria-invalid={renaming.error !== null}
          placeholder={t.termRenamePlaceholder}
          maxLength={SESSION_TITLE_MAX}
          className={`block h-4 w-full rounded-sm border bg-background px-1 text-[12px] leading-4 outline-none ${renaming.error ? "border-danger" : "border-accent"}`}
         />
        ) : (
         <span className="block truncate text-[13px] leading-4">{terminalDisplayName(term)}</span>
        )}
        {renaming?.id === term.id && renaming.error ? (
         <span className="block truncate text-[11px] leading-4 text-danger">{renaming.error}</span>
        ) : null}
       </span>
       {stateText && <span className="sr-only">{t[stateText]}</span>}
       <button
        onClick={(e) => {
         e.stopPropagation();
         useApp.getState().requestCloseTerminal(term.id);
        }}
        onKeyDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-label={t.termClose}
        className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity duration-100 hover:bg-active ${active ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"
         }`}
       >
        <X className="size-3" />
       </button>
      </div>
     );
    })}
    {settingsTabOpen && (
     <div
      data-tab-key="settings"
      role="tab"
      id="settings-tab-label"
      aria-controls="settings-panel"
      tabIndex={focusedKey === "settings" ? 0 : -1}
      aria-selected={settingsTabActive}
      onClick={() => useApp.getState().openSettingsTab()}
      onKeyDown={(e) => {
       if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        useApp.getState().openSettingsTab();
       }
      }}
      className={`group flex min-h-9 min-w-0 w-40 max-w-60 shrink-0 cursor-pointer items-center gap-2 rounded-md border px-3 text-[12px] transition-colors duration-100 ${settingsTabActive ? "border-border bg-surface font-medium text-foreground" : "border-transparent text-muted hover:bg-hover"
       }`}
     >
      <Settings className="size-3.5 shrink-0 text-faint" />
      <span className="min-w-0 flex-1 truncate">{t.title}</span>
      <button
       onClick={(e) => {
        e.stopPropagation();
        useApp.getState().closeSettingsTab();
       }}
       onKeyDown={(e) => e.stopPropagation()}
       aria-label={t.close}
       className={`flex size-6 shrink-0 cursor-pointer items-center justify-center rounded transition-opacity duration-100 hover:bg-active ${settingsTabActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60 group-focus-within:opacity-60"
        }`}
      >
       <X className="size-3" />
      </button>
     </div>
    )}
   </div>
   <div className="flex items-center gap-1 px-2">
    <button
     onClick={() => useApp.getState().set({ quickSwitcherOpen: true })}
     aria-label={t.quickSwitcherAria}
     title={t.quickSwitcherTitle}
     className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-surface text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     <Search size={14} aria-hidden />
    </button>
    <button
     onClick={() => newTerminalInSelection()}
     disabled={!target}
     aria-label={t.termNew}
     title={target ? target.path : t.termNewHint}
     className="flex size-8 cursor-pointer items-center justify-center rounded-md border border-border-soft bg-surface text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
    >
     <Plus className="size-4" />
    </button>
   </div>
  </div >
 );
}
