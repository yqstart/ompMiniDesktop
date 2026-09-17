import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";

/** 添加项目的结果：`null` = 用户取消选择；`ok:false` 由调用方决定提示位置。 */
export type AddProjectResult = { ok: true } | { ok: false; message: string } | null;

/**
 * 「添加项目」的唯一实现：选目录 → 写覆盖层 → 刷新项目列表。
 *
 * 左栏顶部主入口与终端空态的引导共用同一份逻辑，避免两处漂移；
 * 只写覆盖层 `projects`，不动任何会话文件（真相仍在 omp 的 sessions 目录）。
 * 工作区树由调用方按需 `loadWorkspaces()` 刷新。
 */
export async function pickAndAddProject(): Promise<AddProjectResult> {
 try {
  const dir = await open({ directory: true });
  if (typeof dir !== "string" || !dir) return null;
  await api.addProject(dir);
  const projects = await api.listProjects();
  useApp.getState().set({ projects });
  return { ok: true };
 } catch (e) {
  return { ok: false, message: e instanceof Error ? e.message : TEXT[useApp.getState().locale].addProjectFailed };
 }
}
