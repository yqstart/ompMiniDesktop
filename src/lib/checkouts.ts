import { api } from "@shared/api";
import type { CheckoutView, SessionView } from "@shared/types";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";
import { createChatIn, isDefaultTitle, openSessionWithHistory, type SessionHint } from "./sessionOpen";

/**
 * 目录行（项目主目录 / git worktree；V21 前叫「工作区行」）的前端逻辑：
 * 取数（`loadCheckouts` 是唯一刷新入口）、显示名，以及新建会话（左栏主命令 / `⌘T`）的实现。
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

/** 新建会话的结果：失败文案由调用方显示（左栏内联错误条 / ⌘T 的同一处），不静默丢弃。 */
export type NewChatResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * 新建会话（左栏主命令与 `⌘T` 的唯一实现）。
 *
 * - **目标目录 = 当前会话所在的目录**（「在这里再开一个」才是这句话的本意），没有当前会话时
 *   退回第一个可用项目主目录（`resolveNewChatCheckout`，空态语义）；
 * - 当前会话本身就是该目录里的**空会话**（没消息、标题还是默认值、没在跑、草稿也空）时直接
 *   留着它——那就是一个新会话，不必再叠第二个空的（懒写盘：没发过消息的会话不落盘）；
 * - 其余情况**一律新建**。旧实现把「该目录里已有一个会话」当成「切过去」，于是最常用的状态
 *   （用户正坐在该项目的会话里）点新建没有任何反应，看起来就是「新建会话坏了」；
 * - 没有可用目录 / 创建失败都把文案带回去，由调用方显示。
 */
export async function newChatInDefaultCheckout(): Promise<NewChatResult> {
 const st = useApp.getState();
 const cur = st.sessions.find((x) => x.id === st.activeSessionId) ?? null;
 if (cur && isEmptyDraft(cur)) return { ok: true, id: cur.id };
 const dir = cur?.cwd ?? resolveNewChatCheckout(st.checkouts)?.path ?? null;
 if (!dir) return { ok: false, message: TEXT[st.locale].newChatNoProject };
 return createChatIn(dir, { projectName: st.projects.find((p) => p.path === dir)?.name });
}

/** 空会话（新建之后还没发过任何消息、也没改名）：复用它可以，不必再开一个同样空的。 */
function isEmptyDraft(s: SessionView): boolean {
 const st = useApp.getState();
 if (s.running) return false;
 if (st.drafts[s.id]?.trim()) return false;
 if (!isDefaultTitle(s.title)) return false;
 return (st.eventsBySession[s.id]?.length ?? 0) === 0;
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
