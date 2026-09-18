import { Channel, invoke } from "@tauri-apps/api/core";
import { IPC } from "./ipc";
import type { CommitEvent, FallbackChainsInfo, GitInfo, HealthInfo, MemoryFileContent, MemoryProjectView, ModelCatalog, ModelRolesInfo, ModelsConfigFile, OmpInfo, OmpSetting, Overlay, ProjectView, ProviderLoginStatus, ProviderView, PtyEvent, PtySpawnOpts, SessionPage, SessionView, UsageStats, WorkspaceGitState, WorkspaceView } from "./types";

/**
 * 前端调用 Tauri commands 的唯一入口。
 * 命令名与 `src-tauri` 注册名保持一致；失败统一抛 Error(message)。
 */
async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
 try {
  return await invoke<T>(cmd, args);
 } catch (error) {
  if (error instanceof Error) throw error;
  // Tauri 把 Rust CmdError 序列化为普通对象；先归一，界面才能显示真实诊断而非笼统失败。
  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
   const hint = "hint" in error && typeof error.hint === "string" ? error.hint : "";
   throw Object.assign(new Error(hint ? `${error.message}\n${hint}` : error.message), { cause: error });
  }
  throw Object.assign(new Error(String(error)), { cause: error });
 }
}

export const api = {
 locateOmp: () => call<OmpInfo>(IPC.locateOmp),
 getHealth: () => call<HealthInfo>(IPC.getHealth),
 getModels: () => call<ModelCatalog>(IPC.getModels),
 refreshModels: () => call<ModelCatalog>(IPC.refreshModels),
 getOverlay: () => call<Overlay>(IPC.getOverlay),
 listProjects: () => call<ProjectView[]>(IPC.listProjects),
 addProject: (path: string) => call<ProjectView>(IPC.addProject, { path }),
 removeProject: (id: string) => call<void>(IPC.removeProject, { id }),
 relocateProject: (id: string, path: string) =>
  call<ProjectView>(IPC.relocateProject, { id, path }),
 /** 会话列表（分页）：`limit` 为扫描窗口大小（后端默认 500，夹在 1..=5000）。 */
 listSessions: (projectId?: string, limit?: number) =>
  call<SessionPage>(IPC.listSessions, { projectId, limit }),
 /**
  * 已归档对话清单（设置页「已归档对话」tab）：**不受扫描窗口限制**——
  * 归档是管理面，老到 `list_sessions` 窗口外的归档会话也必须能在这里找到并恢复 / 删除。
  */
 listArchivedSessions: () => call<SessionView[]>(IPC.listArchivedSessions),
 archiveSessions: (ids: string[]) =>
  call<{ ok: number; failed: { id: string; message: string }[] }>(IPC.archiveSessions, { ids }),
 /** 批量取消归档（设置页「恢复」）：与 `archiveSessions` 同结构、同上限（单次 200）。 */
 unarchiveSessions: (ids: string[]) =>
  call<{ ok: number; failed: { id: string; message: string }[] }>(IPC.unarchiveSessions, { ids }),
 deleteSessions: (ids: string[]) =>
  call<{ ok: number; failed: { id: string; message: string }[] }>(IPC.deleteSessions, { ids }),
 getGitInfo: (path: string) => call<GitInfo>(IPC.getGitInfo, { path }),
 setOmpPath: (path: string | null) => call<OmpInfo>(IPC.setOmpPath, { path }),
 /**
  * 工作区（V11 左栏树）：每个项目 = 主目录 + 它全部 git worktree。
  * worktree 真相 = `git worktree list`（手工建的也在）；创建走 `omp worktree add`。
  */
 listWorkspaces: () => call<WorkspaceView[]>(IPC.listWorkspaces),
 /** 确保某分支有可工作的目录：已检出直接复用，否则 `omp worktree add` 新建。 */
 createWorktree: (projectId: string, branch: string, newBranch: boolean) =>
  call<WorkspaceView>(IPC.createWorktree, { projectId, branch, newBranch }),
 /**
  * 工作区「提交并推送」（V14）：底部是 `omp commit`（AI 生成提交信息 + changelog 维护 + push）。
  *
  * 两段式：`startCommitPush` 预检后自己选路（有改动 → 提交；仅有未推送提交 → 推送快路径）；
  * `pushCommits` 是第二段（也用于推送失败后的重试）。输出经 **Channel** 流式直推
  * （`{type:"line"|"phase"|"exit"}`），同 PTY 的口径——高频行流不进事件系统。
  */
 getWorkspaceGitState: (paths: string[]) =>
  call<WorkspaceGitState[]>(IPC.getWorkspaceGitState, { paths }),
 startCommitPush: (cwd: string, onEvent: Channel<CommitEvent>) =>
  call<void>(IPC.startCommitPush, { cwd, onEvent }),
 pushCommits: (cwd: string, onEvent: Channel<CommitEvent>) =>
  call<void>(IPC.pushCommits, { cwd, onEvent }),
 cancelCommitPush: (cwd: string) => call<void>(IPC.cancelCommitPush, { cwd }),
 /**
  * 终端 PTY（V11）：每个终端 = 一个 `omp` TUI 进程跑在 PTY 里。
  * 输出经 **Channel** 直推（高频字节流不走事件系统）；输入 / 尺寸 / 关闭走一次命令。
  */
 ptySpawn: (opts: PtySpawnOpts, onEvent: Channel<PtyEvent>) =>
  call<void>(IPC.ptySpawn, { opts, onEvent }),
 ptyWrite: (id: string, data: string) => call<void>(IPC.ptyWrite, { id, data }),
 ptyResize: (id: string, cols: number, rows: number) =>
  call<void>(IPC.ptyResize, { id, cols, rows }),
 /** 关闭终端：kill 子进程（SIGHUP），读线程 EOF 后自行收尾。 */
 ptyKill: (id: string) => call<void>(IPC.ptyKill, { id }),
 /**
  * 供应商（设置 › 供应商）：omp 的 login / logout / modelRoles 映射。
  * 登录走 `omp auth-broker login` 子进程（不经 RPC），进度经 `omp-provider://login` 全量推送。
  */
 listProviders: () => call<ProviderView[]>(IPC.listProviders),
 getProviderLogin: () => call<ProviderLoginStatus>(IPC.getProviderLogin),
 startProviderLogin: (providerId: string) =>
  call<void>(IPC.startProviderLogin, { providerId }),
 /** 回答上游提问（选端点 / 粘贴 API key…）：一行文本写进登录子进程 stdin。 */
 providerLoginInput: (text: string) => call<void>(IPC.providerLoginInput, { text }),
 cancelProviderLogin: () => call<void>(IPC.cancelProviderLogin),
 /** 登出 = 删除该供应商在 omp 凭证库里的全部凭证（不可撤销，调用方需二次确认）。 */
 logoutProvider: (providerId: string) => call<void>(IPC.logoutProvider, { providerId }),
 getModelRoles: () => call<ModelRolesInfo>(IPC.getModelRoles),
 /** 改一个角色；`selector = null` 删除该角色（未配置 = 按 omp 回退规则解析）。 */
 setModelRole: (role: string, selector: string | null) =>
  call<ModelRolesInfo>(IPC.setModelRole, { role, selector }),
 /**
  * Ctrl+P 快速切换环（omp `cycleOrder`）：条目是角色 id（不是模型 selector），
  * 顺序即 omp 里 Ctrl+P / Shift+Ctrl+P 的轮换顺序；空数组 = 不切换任何模型。
  * 写是整数组覆盖（array 键直接写），返回**回读**的真值。
  */
 getCycleOrder: () => call<string[]>(IPC.getCycleOrder),
 setCycleOrder: (order: string[]) => call<string[]>(IPC.setCycleOrder, { order }),
 /**
  * 失败转移链（设置 › 模型）：omp `retry.fallbackChains` 的读写与两个配套开关
  * （`retry.modelFallback` / `retry.fallbackRevertPolicy`），写的是 omp 全局配置。
  */
 getFallbackChains: () => call<FallbackChainsInfo>(IPC.getFallbackChains),
 /** 改一条链；`fallbacks = null`（或空数组）删除该键。顺序即 omp 的尝试顺序。 */
 setFallbackChain: (key: string, fallbacks: string[] | null) =>
  call<FallbackChainsInfo>(IPC.setFallbackChain, { key, fallbacks }),
 /** 改两个配套开关（`false` 时链完全不生效；回归策略只认两个上游合法值）。 */
 setRetryOptions: (modelFallback: boolean, revertPolicy: string) =>
  call<FallbackChainsInfo>(IPC.setRetryOptions, { modelFallback, revertPolicy }),
 /**
  * 记忆（设置 › 记忆）：omp 项目记忆（`<agentDir>/memories/` 下按 cwd 一目录一份）。
  * 上游没有 `omp memory` CLI，记忆由 omp 自己生成——壳侧只列 / 读 / 删，**从不写**。
  */
 listMemories: () => call<MemoryProjectView[]>(IPC.listMemories),
 /** 读单个记忆文件正文（后端上限 1MB，超出截断并标记 `truncated`）。 */
 readMemoryFile: (dir: string, file: string) =>
  call<MemoryFileContent>(IPC.readMemoryFile, { dir, file }),
 /** 删单个记忆文件（不可撤销；调用方需二次确认）。 */
 deleteMemoryFile: (dir: string, file: string) =>
  call<void>(IPC.deleteMemoryFile, { dir, file }),
 /** 清空一个项目的全部记忆（删整个记忆目录；不可撤销，调用方需二次确认）。 */
 deleteMemoryProject: (dir: string) => call<void>(IPC.deleteMemoryProject, { dir }),
 /**
  * 使用统计（设置 › 使用统计）：扫会话 jsonl 聚合用量（token / 费用 / 工具 / 时段）。
  * `days` = 1 / 7 / 30（null = 全部）；后端有文件数 / 字节 / 墙钟三道预算，
  * 到点即停并把 `truncated` 置 true——**只读**，不写 omp、不写覆盖层。
  */
 getUsageStats: (days: number | null) => call<UsageStats>(IPC.getUsageStats, { days }),
 /**
  * omp 常用设置（设置 › 通用）：白名单键的**批量读**（一次 `omp config list --json`，
  * 不逐键 spawn 进程）+ 单键写 / 恢复默认。写的是 omp **全局层**
  * （`~/.omp/agent/config.yml`，`<cwd>/.omp/config.yml` 的项目覆盖优先于它），
  * 不动覆盖层、不碰凭证库；上游没有的键整个缺席（界面据此显示「没有这个设置」）。
  */
 getOmpSettings: (keys: string[]) => call<OmpSetting[]>(IPC.getOmpSettings, { keys }),
 /** 写一个设置项；返回值是**写入后回读**的真相（omp 静默丢弃写入时界面不该显示假值）。 */
 setOmpSetting: (key: string, value: unknown) => call<OmpSetting>(IPC.setOmpSetting, { key, value }),
 /** 恢复该键的 schema 默认值（`omp config reset`，把默认值写回全局配置）。 */
 resetOmpSetting: (key: string) => call<OmpSetting>(IPC.resetOmpSetting, { key }),
 /**
  * 自定义模型接入（设置 › 供应商）：读 / 写 `<agentDir>/models.yml`
  * ——omp 用户级自定义供应商 / 模型的唯一入口（上游没有 CLI 写入口，写文件是唯一路径）。
  * YAML 的保真编辑在前端做（`lib/customModels.ts`）；后端负责预校验（拿候选文本在临时
  * agentDir 里问一次 omp，坏配置**不落盘**）/ 备份 / 原子写。
  * `expectHash` = 读时的 hash（乐观锁：文件被外部改过时写入被拒）。
  */
 readModelsConfig: () => call<ModelsConfigFile>(IPC.readModelsConfig),
 writeModelsConfig: (text: string, expectHash: string | null) =>
  call<ModelsConfigFile>(IPC.writeModelsConfig, { text, expectHash }),
};
