import { invoke } from "@tauri-apps/api/core";
import type { ContextBreakdown, GitInfo, HealthInfo, ImageAttachment, MemoryFileContent, MemoryProjectView, ModelCatalog, ModelRolesInfo, OmpInfo, Overlay, PathCheck, ProjectView, ProviderLoginStatus, ProviderUsage, ProviderView, SessionPage, SessionRuntime, SessionSearchResult, SessionView, UsageStats, ViewMsg } from "./types";

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
 /**
  * 已归档对话清单（设置页「已归档对话」tab）：**不受扫描窗口限制**——
  * 归档是管理面，老到 `list_sessions` 窗口外的归档会话也必须能在这里找到并恢复 / 删除。
  */
 listArchivedSessions: () => call<SessionView[]>("list_archived_sessions"),
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
 /** 批量取消归档（设置页「恢复」）：与 `archiveSessions` 同结构、同上限（单次 200）。 */
 unarchiveSessions: (ids: string[]) =>
  call<{ ok: number; failed: { id: string; message: string }[] }>("unarchive_sessions", { ids }),
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
 /**
  * 上下文分项（输入框工具行的「上下文容量」面板）：已用 / 窗口 / 非消息是 omp 真值，
  * 非消息各档按字符量估算后缩放到真值。**只读**——不启动进程、不写任何东西。
  */
 getContextBreakdown: (id: string) => call<ContextBreakdown>("get_context_breakdown", { id }),
 getGitInfo: (path: string) => call<GitInfo>("get_git_info", { path }),
 getGlobalApproval: () => call<string>("get_global_approval"),
 setGlobalApproval: (mode: string) => call<void>("set_global_approval", { mode }),
 setSessionApproval: (id: string, mode: string | null) =>
  call<void>("set_session_approval", { id, mode }),
 setOmpPath: (path: string | null) => call<OmpInfo>("set_omp_path", { path }),
 /**
  * 供应商（设置 › 供应商）：omp 的 login / logout / modelRoles 映射。
  * 登录走 `omp auth-broker login` 子进程（不经 RPC——RPC 模式在「一个都没登录」的
  * 环境里起不来），进度经 `omp-provider://login` 全量推送。
  */
 listProviders: () => call<ProviderView[]>("list_providers"),
 getProviderLogin: () => call<ProviderLoginStatus>("get_provider_login"),
 startProviderLogin: (providerId: string) =>
  call<void>("start_provider_login", { providerId }),
 /** 回答上游提问（选端点 / 粘贴 API key…）：一行文本写进登录子进程 stdin。 */
 providerLoginInput: (text: string) => call<void>("provider_login_input", { text }),
 cancelProviderLogin: () => call<void>("cancel_provider_login"),
 /** 登出 = 删除该供应商在 omp 凭证库里的全部凭证（不可撤销，调用方需二次确认）。 */
 logoutProvider: (providerId: string) => call<void>("logout_provider", { providerId }),
 getModelRoles: () => call<ModelRolesInfo>("get_model_roles"),
 /** 改一个角色；`selector = null` 删除该角色（未配置 = 按 omp 回退规则解析）。 */
 setModelRole: (role: string, selector: string | null) =>
  call<ModelRolesInfo>("set_model_role", { role, selector }),
 /**
  * 记忆（设置 › 记忆）：omp 项目记忆（`<agentDir>/memories/` 下按 cwd 一目录一份）。
  * 上游没有 `omp memory` CLI，记忆由 omp 自己生成——壳侧只列 / 读 / 删，**从不写**。
  */
 listMemories: () => call<MemoryProjectView[]>("list_memories"),
 /** 读单个记忆文件正文（后端上限 1MB，超出截断并标记 `truncated`）。 */
 readMemoryFile: (dir: string, file: string) =>
  call<MemoryFileContent>("read_memory_file", { dir, file }),
 /** 删单个记忆文件（不可撤销；调用方需二次确认）。 */
 deleteMemoryFile: (dir: string, file: string) =>
  call<void>("delete_memory_file", { dir, file }),
 /** 清空一个项目的全部记忆（删整个记忆目录；不可撤销，调用方需二次确认）。 */
 deleteMemoryProject: (dir: string) => call<void>("delete_memory_project", { dir }),
 /**
  * 使用统计（设置 › 使用统计）：扫会话 jsonl 聚合用量（token / 费用 / 工具 / 时段）。
  * `days` = 1 / 7 / 30（null = 全部）；后端有文件数 / 字节 / 墙钟三道预算，
  * 到点即停并把 `truncated` 置 true——**只读**，不写 omp、不写覆盖层。
  */
 getUsageStats: (days: number | null) => call<UsageStats>("get_usage_stats", { days }),
 /**
  * 供应商配额（输入框上方「用量限额」入口）：omp 能报的各供应商限额窗口（5 小时 / 每周 / 每月）。
  * 壳侧只跑并解析 `omp usage --json`——**只读**（不调 `invalidate`，那会改 omp 缓存），
  * 不直连任何配额 API、不读 omp 凭证库；`reports` 为空 = 没有可显示的配额（不是错误）。
  */
 getProviderUsage: () => call<ProviderUsage>("get_provider_usage"),
};
