import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import type { ProjectView } from "@shared/types";
import { useApp } from "../stores/app";
import { TEXT } from "./locale";

/**
 * 添加项目的结果：`null` = 用户取消选择；`ok:false` 由调用方决定提示位置；
 * `ok:true` 带回新建（或已存在的同路径）项目 —— 工作区对话框要拿 id 直接勾为成员。
 */
export type AddProjectResult = { ok: true; project: ProjectView } | { ok: false; message: string } | null;

/**
 * 「添加项目」的唯一实现：选目录 → 写覆盖层 → 刷新项目列表。
 *
 * 左栏顶部主入口、终端空态的引导与工作区对话框的「添加本地目录」共用同一份逻辑，
 * 避免多处漂移；只写覆盖层 `projects`，不动任何会话文件（真相仍在 omp 的 sessions 目录）。
 * 工作区树由调用方按需 `loadCheckouts()`（唯一刷新入口）刷新。
 */
export async function pickAndAddProject(): Promise<AddProjectResult> {
 try {
  const dir = await open({ directory: true });
  if (typeof dir !== "string" || !dir) return null;
  const project = await api.addProject(dir);
  const projects = await api.listProjects();
  useApp.getState().set({ projects });
  return { ok: true, project };
 } catch (e) {
  return { ok: false, message: e instanceof Error ? e.message : TEXT[useApp.getState().locale].addProjectFailed };
 }
}
