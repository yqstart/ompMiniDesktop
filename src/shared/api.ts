import { invoke } from "@tauri-apps/api/core";
import type { OmpInfo } from "./types";

/**
 * 前端调用 Tauri commands 的唯一入口。
 * 命令名与 `src-tauri` 注册名保持一致；失败统一抛 Error(message)。
 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export const api = {
  locateOmp: () => call<OmpInfo>("locate_omp"),
  getHealth: () => call<import("./types").HealthInfo>("get_health"),
  getModels: () => call<import("./types").ModelCatalog>("get_models"),
  refreshModels: () => call<import("./types").ModelCatalog>("refresh_models"),
  getOverlay: () => call<import("./types").Overlay>("get_overlay"),
  listProjects: () => call<import("./types").ProjectView[]>("list_projects"),
  addProject: (path: string) => call<import("./types").ProjectView>("add_project", { path }),
  removeProject: (id: string) => call<void>("remove_project", { id }),
  relocateProject: (id: string, path: string) =>
    call<import("./types").ProjectView>("relocate_project", { id, path }),
  listSessions: (projectId?: string) =>
    call<import("./types").SessionView[]>("list_sessions", { projectId }),
  createSession: (projectId: string) =>
    call<import("./types").SessionView>("create_session", { projectId }),
  openSession: (id: string) => call<import("./types").SessionView>("open_session", { id }),
  archiveSession: (id: string) => call<void>("archive_session", { id }),
  unarchiveSession: (id: string) => call<void>("unarchive_session", { id }),
  deleteSession: (id: string) => call<void>("delete_session", { id }),
  archiveSessions: (ids: string[]) =>
    call<{ ok: number; failed: { id: string; message: string }[] }>("archive_sessions", { ids }),
  deleteSessions: (ids: string[]) =>
    call<{ ok: number; failed: { id: string; message: string }[] }>("delete_sessions", { ids }),
  renameSessionNote: (id: string, note: string) =>
    call<void>("rename_session_note", { id, note }),
  getHistory: (id: string) => call<import("./types").ViewMsg[]>("get_history", { id }),
  sendMessage: (id: string, message: string) =>
    call<void>("send_message", { id, message }),
  stop: (id: string) => call<void>("stop_session", { id }),
  approve: (id: string, uiId: string, decision: "once" | "always" | "deny") =>
    call<void>("approve", { id, uiId, decision }),
  setModel: (id: string, provider: string, modelId: string) =>
    call<void>("set_model", { id, provider, modelId }),
  setThinking: (id: string, level: string) =>
    call<void>("set_thinking", { id, level }),
  getGlobalApproval: () => call<string>("get_global_approval"),
  setGlobalApproval: (mode: string) => call<void>("set_global_approval", { mode }),
  setSessionApproval: (id: string, mode: string | null) =>
    call<void>("set_session_approval", { id, mode }),
  setOmpPath: (path: string | null) => call<OmpInfo>("set_omp_path", { path }),
};
