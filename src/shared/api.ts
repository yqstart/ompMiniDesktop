import { invoke } from "@tauri-apps/api/core";
import type { GitInfo, HealthInfo, ImageAttachment, ModelCatalog, OmpInfo, Overlay, PathCheck, ProjectView, SessionPage, SessionRuntime, SessionSearchResult, SessionView, ViewMsg } from "./types";

/**
 * 前端调用 Tauri commands 的唯一入口。
 * 命令名与 `src-tauri` 注册名保持一致；失败统一抛 Error(message)。
 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export const api = {
  locateOmp: () => call<OmpInfo>("locate_omp"),
  getHealth: () => call<HealthInfo>("get_health"),
  getModels: () => call<ModelCatalog>("get_models"),
  refreshModels: () => call<ModelCatalog>("refresh_models"),
  getOverlay: () => call<Overlay>("get_overlay"),
  listProjects: () => call<ProjectView[]>("list_projects"),
  addProject: (path: string) => call<ProjectView>("add_project", { path }),
  removeProject: (id: string) => call<void>("remove_project", { id }),
  relocateProject: (id: string, path: string) =>
    call<ProjectView>("relocate_project", { id, path }),
  /** 会话列表（分页）：`limit` 为扫描窗口大小（后端默认 500，夹在 1..=5000）。 */
  listSessions: (projectId?: string, limit?: number) =>
    call<SessionPage>("list_sessions", { projectId, limit }),
  /** 会话内容搜索（只搜 user/assistant 正文；后端有文件数/字节/时间预算）。 */
  searchSessions: (query: string) =>
    call<SessionSearchResult>("search_sessions", { query }),
  createSession: (projectId: string) =>
    call<SessionView>("create_session", { projectId }),
  openSession: (id: string) => call<SessionView>("open_session", { id }),
  archiveSession: (id: string) => call<void>("archive_session", { id }),
  unarchiveSession: (id: string) => call<void>("unarchive_session", { id }),
  deleteSession: (id: string) => call<void>("delete_session", { id }),
  archiveSessions: (ids: string[]) =>
    call<{ ok: number; failed: { id: string; message: string }[] }>("archive_sessions", { ids }),
  deleteSessions: (ids: string[]) =>
    call<{ ok: number; failed: { id: string; message: string }[] }>("delete_sessions", { ids }),
  renameSessionNote: (id: string, note: string) =>
    call<void>("rename_session_note", { id, note }),
  getHistory: (id: string) => call<ViewMsg[]>("get_history", { id }),
  sendMessage: (id: string, message: string, images?: ImageAttachment[]) =>
    call<void>("send_message", { id, message, images }),
  /** 流式中转向（`steer`）：在下一个工具调用边界生效，不砍掉进行中的工作。 */
  steerMessage: (id: string, message: string, images?: ImageAttachment[]) =>
    call<void>("steer_message", { id, message, images }),
  /** 流式中排队（`follow_up`）：本轮结束后按序执行。 */
  followUpMessage: (id: string, message: string, images?: ImageAttachment[]) =>
    call<void>("follow_up_message", { id, message, images }),
  /** 上下文压缩：把历史压缩成摘要后继续本会话（满上下文时的接续手段）。 */
  compactSession: (id: string, customInstructions?: string) =>
    call<void>("compact_session", { id, customInstructions }),
  /** 从某条消息另起分支（探索走偏时的回退手段，不删原分支）。 */
  branchSession: (id: string, entryId: string) =>
    call<SessionView>("branch_session", { id, entryId }),
  /** `/` 命令：经 prompt 直发（本地命令走 command_output 回来，无 agent turn）。 */
  runSlash: (id: string, command: string) => call<void>("run_slash", { id, command }),
  /** 图片附件走「系统文件选择器 → 后端读文件」：WebView 拿不到任意本地路径的内容。 */
  readImageFile: (path: string) => call<ImageAttachment>("read_image_file", { path }),
  /** 输入框 @提及 的存在性提示（后端只 stat，不读内容、不写任何东西）。 */
  checkPaths: (base: string, paths: string[]) => call<PathCheck[]>("check_paths", { base, paths }),
  stop: (id: string) => call<void>("stop_session", { id }),
  /** `@` 路径补全（只读目录列举，不读文件内容）。 */
  completePath: (base: string, prefix: string) =>
    call<{ path: string; isDir: boolean }[]>("complete_path", { base, prefix }),
  approve: (id: string, uiId: string, decision: "once" | "always" | "deny") =>
    call<void>("approve", { id, uiId, decision }),
  /**
   * 通用 UI 请求回包（非审批）：`confirm` → `{confirmed}`，`value` → `{value}`，`cancel` → `{cancelled}`。
   * 与 `approve` 分开：审批的「总是允许」还要写会话级 yolo 意向，语义不同。
   */
  respondUi: (
    id: string,
    uiId: string,
    kind: "value" | "confirm" | "cancel",
    opts?: { value?: string; confirmed?: boolean },
  ) => call<void>("respond_ui", { id, uiId, kind, value: opts?.value, confirmed: opts?.confirmed }),
  setModel: (id: string, provider: string, modelId: string) =>
    call<void>("set_model", { id, provider, modelId }),
  setThinking: (id: string, level: string) =>
    call<void>("set_thinking", { id, level }),
  getSessionRuntime: (id: string) =>
    call<SessionRuntime | null>("get_session_runtime", { id }),
  getGitInfo: (path: string) => call<GitInfo>("get_git_info", { path }),
  getGlobalApproval: () => call<string>("get_global_approval"),
  setGlobalApproval: (mode: string) => call<void>("set_global_approval", { mode }),
  setSessionApproval: (id: string, mode: string | null) =>
    call<void>("set_session_approval", { id, mode }),
  setOmpPath: (path: string | null) => call<OmpInfo>("set_omp_path", { path }),
};
