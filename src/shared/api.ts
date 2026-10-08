import { Channel, invoke } from "@tauri-apps/api/core";
import { IPC } from "./ipc";
import type { ChangeSet, CheckoutView, CommitEvent, ContextBreakdown, FallbackChainsInfo, GitInfo, HealthInfo, ImageAttachment, MemoryFileContent, MemoryProjectView, ModelCatalog, ModelRolesInfo, ModelsConfigFile, OmpInfo, OmpSetting, OmpSettingsCatalog, OmpUpdateEvent, OmpUpdateStatus, Overlay, PathCheck, PluginDoctorFinding, PluginFeatures, PluginsView, ProjectFiles, ProjectView, ProviderLoginStatus, ProviderUsage, ProviderView, PtyEvent, PtySpawnOpts, SessionPage, SessionRuntime, SessionView, SkillFileContent, SkillsView, TitlePromptLang, TitlePromptOutcome, UsageStats, WorkspaceGitState, WorkspaceView } from "./types";

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
 setOmpPath: (path: string | null) => call<OmpInfo>(IPC.setOmpPath, { path }),
 /**
  * 工作区（V21）：多项目容器（左栏顶层单元）。成员关系在项目侧
  * （`ProjectView.workspaceId`），一个项目最多属于一个工作区。
  */
 listWorkspaces: () => call<WorkspaceView[]>(IPC.listWorkspaces),
 /** 新建工作区：`name` + `projectIds`（成员重设语义同 `updateWorkspace`）。 */
 createWorkspace: (name: string, projectIds: string[]) =>
  call<WorkspaceView>(IPC.createWorkspace, { name, projectIds }),
 /** 一次写全：改名 + 成员重设（被移出的项目回归未分组；不删项目、不动文件）。 */
 updateWorkspace: (id: string, name: string, projectIds: string[]) =>
  call<void>(IPC.updateWorkspace, { id, name, projectIds }),
 /** 删组：成员回归未分组（不删项目、不杀终端）。 */
 deleteWorkspace: (id: string) => call<void>(IPC.deleteWorkspace, { id }),
 /**
  * 左栏拖拽落地（V26）：把一个项目移动到目标工作区（`workspaceId = null` = 未分组）并同步全局顺序。
  * `order` = 拖拽后的**全部项目 id 顺序**（左栏顺序 = 覆盖层 `projects` 的数组顺序）；
  * 返回新顺序的项目清单（前端直接落 store，不必再拉一次 `list_projects`）。
  */
 moveProject: (id: string, workspaceId: string | null, order: string[]) =>
  call<ProjectView[]>(IPC.moveProject, { id, workspaceId, order }),
 /**
  * 目录行（V21 前叫「工作区行」）：每个项目 = 主目录 + 它全部 git worktree（只读展示，
  * 壳侧不创建 / 不删除 worktree）。
  */
 listCheckouts: () => call<CheckoutView[]>(IPC.listCheckouts),
 /**
  * 引用浮层（V22）：批量列项目文件（`git ls-files`；只读、60s 后端缓存）。
  * 每项失败只落 `error` 字段（非 git 目录不拖垮整表）。
  */
 listProjectFiles: (paths: string[]) => call<ProjectFiles[]>(IPC.listProjectFiles, { paths }),

 /**
  * 提交 / 推送（V19）：先取变更集（打开面板），再按轨道发起任务。
  * 输出都经 **Channel** 流式回流（`line` / `delta` / `message` / `phase` / `exit`）。
  */
 getChangeSet: (cwd: string) => call<ChangeSet>(IPC.getChangeSet, { cwd }),
 /** 快速轨第一步：把勾选同步进暂存区 → 一次 `omp -p` 单轮生成提交信息（不提交）。 */
 generateCommitMessage: (
  cwd: string,
  paths: string[],
  language: string | null,
  onEvent: Channel<CommitEvent>,
 ) => call<void>(IPC.generateCommitMessage, { cwd, paths, language, onEvent }),
 /** 快速轨第二步：再同步一次勾选 → `git commit` →（可选）`git push`。 */
 commitSelected: (
  cwd: string,
  paths: string[],
  message: string,
  push: boolean,
  onEvent: Channel<CommitEvent>,
 ) => call<void>(IPC.commitSelected, { cwd, paths, message, push, onEvent }),
 /** 完整轨：`omp commit`（AI 信息 + changelog 维护 + 校验器）；慢但功能全。 */
 startFullCommit: (
  cwd: string,
  paths: string[],
  language: string | null,
  onEvent: Channel<CommitEvent>,
 ) => call<void>(IPC.startFullCommit, { cwd, paths, language, onEvent }),
 /** 推送（有上游直接推；没有上游自动 `-u` 建立跟踪）。 */
 pushWorkspace: (cwd: string, onEvent: Channel<CommitEvent>) =>
  call<void>(IPC.pushWorkspace, { cwd, onEvent }),
 /** 取消运行中的任务（后端杀进程组，落 `canceled` 终态）。 */
 cancelCommitTask: (cwd: string) => call<void>(IPC.cancelCommitTask, { cwd }),
 /**
  * 左栏行徽章的 git 快照（批量；每行一次 `status --porcelain -b`，后端并发 + 超时降级）。
  */
 getWorkspaceGitState: (paths: string[]) =>
  call<WorkspaceGitState[]>(IPC.getWorkspaceGitState, { paths }),
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

 // ---------- 聊天形态（V32 恢复自 V1–V10）：RPC 会话命令面 ----------

 /** 新建聊天会话（按目录开：左栏目录行 / 会话弹窗的「新建」传 checkout 路径）。 */
 createSession: (cwd: string) => call<SessionView>(IPC.createSession, { cwd }),
 /** 打开（或聚焦）聊天会话：已有长驻进程直接返回；否则 `omp --resume` 拉起。 */
 openSession: (id: string) => call<SessionView>(IPC.openSession, { id }),
 /** 会话备注名（覆盖层 notes；显示优先于 omp 原标题）。空串 = 清除备注。 */
 renameSessionNote: (id: string, note: string) => call<void>(IPC.renameSessionNote, { id, note }),
 /**
  * 历史回放（后端上限：5000 行 / 2000 条）。`lines` 是 **jsonl 原始行**
  * （由 `viewMsgsFromJsonlLines` 归一）。`truncated` 为真时前端在流尾注明——
  * 超限绝不静默丢内容。
  */
 getHistory: (id: string) => call<{ lines: unknown[]; truncated: boolean }>(IPC.getHistory, { id }),
 sendMessage: (id: string, message: string, images?: ImageAttachment[]) =>
  call<void>(IPC.sendMessage, { id, message, images }),
 /** 流式中转向（`steer`）：在下一个工具调用边界生效，不砍掉进行中的工作。 */
 steerMessage: (id: string, message: string, images?: ImageAttachment[]) =>
  call<void>(IPC.steerMessage, { id, message, images }),
 /** 流式中排队（`follow_up`）：本轮结束后按序执行。 */
 followUpMessage: (id: string, message: string, images?: ImageAttachment[]) =>
  call<void>(IPC.followUpMessage, { id, message, images }),
 /** `/` 命令：经 prompt 直发（本地命令走 command_output 回来，无 agent turn）。 */
 runSlash: (id: string, command: string) => call<void>(IPC.runSlash, { id, command }),
 /** 上下文压缩：把历史压缩成摘要后继续本会话（满上下文时的接续手段）。 */
 compactSession: (id: string, customInstructions?: string) =>
  call<void>(IPC.compactSession, { id, customInstructions }),
 /** 从某条消息另起分支（探索走偏时的回退手段，不删原分支）。 */
 branchSession: (id: string, entryId: string) => call<SessionView>(IPC.branchSession, { id, entryId }),
 /** 图片附件走「系统文件选择器 → 后端读文件」：WebView 拿不到任意本地路径的内容。 */
 readImageFile: (path: string) => call<ImageAttachment>(IPC.readImageFile, { path }),
 /** 输入框 @提及 的存在性提示（后端只 stat，不读内容、不写任何东西）。 */
 checkPaths: (base: string, paths: string[]) => call<PathCheck[]>(IPC.checkPaths, { base, paths }),
 /** `@` 路径补全（只读目录列举，不读文件内容）。 */
 completePath: (base: string, prefix: string) =>
  call<{ path: string; isDir: boolean }[]>(IPC.completePath, { base, prefix }),
 stop: (id: string) => call<void>(IPC.stopSession, { id }),
 approve: (id: string, uiId: string, decision: "once" | "always" | "deny") =>
  call<void>(IPC.approve, { id, uiId, decision }),
 /**
  * 通用 UI 请求回包（非审批）：`confirm` → `{confirmed}`，`value` → `{value}`，`cancel` → `{cancelled}`。
  * 与 `approve` 分开：审批的「总是允许」还要写会话级 yolo 意向，语义不同。
  */
 respondUi: (
  id: string,
  uiId: string,
  kind: "value" | "confirm" | "cancel",
  opts?: { value?: string; confirmed?: boolean },
 ) => call<void>(IPC.respondUi, { id, uiId, kind, value: opts?.value, confirmed: opts?.confirmed }),
 setModel: (id: string, provider: string, modelId: string) =>
  call<void>(IPC.setModel, { id, provider, modelId }),
 setThinking: (id: string, level: string) => call<void>(IPC.setThinking, { id, level }),
 getSessionRuntime: (id: string) => call<SessionRuntime | null>(IPC.getSessionRuntime, { id }),
 /**
  * 上下文分项（输入框工具行的「上下文容量」面板）：已用 / 窗口 / 非消息是 omp 真值，
  * 非消息各档按字符量估算后缩放到真值。**只读**——不启动进程、不写任何东西。
  */
 getContextBreakdown: (id: string) => call<ContextBreakdown>(IPC.getContextBreakdown, { id }),
 getGitInfo: (path: string) => call<GitInfo>(IPC.getGitInfo, { path }),
 getGlobalApproval: () => call<string>(IPC.getGlobalApproval),
 setGlobalApproval: (mode: string) => call<void>(IPC.setGlobalApproval, { mode }),
 setSessionApproval: (id: string, mode: string | null) =>
  call<void>(IPC.setSessionApproval, { id, mode }),

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
  * 供应商用量（设置 › 供应商用量）：跑 `omp usage --json` 取各已登录供应商的
  * 滚动窗口用量（5 小时 / 每周 / 每月）——上游只有 omp 自己拿得到这些数据；
  * 壳侧只解析、不直连任何配额 API、不碰凭证库。**只读**（不动 omp 缓存）。
  */
 getProviderUsage: () => call<ProviderUsage>(IPC.getProviderUsage),
 /**
  * omp 设置目录（设置 ›「常用设置」）：上游 `omp config list` 的完整目录——文本 + JSON 两路
  * 合并（文本给分组与枚举取值表，JSON 给类型化值与说明）。**只读**；页面按壳侧展示清单
  * （`lib/settingsList.ts`）过滤显示；写入走下面的
  * `setOmpSetting` / `resetOmpSetting`（omp 全局层：`~/.omp/agent/config.yml`，
  * `<cwd>/.omp/config.yml` 的项目覆盖优先于它；不碰覆盖层与凭证库）。
  */
 getOmpSettingsCatalog: () => call<OmpSettingsCatalog>(IPC.getOmpSettingsCatalog),
 /** 写一个设置项；返回值是**写入后回读**的真相（omp 静默丢弃写入时界面不该显示假值）。 */
 setOmpSetting: (key: string, value: unknown) => call<OmpSetting>(IPC.setOmpSetting, { key, value }),
 /** 恢复该键的 schema 默认值（`omp config reset`，把默认值写回全局配置）。 */
 resetOmpSetting: (key: string) => call<OmpSetting>(IPC.resetOmpSetting, { key }),
 /**
  * 本机 omp 的主题列表（「常用设置」的深色 / 浅色主题下拉用；**只读**）。
  * 与 omp TUI 的 `availableThemes` 同口径：内置注册表（本机 18.4.4 = 102 个）∪
  * `<agentDir>/themes/*.json`（去后缀），排序；目录不存在 = 只有内置。
  */
 listOmpThemes: () => call<string[]>(IPC.listOmpThemes),
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
 /**
  * 插件（设置 ›「插件」）：omp 的插件管理（`omp plugin`）。
  *
  * `cwd` = 这次读取 / 操作钉的工作目录：**项目级可见范围**由它决定（项目 package.json 里装的
  * 插件、项目级市场插件都按 cwd 解析）；缺省 = 用户级视图（钉 agentDir）。
  */
 listPlugins: (cwd?: string | null) => call<PluginsView>(IPC.listPlugins, { cwd }),
 /** 启用 / 禁用（npm / link 插件不给 scope；市场插件同 id 双份时必须给对应的那份）。 */
 setPluginEnabled: (name: string, enabled: boolean, scope?: string | null, cwd?: string | null) =>
  call<PluginsView>(IPC.setPluginEnabled, { name, enabled, scope: scope ?? null, cwd: cwd ?? null }),
 /**
  * 写一个插件的特性集合（**整组覆盖**）。上游 `enabledFeatures` 为 `null` 时按每个特性的
  * `default` 生效——传「当前生效的集合」即可保持语义；一旦写过就是显式列表（不再回落默认）。
  *
  * 注意层级：特性状态存在**用户插件目录**的运行态登记里，与「可见范围 cwd」无关（项目级只影响
  * 市场插件的发现位置），所以这个命令不接受 cwd。
  */
 setPluginFeatures: (plugin: string, features: string[]) =>
  call<PluginFeatures>(IPC.setPluginFeatures, { plugin, features }),
 /**
  * 安装一个插件（源 = npm 包 / git 仓库 / 本地目录 / `名字@市场名`）。
  * 壳侧不提供「预览」：上游 `--dry-run` 对市场条目**会照装**（文档明说不适用），
  * 界面上用信任提示 + 二次确认替代。
  */
 installPlugin: (source: string, scope?: string | null, cwd?: string | null) =>
  call<PluginsView>(IPC.installPlugin, { source, scope: scope ?? null, cwd: cwd ?? null }),
 /** 卸载一个插件（市场插件双份时用 `scope` 指定那一份）。 */
 uninstallPlugin: (id: string, scope?: string | null, cwd?: string | null) =>
  call<PluginsView>(IPC.uninstallPlugin, { id, scope: scope ?? null, cwd: cwd ?? null }),
 /** 插件体检（`fix` = 让上游尝试修复；只读检查不写任何东西）。 */
 pluginDoctor: (fix: boolean) => call<PluginDoctorFinding[]>(IPC.pluginDoctor, { fix }),
 /**
  * 技能（设置 ›「技能」）：omp 的技能发现结果 + 逐项启停。
  *
  * `cwd` = 发现范围（项目目录；缺省 = 家目录 = 只看用户级技能）。项目级技能来自
  * `.omp/skills` 等目录、由 omp 从该目录向上走到仓库根逐级发现。
  */
 listSkills: (cwd?: string | null) => call<SkillsView>(IPC.listSkills, { cwd }),
 /**
  * 启用 / 停用一项技能：写 omp 全局配置的 `disabledExtensions`（加 / 删 `skill:<名字>`，**按名字全局生效**）。
  * 返回**回读后**的停用技能名——停用后上游不再列出该技能，界面靠这份名单画「已停用」行。
  */
 setSkillEnabled: (name: string, enabled: boolean) =>
  call<string[]>(IPC.setSkillEnabled, { name, enabled }),
 /** 读一个 `SKILL.md` 的正文（只允许 `SKILL.md`，超上限截断）。 */
 readSkillFile: (path: string) => call<SkillFileContent>(IPC.readSkillFile, { path }),
 /**
  * 会话标题语言（V18）：把壳的界面语言同步成 omp 的 `<agentDir>/TITLE_SYSTEM.md`
  * （标题生成 prompt）——上游没有 CLI / 设置项改标题 prompt，写该文件是唯一路径。
  * `lang` 只有 `"zh"` / `"en"` 两档；用户自写的同名文件后端不碰（回 `skipped`）。
  */
 syncTitlePrompt: (lang: TitlePromptLang) =>
  call<TitlePromptOutcome>(IPC.syncTitlePrompt, { lang }),
 /**
  * omp 运行时更新检查（左栏字标行的版本 chip）：跑一次 `omp update --check`
  * ——上游只检查不安装（结论 = 当前版本 / 新版本号 / 渠道）。失败抛 Error（原因 = 上游 stderr）。
  */
 checkOmpUpdate: () => call<OmpUpdateStatus>(IPC.checkOmpUpdate),
 /**
  * 执行更新（真安装）：`omp update`——上游自己识别安装方式（brew / npm / bun / 独立二进制）
  * 再选路。**命令立刻返回**，过程与终局走 Channel（`line` 流式日志 + `exit` 终局）；
  * 同一时刻只允许一个更新（后端返回 BUSY）。
  */
 startOmpUpdate: (onEvent: Channel<OmpUpdateEvent>) => call<void>(IPC.startOmpUpdate, { onEvent }),
 /** 取消进行中的更新（杀进程组；终局经 Channel 的 `exit` 到达，phase = canceled）。 */
 cancelOmpUpdate: () => call<void>(IPC.cancelOmpUpdate),
};
