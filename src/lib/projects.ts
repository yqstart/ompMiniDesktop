import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";
import { createSessionIn } from "./sessionOpen";
import { loadSessions } from "./sessionList";

/** 添加项目的结果：`null` = 用户取消选择；`ok:false` 由调用方决定提示位置。 */
export type AddProjectResult = { ok: true } | { ok: false; message: string } | null;

/** 切换项目的结果：`newSession` 分支的新建失败会把文案带回来，由调用方决定显示位置。 */
export type SwitchProjectResult = { ok: true } | { ok: false; message: string };

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
  return { ok: false, message: e instanceof Error ? e.message : TEXT[useApp.getState().locale].addProjectFailed };
 }
}

/**
 * 切换项目上下文（左栏分组头 + 输入框上方项目下拉共用）：
 * 切 `activeProjectId` → 刷新项目与会话列表（终端里同 cwd 新建的会话立刻归属进来）。
 *
 * `newSession`（输入框上方项目下拉用）= **在该项目下新建一个对话**再切过去：
 * 切换的语义是「接下来在这个项目里干活」，不该把该项目里上一个对话的上下文带进来。
 * 两条路径都必须收口到同一件事：输入框上方显示的项目，就是消息真正发去的项目——
 * 否则用户以为在 A 项目里说话，实际发进了 B 项目的会话。
 */
export async function switchProject(
 projectId: string,
 opts: { newSession?: boolean; projectName?: string } = {},
): Promise<SwitchProjectResult> {
 if (opts.newSession) return createSessionIn(projectId, { projectName: opts.projectName });
 const st = useApp.getState();
 st.set({ activeProjectId: projectId });
 const [projects] = await Promise.all([api.listProjects().catch(() => null), loadSessions()]);
 if (projects) st.set({ projects });
 return { ok: true };
}
