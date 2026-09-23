import { useId, useMemo, useRef, useState } from "react";
import type { TerminalView, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { describeTerminalWorkspace, openOrFocusWorkspace, workspaceLabel } from "../../lib/workspaces";
import { terminalDisplayName } from "../../lib/termTitle";
import { useText } from "../../lib/useText";
import { STATE_TEXT, STATE_TONE } from "../../lib/termState";
import { DialogShell } from "../settings/DialogShell";

type Match =
 | { kind: "terminal"; id: string; key: string; title: string; subtitle: string }
 | { kind: "workspace"; path: string; key: string; title: string; subtitle: string; disabled: boolean };

function keyOf(term: TerminalView, workspaces: readonly WorkspaceView[]): string {
 return `${terminalDisplayName(term)}\n${term.cwd}\n${describeTerminalWorkspace(term.cwd, workspaces).primary}`;
}

function workspaceKey(ws: WorkspaceView): string {
 return `${ws.projectName}\n${ws.branch ?? ""}\n${ws.path}`;
}

/**
 * 快速切换（终端与工作区导航）：只做已打开终端与工作区的本地搜索与跳转。
 *
 * - 输入不调用 IPC，不扫描会话内容；分组与顺序沿用标签与工作区顺序。
 * - 终端调用 `focusTerminal`，工作区调用 `openOrFocusWorkspace`，执行前重核目标。
 */
export function QuickSwitcher(): React.JSX.Element {
 const t = useText();
 const terminals = useApp((s) => s.terminals);
 const workspaces = useApp((s) => s.workspaces);
 const inputRef = useRef<HTMLInputElement>(null);
 const listId = useId();
 const [query, setQuery] = useState("");
 const [cursor, setCursor] = useState(0);
 const [gone, setGone] = useState(false);
 const inputId = `${listId}-input`;

 const cleaned = query.trim().toLowerCase();
 const termMatches = useMemo<Match[]>(() => terminals
  .filter((term) => !cleaned || keyOf(term, workspaces).toLowerCase().includes(cleaned))
  .map((term) => {
   const context = describeTerminalWorkspace(term.cwd, workspaces);
   return {
    kind: "terminal" as const,
    id: term.id,
    key: `term-${term.id}`,
    title: terminalDisplayName(term),
    subtitle: context.primary,
   };
  }), [cleaned, terminals, workspaces]);
 const wsMatches = useMemo<Match[]>(() => workspaces
  .filter((ws) => !cleaned || workspaceKey(ws).toLowerCase().includes(cleaned))
  .map((ws) => ({
   kind: "workspace" as const,
   path: ws.path,
   key: `ws-${ws.path}`,
   title: workspaceLabel(ws),
   subtitle: ws.missing ? t.quickSwitcherMissingWorkspace : ws.path,
   disabled: ws.missing,
  })), [cleaned, t.quickSwitcherMissingWorkspace, workspaces]);
 const matches = useMemo<Match[]>(() => [...termMatches, ...wsMatches], [termMatches, wsMatches]);
 const actionable = useMemo(() => matches.filter((m) => m.kind === "terminal" || !m.disabled), [matches]);
 const active = actionable.length > 0 ? actionable[Math.min(cursor, actionable.length - 1)] : null;

 const close = () => useApp.getState().set({ quickSwitcherOpen: false });
 const choose = (match: Match) => {
  const s = useApp.getState();
  if (match.kind === "terminal") {
   if (!s.terminals.some((term) => term.id === match.id)) {
    setGone(true);
    return;
   }
   s.set({ quickSwitcherOpen: false, sidebarOpen: false });
   s.focusTerminal(match.id);
   return;
  }
  const ws = s.workspaces.find((item) => item.path === match.path);
  if (!ws || ws.missing) {
   setGone(true);
   return;
  }
  s.set({ quickSwitcherOpen: false, sidebarOpen: false });
  openOrFocusWorkspace(ws);
 };

 return (
  <DialogShell title={t.quickSwitcherTitle} onClose={close} initialFocusRef={inputRef}>
   <div className="flex flex-col gap-3">
    <input
     ref={inputRef}
     id={inputId}
     value={query}
     onChange={(e) => {
      setQuery(e.target.value);
      setCursor(0);
      setGone(false);
     }}
     onKeyDown={(e) => {
      if (e.nativeEvent.isComposing) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
       if (actionable.length === 0) return;
       e.preventDefault();
       const delta = e.key === "ArrowDown" ? 1 : -1;
       const index = active ? actionable.indexOf(active) : -1;
       setCursor(((index < 0 ? 0 : index) + delta + actionable.length) % actionable.length);
      } else if (e.key === "Enter") {
       if (active) {
        e.preventDefault();
        choose(active);
       }
      }
     }}
     role="combobox"
     aria-expanded
     aria-controls={listId}
     aria-activedescendant={active ? `${listId}-${active.key}` : undefined}
     aria-autocomplete="list"
     placeholder={t.quickSwitcherPlaceholder}
     aria-label={t.quickSwitcherPlaceholder}
     className="h-9 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none focus:border-accent"
    />
    {gone && (
     <p role="alert" className="rounded-md border border-danger/20 bg-danger/10 px-3 py-2 text-[13px] text-danger">
      {t.quickSwitcherTargetGone}
     </p>
    )}
    {matches.length === 0 ? (
     <div className="flex flex-col items-center gap-2 py-6 text-center">
      <p className="text-[13px] text-muted">{t.quickSwitcherEmpty}</p>
      <button
       type="button"
       onClick={() => {
        setQuery("");
        setCursor(0);
       }}
       className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      >
       {t.quickSwitcherClear}
      </button>
     </div>
    ) : (
     <div role="listbox" id={listId} aria-label={t.quickSwitcherTitle} className="max-h-80 overflow-y-auto [scrollbar-gutter:stable]">
      {termMatches.length > 0 && (
       <p className="px-2 pt-1 pb-1 text-[11px] font-medium tracking-wide text-faint">{t.quickSwitcherTerminals}</p>
      )}
      {termMatches.map((match) => {
       const term = terminals.find((item) => item.id === (match.kind === "terminal" ? match.id : ""));
       const tone = term ? STATE_TONE[term.state] : "text-faint";
       const stateKey = term ? STATE_TEXT[term.state] : null;
       return (
        <button
         key={match.key}
         id={`${listId}-${match.key}`}
         type="button"
         role="option"
         aria-selected={active?.key === match.key}
         onClick={() => choose(match)}
         className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-100 ${active?.key === match.key ? "bg-active" : "hover:bg-hover"}`}
        >
         <span aria-hidden className={`shrink-0 font-mono text-[14px] leading-none ${tone}`}>
          π
         </span>
         <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px]">{match.title}</span>
          <span className="block truncate font-mono text-[11px] text-faint">{match.subtitle}</span>
         </span>
         {stateKey && <span className="sr-only">{t[stateKey]}</span>}
        </button>
       );
      })}
      {wsMatches.length > 0 && (
       <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint">{t.quickSwitcherWorkspaces}</p>
      )}
      {wsMatches.map((match) => (
       <button
        key={match.key}
        id={`${listId}-${match.key}`}
        type="button"
        role="option"
        aria-selected={active?.key === match.key}
        disabled={match.kind === "workspace" && match.disabled}
        onClick={() => choose(match)}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-100 disabled:cursor-not-allowed disabled:opacity-50 ${active?.key === match.key ? "bg-active" : "hover:bg-hover"}`}
       >
        <span className="min-w-0 flex-1">
         <span className="block truncate text-[13px]">{match.title}</span>
         <span className="block truncate font-mono text-[11px] text-faint">{match.subtitle}</span>
        </span>
       </button>
      ))}
     </div>
    )}
   </div>
  </DialogShell>
 );
}
