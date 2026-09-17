import { api } from "@shared/api";
import type { WorkspaceView } from "@shared/types";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";

/**
 * 工作区（项目主目录 / git worktree）的前端逻辑：
 * 取数（`loadWorkspaces` 是唯一入口）、显示名、以及「点击工作区 / 新建终端」的动作收敛。
 */

/** 工作区显示名：`项目名 · 分支`（detached 用「游离」）；分支未知时只留项目名。 */
export function workspaceLabel(ws: WorkspaceView): string {
 const where = ws.branch ?? (ws.head ? TEXT[useApp.getState().locale].wsDetached : null);
 return where ? `${ws.projectName} · ${where}` : ws.projectName;
}

/** 拉取工作区清单并落库；失效的选中项自动退回第一个可用工作区。 */
export async function loadWorkspaces(): Promise<WorkspaceView[]> {
 const list = await api.listWorkspaces();
 const s = useApp.getState();
 const active = s.activeWorkspacePath;
 const activeValid = active != null && list.some((w) => w.path === active && !w.missing);
 s.set({
  workspaces: list,
  ...(activeValid ? {} : { activeWorkspacePath: list.find((w) => !w.missing)?.path ?? null }),
 });
 return list;
}

/** 打开或聚焦某工作区的终端：已有该目录的终端 → 聚焦最近一个；否则新建。 */
export function openOrFocusWorkspace(ws: WorkspaceView): void {
 if (ws.missing) return;
 const s = useApp.getState();
 const existing = s.terminals.filter((t) => t.cwd === ws.path);
 if (existing.length > 0) {
  s.focusTerminal(existing[existing.length - 1].id);
  return;
 }
 s.openTerminal({ projectId: ws.projectId, cwd: ws.path, label: workspaceLabel(ws) });
}

/** `＋` / ⌘T：在当前选中的工作区**新建**终端；没选中时退回第一个可用工作区。 */
export function newTerminalInActiveWorkspace(): WorkspaceView | null {
 const s = useApp.getState();
 const usable = s.workspaces.filter((w) => !w.missing);
 const ws =
  usable.find((w) => w.path === s.activeWorkspacePath) ??
  usable.find((w) => w.isMain) ??
  usable[0] ??
  null;
 if (!ws) return null;
 s.openTerminal({ projectId: ws.projectId, cwd: ws.path, label: workspaceLabel(ws) });
 return ws;
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
