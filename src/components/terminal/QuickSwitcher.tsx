import { useId, useMemo, useRef, useState } from "react";
import { Layers } from "reicon-react";
import type { CheckoutView, TerminalView } from "@shared/types";
import { useApp } from "../../stores/app";
import { checkoutLabel, describeTerminalWorkspace, openOrFocusCheckout } from "../../lib/checkouts";
import { terminalDisplayName } from "../../lib/termTitle";
import { useText } from "../../lib/useText";
import { STATE_TEXT, STATE_TONE } from "../../lib/termState";
import { DialogShell } from "../settings/DialogShell";

type Match =
 | { kind: "terminal"; id: string; key: string; title: string; subtitle: string }
 | { kind: "group"; id: string; key: string; title: string; subtitle: string }
 | { kind: "checkout"; path: string; key: string; title: string; subtitle: string; disabled: boolean };

function keyOf(term: TerminalView, checkouts: readonly CheckoutView[]): string {
 return `${terminalDisplayName(term)}\n${term.cwd}\n${describeTerminalWorkspace(term.cwd, checkouts).primary}`;
}

function checkoutKey(ws: CheckoutView): string {
 return `${ws.projectName}\n${ws.branch ?? ""}\n${ws.path}`;
}

/**
 * 快速切换（终端 / 工作区 / 工作区目录导航）：只做本地搜索与跳转。
 *
 * - 输入不调用 IPC，不扫描会话内容；分组与顺序沿用标签、工作区与目录顺序。
 * - 终端 `focusTerminal`、工作区 `selectGroup`、目录 `openOrFocusCheckout`，执行前重核目标。
 */
export function QuickSwitcher(): React.JSX.Element {
 const t = useText();
 const terminals = useApp((s) => s.terminals);
 const checkouts = useApp((s) => s.checkouts);
 const workspaceGroups = useApp((s) => s.workspaceGroups);
 const projects = useApp((s) => s.projects);
 const inputRef = useRef<HTMLInputElement>(null);
 const listId = useId();
 const [query, setQuery] = useState("");
 const [cursor, setCursor] = useState(0);
 const [gone, setGone] = useState(false);
 const inputId = `${listId}-input`;

 const cleaned = query.trim().toLowerCase();
 const termMatches = useMemo<Match[]>(() => terminals
  .filter((term) => !cleaned || keyOf(term, checkouts).toLowerCase().includes(cleaned))
  .map((term) => {
   const context = describeTerminalWorkspace(term.cwd, checkouts);
   return {
    kind: "terminal" as const,
    id: term.id,
    key: `term-${term.id}`,
    title: terminalDisplayName(term),
    subtitle: context.primary,
   };
  }), [cleaned, terminals, checkouts]);
 const groupMatches = useMemo<Match[]>(() => workspaceGroups
  .filter((group) => {
   if (!cleaned) return true;
   const names = projects.filter((p) => p.workspaceId === group.id).map((p) => p.name).join(" ");
   return `${group.name} ${names}`.toLowerCase().includes(cleaned);
  })
  .map((group) => ({
   kind: "group" as const,
   id: group.id,
   key: `grp-${group.id}`,
   title: group.name,
   subtitle: projects.filter((p) => p.workspaceId === group.id).map((p) => p.name).join(" · "),
  })), [cleaned, projects, workspaceGroups]);
 const checkoutMatches = useMemo<Match[]>(() => checkouts
  .filter((ws) => !cleaned || checkoutKey(ws).toLowerCase().includes(cleaned))
  .map((ws) => ({
   kind: "checkout" as const,
   path: ws.path,
   key: `ck-${ws.path}`,
   title: checkoutLabel(ws),
   subtitle: ws.missing ? t.quickSwitcherMissingWorkspace : ws.path,
   disabled: ws.missing,
  })), [cleaned, t.quickSwitcherMissingWorkspace, checkouts]);
 const matches = useMemo<Match[]>(
  () => [...termMatches, ...groupMatches, ...checkoutMatches],
  [termMatches, groupMatches, checkoutMatches],
 );
 const actionable = useMemo(() => matches.filter((m) => m.kind !== "checkout" || !m.disabled), [matches]);
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
  if (match.kind === "group") {
   if (!s.workspaceGroups.some((group) => group.id === match.id)) {
    setGone(true);
    return;
   }
   s.set({ quickSwitcherOpen: false, sidebarOpen: false });
   s.selectGroup(match.id);
   return;
  }
  const ws = s.checkouts.find((item) => item.path === match.path);
  if (!ws || ws.missing) {
   setGone(true);
   return;
  }
  s.set({ quickSwitcherOpen: false, sidebarOpen: false });
  openOrFocusCheckout(ws);
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
     <div role="listbox" id={listId} aria-label={t.quickSwitcherTitle} className="max-h-80 overflow-y-auto">
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
      {groupMatches.length > 0 && (
       <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint">{t.quickSwitcherWorkspaces}</p>
      )}
      {groupMatches.map((match) => (
       <button
        key={match.key}
        id={`${listId}-${match.key}`}
        type="button"
        role="option"
        aria-selected={active?.key === match.key}
        onClick={() => choose(match)}
        className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors duration-100 ${active?.key === match.key ? "bg-active" : "hover:bg-hover"}`}
       >
        <Layers size={13} aria-hidden className="shrink-0 text-muted" />
        <span className="min-w-0 flex-1">
         <span className="block truncate text-[13px]">{match.title}</span>
         <span className="block truncate text-[11px] text-faint">{match.subtitle}</span>
        </span>
       </button>
      ))}
      {checkoutMatches.length > 0 && (
       <p className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-faint">{t.quickSwitcherCheckouts}</p>
      )}
      {checkoutMatches.map((match) => (
       <button
        key={match.key}
        id={`${listId}-${match.key}`}
        type="button"
        role="option"
        aria-selected={active?.key === match.key}
        disabled={match.kind === "checkout" && match.disabled}
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
