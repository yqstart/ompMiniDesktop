import { api } from "@shared/api";
import type { CheckoutView } from "@shared/types";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";
import { createChatIn, openSessionWithHistory, type SessionHint } from "./sessionOpen";

/**
 * 目录行（项目主目录 / git worktree；V21 前叫「工作区行」）的前端逻辑：
 * 取数（`loadCheckouts` 是唯一刷新入口）、显示名，以及 `⌘T` 新建聊天的目标选择。
 */

/** 目录行显示名：`项目名 · 分支`（detached 用「游离」）；分支未知时只留项目名。 */
export function checkoutLabel(ws: CheckoutView): string {
 const where = ws.branch ?? (ws.head ? TEXT[useApp.getState().locale].wsDetached : null);
 return where ? `${ws.projectName} · ${where}` : ws.projectName;
}

/** 拉取目录行 + 工作区清单并落库（唯一刷新入口；项目 / 工作区增删后经 `refreshSidebar` 走到这里）。 */
export async function loadCheckouts(): Promise<CheckoutView[]> {
 const [list, groups] = await Promise.all([api.listCheckouts(), api.listWorkspaces()]);
 useApp.getState().set({ checkouts: list, workspaceGroups: groups });
 return list;
}

/** 左栏刷新：项目列表 + 工作区 / 目录行清单（项目增删 / 重定位 / 移除 / 工作区编辑后都回这里）。
 *
 * 失败不回滚已落库的那一半，把消息合并带回给调用方决定显示位置。 */
export async function refreshSidebar(): Promise<{ ok: boolean; message: string | null }> {
 const [projects, checkouts] = await Promise.all([
  api.listProjects().then((list) => ({ ok: true as const, list })).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })),
  loadCheckouts().then((list) => ({ ok: true as const, list })).catch((e: unknown) => ({ ok: false as const, message: e instanceof Error ? e.message : String(e) })),
 ]);
 if (projects.ok) useApp.getState().set({ projects: projects.list });
 const failed: string[] = [];
 if (!projects.ok) failed.push(projects.message);
 if (!checkouts.ok) failed.push(checkouts.message);
 return failed.length === 0 ? { ok: true, message: null } : { ok: false, message: failed.join("；") };
}

/** `⌘T` 的执行侧：该目录已有运行中的聊天 → 聚焦它；当前聊天就在该目录 → 留着；
 *  否则在该目录新建一个（懒写盘，空转无副作用）。 */
export function openChatForCheckout(ws: CheckoutView): void {
 const s = useApp.getState();
 const running = s.sessions.filter((x) => x.cwd === ws.path && x.running && !x.archived).pop();
 if (running) {
  void openSessionWithHistory(running.id, running);
  return;
 }
 if (s.activeSessionId) {
  // 该目录已有当前打开的聊天（可能已不是 running——刚建好还没跑过）→ 直接留着
  const cur = s.sessions.find((x) => x.id === s.activeSessionId);
  if (cur && cur.cwd === ws.path) return;
 }
 void createChatIn(ws.path, { projectName: ws.projectName });
}

/** `⌘T`：新建聊天（目标 = 第一个可用的项目主目录；见 `resolveNewChatCheckout`）。 */
export function newChatInDefaultCheckout(): CheckoutView | null {
 const s = useApp.getState();
 const ws = resolveNewChatCheckout(s.checkouts);
 if (!ws) return null;
 openChatForCheckout(ws);
 return ws;
}

/** 新建聊天的目标选择（⌘T 与空态共用同一顺序，不各自猜测）：
 *  第一个可用的项目主目录；没有主目录（全是 worktree / 缺失）时退回第一个可用目录。 */
export function resolveNewChatCheckout(checkouts: readonly CheckoutView[]): CheckoutView | null {
 const usable = checkouts.filter((w) => !w.missing);
 return usable.find((w) => w.isMain) ?? usable[0] ?? null;
}

/** 归档恢复的「打开」：进聊天视图（`open_session` 起 / 聚焦长驻 RPC 并拉历史）。
 *  调用方手上的列表行（`SessionHint`）一并带给打开实现：项目 / 标题 / cwd 先落地，
 *  不必等 resume 的 spawn 握手（见 `openSessionWithHistory`）。 */
export function resumeSessionInApp(session: SessionHint): void {
 void openSessionWithHistory(session.id, session);
}
