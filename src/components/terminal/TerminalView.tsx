import { useMemo, useState } from "react";
import { BrowserTerminal } from "reicon-react";
import { useApp } from "../../stores/app";
import { loadWorkspaces, newTerminalInActiveWorkspace, resolveNewTerminalWorkspace } from "../../lib/workspaces";
import { terminalsInWorkspace } from "../../lib/terminalScope";
import { pickAndAddProject } from "../../lib/projects";
import { isMacKeyboard } from "../../lib/termInput";
import { fmt } from "../../lib/locale";
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
 const allTerminals = useApp((s) => s.terminals);
 const activeId = useApp((s) => s.activeTerminalId);
 const activeWorkspacePath = useApp((s) => s.activeWorkspacePath);
 const scoped = useMemo(
  () => terminalsInWorkspace(allTerminals, activeWorkspacePath),
  [allTerminals, activeWorkspacePath],
 );
 // 显示哪个面板：激活终端必须落在当前工作区里，否则这个工作区就是「没有终端」——交回空态。
 const inScope = activeId !== null && scoped.some((term) => term.id === activeId);
 const shownId = visible && inScope ? activeId : null;
 return (
  <div className={visible ? "relative min-h-0 flex-1" : "hidden"}>
   {!inScope && <EmptyTerminal />}
   {allTerminals.map((term) => (
    <div
     key={term.id}
     className={term.id === shownId ? "absolute inset-0" : "hidden"}
    >
     <TerminalPane term={term} active={term.id === shownId} />
    </div>
   ))}
  </div>
 );
}

/** 空态：引导开第一个终端（左栏空态负责引导添加项目）。 */
function EmptyTerminal() {
 const projects = useApp((s) => s.projects);
 const workspaces = useApp((s) => s.workspaces);
 const activeWorkspacePath = useApp((s) => s.activeWorkspacePath);
 const t = useText();
 const [busy, setBusy] = useState(false);
 const [error, setError] = useState<string | null>(null);
 const target = resolveNewTerminalWorkspace(workspaces, activeWorkspacePath);
 const shortcut = isMacKeyboard() ? "⌘ T" : "Ctrl+Shift+T";
 const addProject = async () => {
  setBusy(true);
  setError(null);
  try {
   const res = await pickAndAddProject();
   if (res && !res.ok) setError(res.message);
   if (res?.ok) await loadWorkspaces();
  } catch (e) {
   setError(e instanceof Error ? e.message : t.addProjectFailed);
  } finally {
   setBusy(false);
  }
 };
 return (
  <div className="flex h-full flex-col items-center justify-center overflow-y-auto px-6 py-10">
   <div className="flex w-full max-w-md flex-col items-center text-center">
    <div className="mb-7 flex size-16 items-center justify-center rounded-2xl border border-border bg-surface text-accent">
     <BrowserTerminal size={28} aria-hidden />
    </div>
    <p className="mb-3 font-mono text-[11px] tracking-[0.16em] text-faint">omp / {t.termPaneAria}</p>
    <h2 className="text-[24px] leading-tight font-semibold tracking-tight sm:text-[28px]">{t.termEmptyTitle}</h2>
    <p className="mt-4 max-w-[340px] text-[13px] leading-6 text-muted">{t.termEmptyBody}</p>
    {projects.length === 0 ? (
     <>
      <button
       onClick={() => void addProject()}
       disabled={busy}
       aria-label={t.sidebarAddProjectAria}
       className="mt-7 flex cursor-pointer items-center gap-4 rounded-md border border-accent/25 bg-accent/10 px-4 py-2.5 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.sidebarAddProjectAria}
      </button>
      {error && (
       <button
        onClick={() => void addProject()}
        disabled={busy}
        className="mt-3 max-w-[340px] cursor-pointer rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[12px] text-danger transition-colors duration-100 hover:bg-danger/15 disabled:opacity-50"
       >
        {error}
       </button>
      )}
     </>
    ) : target ? (
     <button
      onClick={() => newTerminalInActiveWorkspace()}
      title={fmt(t.termOpenInHint, target.path)}
      className="mt-7 flex cursor-pointer items-center gap-4 rounded-md border border-accent/25 bg-accent/10 px-4 py-2.5 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-hover"
     >
      {t.termNew}
      <kbd className="font-mono text-[11px] opacity-75">{shortcut}</kbd>
     </button>
    ) : (
     <>
      <p className="mt-7 max-w-[340px] rounded-md border border-border-soft bg-surface px-4 py-2.5 text-[12px] leading-relaxed text-muted">{t.termEmptyNoWorkspaceBody}</p>
      <button
       onClick={() => useApp.getState().set({ sidebarOpen: true })}
       className="mt-3 cursor-pointer rounded-md border border-border px-3 py-1.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {t.termViewProjects}
      </button>
     </>
    )}
    <div className="mt-12 flex flex-wrap justify-center gap-x-6 gap-y-3 border-t border-border-soft pt-5 text-[11px] text-faint">
     <span className="flex items-center gap-2"><kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono">{shortcut}</kbd>{t.termNew}</span>
     <span className="flex items-center gap-2"><kbd className="rounded-sm border border-border bg-surface px-1.5 py-0.5 font-mono">⌘ 1–9</kbd>{t.termSwitch}</span>
    </div>
   </div>
  </div>
 );
}
