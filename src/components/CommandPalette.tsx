import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "reicon-react";
import type { SessionView } from "@shared/types";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { filterPalette, PALETTE_ACTIONS, type PaletteActionId, type PaletteEntry } from "../lib/commandPalette";
import { cycleSessionApproval } from "../lib/sessionApproval";
import { openBtwPanel } from "../lib/btw";
import { createChatIn, openForkedSession, openSessionWithHistory } from "../lib/sessionOpen";
import { forgetSession } from "../lib/useSessionEvents";
import { isMacKeyboard } from "../lib/platform";
import { useText } from "../lib/useText";

/**
 * 命令中心（⌘K，V41 起；v2 §5 对齐 Codex 的 `Search chats`）：一个浮层里做「会话搜索 + 动作」。
 *
 * - **会话置顶**（v2）：条目 = 标题 + 项目名 + `⌃1..⌃9` 编号快捷键（前 9 条可直接切）；
 * - 动作 = `lib/commandPalette.ts` 的固定清单（执行映射在本组件）；
 * - 会话 = 打开时 `list_sessions` 拉一次（失败退回 store 已会话缓存），Enter 切过去；
 * - 键盘：↑↓ 选择、Enter 执行、`⌃/⌘+1..9` 直达会话、Esc 关闭；点击遮罩关闭（卡片内不冒泡）。
 *
 * 挂载由 App 负责（`paletteOpen && <CommandPalette />`）——打开才挂载、关闭即卸载：
 * 本地状态（查询 / 高亮 / 会话快照）随之清掉，每次打开都是干净一栏。
 */
export function CommandPalette() {
 const t = useText();
 const setPaletteOpen = useApp((s) => s.setPaletteOpen);
 const [query, setQuery] = useState("");
 const [idx, setIdx] = useState(0);
 const [sessions, setSessions] = useState<SessionView[] | null>(null);
 const inputRef = useRef<HTMLInputElement>(null);

 useEffect(() => {
  let alive = true;
  void api
   .listSessions(undefined, 100)
   .then((p) => {
    if (alive) setSessions(p.sessions);
   })
   .catch(() => {
    // 拉不到就用会话缓存顶上（仍可搜索切会话）
    if (alive) setSessions(useApp.getState().sessions);
   });
  inputRef.current?.focus();
  return () => {
   alive = false;
  };
 }, []);

 const projects = useApp((s) => s.projects);
 const entries: PaletteEntry[] = useMemo(() => {
  const dict = t as unknown as Record<string, string>;
  const acts: PaletteEntry[] = PALETTE_ACTIONS.map((a) => ({
   kind: "action",
   id: a.id,
   title: dict[a.titleKey] ?? a.id,
  }));
  const sess: PaletteEntry[] = (sessions ?? [])
   .filter((s) => !s.archived)
   .map((s) => ({
    kind: "session",
    sid: s.id,
    title: s.title?.trim() || t.unnamedChat,
    // 行尾元数据 = 项目名（对齐 Codex 的 `Search chats`：标题 + 项目名），
    // 未归属会话退回目录基名
    hint: projects.find((p) => p.id === s.projectId)?.name ?? (s.cwd.split("/").filter(Boolean).pop() || s.cwd),
    running: s.running,
   }));
  // 会话置顶（v2 §5，对齐 Codex `Search chats`）：搜索切会话是这里最高频的动作
  return [...sess, ...acts];
 }, [sessions, projects, t]);

 const filtered = useMemo(() => filterPalette(entries, query), [entries, query]);
 const cur = filtered.length === 0 ? -1 : Math.min(idx, filtered.length - 1);
 /** 会话在过滤结果里的序号（0 基）：前 9 条带 `⌃1..⌃9` 编号快捷键。 */
 const sessionOrder = useMemo(() => {
  const m = new Map<string, number>();
  let n = 0;
  for (const e of filtered) {
   if (e.kind === "session") m.set(e.sid, n++);
  }
  return m;
 }, [filtered]);

 const close = () => setPaletteOpen(false);

 const runAction = (id: PaletteActionId) => {
  const st = useApp.getState();
  const sid = st.activeSessionId;
  close();
  switch (id) {
   case "new-chat": {
    const cwd = st.sessions.find((s) => s.id === sid)?.cwd ?? st.checkouts[0]?.path;
    if (cwd) void createChatIn(cwd).catch(() => undefined);
    break;
   }
   case "find":
    st.setFindOpen(true);
    break;
   case "status":
    st.setStatsOpen(true);
    break;
   case "btw":
    if (sid) void openBtwPanel(sid);
    break;
   case "fork":
    if (sid) {
     void api
      .forkSession(sid)
      .then((v) => openForkedSession(v))
      .catch(() => undefined);
    }
    break;
   case "compact":
    if (sid) void api.compactSession(sid).catch(() => undefined);
    break;
   case "approval":
    if (sid) void cycleSessionApproval(sid);
    break;
   case "archive":
    if (sid) {
     void api
      .archiveSessions([sid])
      .then(() => {
       forgetSession(sid);
       const st2 = useApp.getState();
       st2.set({ activeSessionId: null, sessions: st2.sessions.filter((s) => s.id !== sid) });
      })
      .catch(() => undefined);
    }
    break;
   case "settings":
    st.openSettingsTab();
    break;
   case "usage":
    st.set({ providerUsageOpen: true });
    break;
  }
 };

 const runEntry = (e: PaletteEntry) => {
  if (e.kind === "session") {
   close();
   void openSessionWithHistory(e.sid);
  } else {
   runAction(e.id);
  }
 };

 const onKeyDown = (e: React.KeyboardEvent) => {
  // 编号快捷键（v2 §5，对齐 Codex `Ctrl+1..9`）：修饰键 + 数字直接切到对应会话
  if ((e.ctrlKey || e.metaKey) && /^[1-9]$/.test(e.key)) {
   const target = [...sessionOrder.entries()].find(([, n]) => n === Number(e.key) - 1)?.[0];
   const entry = target ? filtered.find((x) => x.kind === "session" && x.sid === target) : undefined;
   if (entry) {
    e.preventDefault();
    runEntry(entry);
   }
   return;
  }
  if (e.key === "ArrowDown") {
   e.preventDefault();
   if (filtered.length > 0) setIdx((i) => (i + 1) % filtered.length);
   return;
  }
  if (e.key === "ArrowUp") {
   e.preventDefault();
   if (filtered.length > 0) setIdx((i) => (i - 1 + filtered.length) % filtered.length);
   return;
  }
  if (e.key === "Enter") {
   e.preventDefault();
   const e0 = cur >= 0 ? filtered[cur] : undefined;
   if (e0) runEntry(e0);
   return;
  }
  if (e.key === "Escape") {
   e.preventDefault();
   close();
  }
 };

 return (
  <div className="fixed inset-0 z-30 flex items-start justify-center bg-background/40 pt-[12vh]" onMouseDown={close}>
   <div
    role="dialog"
    aria-label={t.palPlaceholder}
    className="w-[560px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-border bg-elevated shadow-pop"
    onMouseDown={(e) => e.stopPropagation()}
   >
    <div className="flex items-center gap-2 border-b border-border-soft px-3 py-2.5">
     <Search size={14} className="shrink-0 text-faint" aria-hidden />
     <input
      ref={inputRef}
      value={query}
      onChange={(e) => {
       setQuery(e.target.value);
       setIdx(0);
      }}
      onKeyDown={onKeyDown}
      placeholder={t.palPlaceholder}
      aria-label={t.palPlaceholder}
      className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint"
     />
    </div>
    <div role="listbox" aria-label={t.palPlaceholder} className="max-h-[46vh] overflow-y-auto py-1">
     {filtered.length === 0 && <div className="px-3 py-2 text-[13px] text-muted">{t.palEmpty}</div>}
     {filtered.map((e, i) => (
      <Fragment key={e.kind === "action" ? `a-${e.id}` : `s-${e.sid}`}>
       {/* 组标题只在组首条前出现；过滤后仍按「会话 → 动作」的相对顺序分组（会话置顶） */}
       {e.kind === "session" && (i === 0 || filtered[i - 1].kind !== "session") && (
        <div role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium text-faint">
         {t.palSessionsGroup}
        </div>
       )}
       {e.kind === "action" && (i === 0 || filtered[i - 1].kind !== "action") && (
        <div role="presentation" className="px-3 pt-2 pb-1 text-[11px] font-medium text-faint">
         {t.palActionsGroup}
        </div>
       )}
       <button
        type="button"
        role="option"
        aria-selected={i === cur}
        onClick={() => runEntry(e)}
        onMouseEnter={() => setIdx(i)}
        className={`flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left ${i === cur ? "bg-hover" : ""}`}
       >
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{e.title}</span>
        {e.hint && (
         <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-faint" title={e.hint}>
          {e.hint}
         </span>
        )}
        {e.kind === "session" && e.running && (
         <span className="size-1.5 shrink-0 rounded-full bg-ok" aria-hidden />
        )}
        {/* 编号快捷键（v2 §5）：前 9 条会话可 `⌃1..⌃9` 直达 */}
        {e.kind === "session" && (sessionOrder.get(e.sid) ?? 99) < 9 && (
         <kbd className="shrink-0 rounded-sm border border-border-soft px-1 font-mono text-[10px] text-faint">
          {isMacKeyboard() ? `⌃${(sessionOrder.get(e.sid) ?? 0) + 1}` : `Ctrl+${(sessionOrder.get(e.sid) ?? 0) + 1}`}
         </kbd>
        )}
       </button>
      </Fragment>
     ))}
    </div>
    <div className="border-t border-border-soft px-3 py-1.5 text-[11px] text-faint">{t.palHint}</div>
   </div>
  </div>
 );
}
