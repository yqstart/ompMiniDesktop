import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { openSessionWithHistory } from "./sessionOpen";
import { loadSessions } from "./sessionList";

/** 添加项目的结果：`null` = 用户取消选择；`ok:false` 由调用方决定提示位置。 */
export type AddProjectResult = { ok: true } | { ok: false; message: string } | null;

/**
 * 「添加项目」的唯一实现：选目录 → 写覆盖层 → 刷新项目列表并选中新项目。
 *
 * 左上角主入口与中央空态「选择目录」共用同一份逻辑，避免两处漂移；
 * 只写覆盖层 `projects`，不动任何会话文件（真相仍在 omp 的 sessions 目录）。
 */
export async function pickAndAddProject(): Promise<AddProjectResult> {
  try {
    const dir = await open({ directory: true });
    if (typeof dir !== "string" || !dir) return null;
    const project = await api.addProject(dir);
    const projects = await api.listProjects();
    useApp.getState().set({ projects, activeProjectId: project.id });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "添加项目失败" };
  }
}

/**
 * 切换项目上下文（左栏分组头 + 输入框上方项目下拉共用）：
 * 切 `activeProjectId` → 刷新项目与会话列表（终端里同 cwd 新建的会话立刻归属进来）。
 *
 * `openRecent`（输入框上方项目下拉用）= 顺带打开该项目最近一个会话，没有就回空态。
 * 必须这样收口：输入框上方显示的项目，就是消息真正发去的项目——否则用户以为在 A
 * 项目里说话，实际发进了 B 项目的会话。
 */
export async function switchProject(
  projectId: string,
  opts: { openRecent?: boolean } = {},
): Promise<void> {
  const st = useApp.getState();
  st.set({ activeProjectId: projectId });
  const [projects] = await Promise.all([api.listProjects().catch(() => null), loadSessions()]);
  if (projects) st.set({ projects });
  if (!opts.openRecent) return;
  const recent = useApp
    .getState()
    .sessions.filter((s) => s.projectId === projectId && !s.archived)
    .sort((a, b) => b.timestamp - a.timestamp)[0];
  if (recent) await openSessionWithHistory(recent.id);
  else st.set({ activeSessionId: null });
}
