import { api } from "@shared/api";
import type { CheckoutView, ProjectView, SidebarSelection } from "@shared/types";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";
import { createChatIn, openSessionWithHistory } from "./sessionOpen";
import { selectionScopePaths } from "./workspaceGroups";

/**
 * 目录行（项目主目录 / git worktree；V21 前叫「工作区行」）的前端逻辑：
 * 取数（`loadCheckouts` 是唯一刷新入口）、显示名，以及「点击目录 / 新建终端」的动作收敛。
 */

/** 目录行显示名：`项目名 · 分支`（detached 用「游离」）；分支未知时只留项目名。 */
export function checkoutLabel(ws: CheckoutView): string {
 const where = ws.branch ?? (ws.head ? TEXT[useApp.getState().locale].wsDetached : null);
 return where ? `${ws.projectName} · ${where}` : ws.projectName;
}

/** 拉取目录行 + 工作区清单并落库；失效的选中项自动回退第一个可用目录。
 *
 * 选中项失效（工作区被删 / 项目被移除 / 目录不见）时，激活终端要**一起收敛回同一范围**：
 * 右栏视图按选中项过滤，留下一个范围外的激活终端会让视图空掉（标签栏无选中标签、面板空白）。
 * 组视图（`selection` = group）**永远有效**（组内可能一个目录都没有——那是空态，不是失效）；
 * 只有「组被删」与「目录没了」才回退。 */
export async function loadCheckouts(): Promise<CheckoutView[]> {
 const [list, groups] = await Promise.all([api.listCheckouts(), api.listWorkspaces()]);
 const s = useApp.getState();
 const sel = s.selection;
 const valid = sel === null
  ? false
  : sel.kind === "checkout"
   ? list.some((w) => w.path === sel.path && !w.missing)
   : sel.id === null || groups.some((g) => g.id === sel.id);
 if (valid) {
  s.set({ checkouts: list, workspaceGroups: groups });
  return list;
 }
 const first = list.find((w) => !w.missing);
 const next: SidebarSelection | null = first ? { kind: "checkout", path: first.path } : null;
 const scope = selectionScopePaths(next, groups, list, s.projects);
 const scoped = scope === null ? s.terminals : s.terminals.filter((t) => scope.has(t.cwd));
 s.set({
  checkouts: list,
  workspaceGroups: groups,
  selection: next,
  activeTerminalId: scoped[scoped.length - 1]?.id ?? null,
 });
 return list;
}

/** 打开或聚焦某目录行的终端：已有该目录的终端 → 聚焦最近一个；否则新建。
 *
 * V32 二次口径起聊天形态有**自己的左栏**（`ChatSidebar` 的会话列表），工作区树只在终端形态
 * 可见——目录行点击不再做形态分流，这里就是终端语义的唯一定义。 */
export function openOrFocusCheckout(ws: CheckoutView): void {
 if (ws.missing) return;
 const s = useApp.getState();
 const existing = s.terminals.filter((t) => t.cwd === ws.path);
 if (existing.length > 0) {
  s.focusTerminal(existing[existing.length - 1].id);
  return;
 }
 s.openTerminal({ projectId: ws.projectId, cwd: ws.path, label: checkoutLabel(ws) });
}

/** `⌘T`（聊天形态）的执行侧：该目录已有运行中的聊天 → 聚焦它；当前聊天就在该目录 → 留着；
 *  否则在该目录新建一个（懒写盘，空转无副作用）。 */
export function openChatForCheckout(ws: CheckoutView): void {
 const s = useApp.getState();
 const running = s.sessions.filter((x) => x.cwd === ws.path && x.running && !x.archived).pop();
 if (running) {
  void openSessionWithHistory(running.id);
  return;
 }
 if (s.activeSessionId) {
  // 该目录已有当前打开的聊天（可能已不是 running——刚建好还没跑过）→ 直接留着
  const cur = s.sessions.find((x) => x.id === s.activeSessionId);
  if (cur && cur.cwd === ws.path) return;
 }
 void createChatIn(ws.path, { projectName: ws.projectName });
}

/** `⌘T`（聊天形态）：按当前选中项新建聊天（与 `newTerminalInSelection` 同一套目标选择）。 */
export function newChatInSelection(): CheckoutView | null {
 const s = useApp.getState();
 const ws = resolveNewTerminalCheckout(s.checkouts, s.selection, s.projects);
 if (!ws) return null;
 openChatForCheckout(ws);
 return ws;
}

/** `＋` / ⌘T：按当前选中项**新建**终端；没选中时退回第一个可用主目录。 */
export function newTerminalInSelection(): CheckoutView | null {
 const s = useApp.getState();
 const ws = resolveNewTerminalCheckout(s.checkouts, s.selection, s.projects);
 if (!ws) return null;
 s.openTerminal({ projectId: ws.projectId, cwd: ws.path, label: checkoutLabel(ws) });
 return ws;
}

/** 新建终端的目标选择（侧栏 / 空态 / 标签栏按钮共用同一顺序，不各自猜测）。
 *
 * - 目录视图：该目录（失效则落兜底）；
 * - 工作区视图：组内**第一个可用项目的主目录**（成员顺序 = 左栏顺序，可拖拽调整）；
 * - 没有选中项：第一个可用项目的主目录。 */
export function resolveNewTerminalCheckout(
 checkouts: readonly CheckoutView[],
 selection: SidebarSelection | null,
 projects: readonly ProjectView[],
): CheckoutView | null {
 const usable = checkouts.filter((w) => !w.missing);
 if (selection?.kind === "checkout") {
  const hit = usable.find((w) => w.path === selection.path);
  if (hit) return hit;
 }
 if (selection?.kind === "group") {
  for (const p of projects) {
   if (p.workspaceId !== selection.id) continue;
   const main = usable.find((w) => w.projectId === p.id && w.isMain);
   if (main) return main;
  }
  return null;
 }
 return usable.find((w) => w.isMain) ?? usable[0] ?? null;
}

/** 终端上下文显示：优先用目录行名，找不到时用路径末段；title 仍保留完整路径。 */
export function describeTerminalWorkspace(
 cwd: string,
 checkouts: readonly CheckoutView[],
): { primary: string; title: string } {
 const hit = checkouts.find((w) => w.path === cwd);
 if (hit) return { primary: checkoutLabel(hit), title: cwd };
 const tail = cwd.split("/").filter(Boolean).pop() ?? cwd;
 return { primary: tail, title: cwd };
}
/** 会话弹窗的「在终端中恢复」：在新终端里 `omp --resume <id>`，cwd 用会话原目录。 */
export function resumeSessionInTerminal(session: {
 id: string;
 cwd: string;
 title: string;
 projectId: string | null;
}): void {
 useApp.getState().openTerminal({
  projectId: session.projectId,
  cwd: session.cwd,
  label: session.title,
  resume: session.id,
 });
}

/** 会话弹窗 / 归档恢复的「打开」：**按当前形态分流**——终端形态开终端 resume，
 *  聊天形态进聊天视图（`open_session` 起 / 聚焦长驻 RPC 并拉历史）。 */
export function resumeSessionInApp(session: {
 id: string;
 cwd: string;
 title: string;
 projectId: string | null;
}): void {
 if (useApp.getState().appMode === "chat") {
  void openSessionWithHistory(session.id);
  return;
 }
 resumeSessionInTerminal(session);
}
