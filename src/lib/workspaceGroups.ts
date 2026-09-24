import type { CheckoutView, ProjectView, SidebarSelection, WorkspaceView } from "@shared/types";
import { TEXT, fmt, type Locale } from "./locale";

/**
 * 工作区（V21 多项目容器）的前端逻辑：**范围计算**与**协作上下文构造**。
 *
 * 全部是纯函数（不读 store、不发 IPC），单测锁着——左栏 / 标签栏 / 面板 / 终端 spawn
 * 都从这里取同一份口径，不各自猜「这个终端算不算在当前视图里」「这个会话该挂哪些根」。
 */

/** 协作生效门槛：工作区成员项目 ≥ 2（单成员组 / 未分组与 V20 行为一致，不加参数）。 */
export const COLLAB_MIN_MEMBERS = 2;

/** 选中项覆盖的目录集合（右栏视图范围）；null = 不过滤。
 *
 * - `checkout`：该目录；
 * - `group(id)`：组内全部项目的全部目录（主目录 + worktree）；`id: null` = 未分组区；
 * - 选中的工作区已不存在（刚被删、刷新还没回来）：返回 null（不过滤），
 *   真正的收敛由 `loadCheckouts` 负责——这里只做防御，不让视图莫名空白。
 */
export function selectionScopePaths(
 selection: SidebarSelection | null,
 workspaces: readonly WorkspaceView[],
 checkouts: readonly CheckoutView[],
 projects: readonly ProjectView[],
): Set<string> | null {
 if (selection === null) return null;
 if (selection.kind === "checkout") return new Set([selection.path]);
 if (selection.id !== null && !workspaces.some((w) => w.id === selection.id)) return null;
 const memberIds = new Set(
  projects.filter((p) => p.workspaceId === selection.id).map((p) => p.id),
 );
 return new Set(checkouts.filter((c) => memberIds.has(c.projectId)).map((c) => c.path));
}

/** cwd 所属的工作区 id（`null` = 未分组 / 未匹配到任何项目）。 */
export function checkoutGroupId(
 cwd: string,
 checkouts: readonly CheckoutView[],
 projects: readonly ProjectView[],
): string | null {
 const projectId = projectIdForPath(cwd, checkouts, projects);
 if (projectId === null) return null;
 return projects.find((p) => p.id === projectId)?.workspaceId ?? null;
}

/** cwd → 项目 id：先按目录行精确匹配，再退回项目主目录前缀（最长优先）。 */
export function projectIdForPath(
 cwd: string,
 checkouts: readonly CheckoutView[],
 projects: readonly ProjectView[],
): string | null {
 const exact = checkouts.find((c) => c.path === cwd);
 if (exact) return exact.projectId;
 let best: string | null = null;
 let bestLen = -1;
 for (const p of projects) {
  const prefix = p.path.endsWith("/") ? p.path : `${p.path}/`;
  if ((cwd === p.path || cwd.startsWith(prefix)) && p.path.length > bestLen) {
   best = p.id;
   bestLen = p.path.length;
  }
 }
 return best;
}

/** 一个终端 spawn 时要挂的工作区上下文（V21 全自动口径）。 */
export type CollabContext = {
 /** 协作根：同工作区其他成员项目的**主目录**（注册顺序；空 = 不加 `--add-dir`）。 */
 addDirs: string[];
 /** 注入会话的工作区拓扑说明（界面语言）；null = 不注入。 */
 note: string | null;
};

/**
 * 全自动协作上下文：cwd 所属项目在某个**多成员工作区**里时，
 * 把其余成员项目的主目录作为协作根，并给会话注入工作区拓扑说明。
 *
 * 只挂**主目录**（不挂 worktree）：worktree 是分支工作态，协作锚点应该是项目本体。
 */
export function collabContextFor(
 cwd: string,
 workspaceGroups: readonly WorkspaceView[],
 checkouts: readonly CheckoutView[],
 projects: readonly ProjectView[],
 locale: Locale,
): CollabContext {
 const projectId = projectIdForPath(cwd, checkouts, projects);
 const project = projectId ? projects.find((p) => p.id === projectId) ?? null : null;
 const wsId = project?.workspaceId ?? null;
 if (!project || wsId === null) return { addDirs: [], note: null };
 const members = projects.filter((p) => p.workspaceId === wsId);
 if (members.length < COLLAB_MIN_MEMBERS) return { addDirs: [], note: null };
 const addDirs = members.filter((m) => m.id !== project.id).map((m) => m.path);
 if (addDirs.length === 0) return { addDirs: [], note: null };
 const name = workspaceGroups.find((w) => w.id === wsId)?.name ?? "";
 return { addDirs, note: buildWorkspaceNote(name, project, members, locale) };
}

/**
 * 注入文本（界面语言）：只陈述事实 + 一句协作约定。
 * 以固定前缀开头（不会被误判成文件路径）；内容在同组成员不变时逐字节稳定 → 不破坏提示缓存。
 */
export function buildWorkspaceNote(
 workspaceName: string,
 primary: ProjectView,
 members: readonly ProjectView[],
 locale: Locale,
): string {
 const t = TEXT[locale];
 const roster = members.map(
  (m) => `- ${m.name}: ${m.path}${m.id === primary.id ? t.wsCtxPrimarySuffix : ""}`,
 );
 return [t.wsCtxHeader, fmt(t.wsCtxIntro, workspaceName), ...roster, "", t.wsCtxBody].join("\n");
}
