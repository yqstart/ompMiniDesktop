/** 前后端共享类型：overlay / 视图 / 终端（V11 已移除 RPC 会话面）。 */

/** 覆盖层里允许的会话级权限档（V1 遗留字段，只为读旧覆盖层时形状完整）。 */
export type ApprovalMode = "always-ask" | "write" | "yolo";

/** 覆盖层与视图共用的小类型集合。 */
export type Project = {
 id: string;
 path: string;
 addedAt: number;
 lastModel: string | null;
 lastThinking: string | null;
};

export type Overlay = {
 version: 1;
 projects: Project[];
 archived: Record<string, boolean>;
 notes: Record<string, string>;
 sessionApproval: Record<string, ApprovalMode>;
 ompPath?: string | null;
};

export type ProjectView = {
 id: string;
 path: string;
 name: string;
 missing: boolean;
 sessionCount: number;
 /** 所属工作区（V21）；null = 未分组。 */
 workspaceId: string | null;
};

export type SessionView = {
 id: string;
 projectId: string | null;
 title: string;
 cwd: string;
 timestamp: number;
 archived: boolean;
 corrupt: boolean;
 note: string | null;
 running: boolean;
};

/**
 * 会话列表分页：`totalFiles` = sessions 目录下 jsonl 总数，
 * `scannedFiles` = 本次真正解析了头部的文件数（窗口外的都是更老的会话，不是不存在）。
 */
export type SessionPage = {
 sessions: SessionView[];
 totalFiles: number;
 scannedFiles: number;
};

export type ModelInfo = {
 provider: string;
 id: string;
 selector: string;
 name: string;
 contextWindow: number | null;
 maxTokens: number | null;
 reasoning: boolean | null;
 thinking: string[] | null;
 input: string[] | null;
};

export type ModelCatalog = {
 models: ModelInfo[];
 fetchedAt: number;
 error?: string;
};

export type OmpInfo = {
 ompPath: string | null;
 ompVersion: string | null;
 agentDir: string;
 errors: string[];
};

export type HealthInfo = {
 omp: OmpInfo;
 modelsError: string | null;
 ok: boolean;
};

/**
 * 供应商（OAuth 可登录的那批）+ 当前是否已有可用凭证。
 * `configured` = 该供应商出现在 omp 模型目录里（有凭证或免钥），
 * 这是壳侧能拿到的最接近「已登录」的真值——不直读 omp 的凭证库。
 */
export type ProviderView = {
 id: string;
 name: string;
 configured: boolean;
};

/**
 * 登录进度快照（事件 `omp-provider://login` 的 payload）：**全量覆盖**，不是增量。
 * `lines` 是上游 `auth-broker login` 输出窗口（尾部若干行），包含进度、
 * `Local shortcut …` 与需要用户回答的提问（如「选端点 / 粘贴 API key」）。
 */
export type ProviderLoginStatus = {
 provider: string;
 running: boolean;
 /** 授权 URL（上游 "Open this URL in your browser:" 之后的第一行）。 */
 url: string | null;
 lines: string[];
 done: { ok: boolean; cancelled: boolean; message: string | null } | null;
};

/**
 * 模型角色表（omp `modelRoles`）+ 保存位置（`modelRoleStorage`）。
 * 角色值是模型 selector（`provider/modelId`，可带 `:思考档` 后缀），与 config.yml 一致。
 */
export type ModelRolesInfo = {
 roles: Record<string, string>;
 /** `global` = 写 `~/.omp/agent/config.yml`；`project` = omp 按项目保存角色。 */
 storage: string;
 /** omp 内置角色 id（上游顺序）；其余键算自定义角色，排在后面。 */
 builtin: string[];
};

/**
 * 失败转移链（omp `retry.fallbackChains`）+ 两个配套开关——模型请求失败时
 * 「由哪个模型接手」的那份配置。
 *
 * 口径（上游 description，omp 18.2.1 实测）：
 * - `chains` 的 key 三种形态，匹配规则全在 omp 里（壳侧只读写，不复制那套规则）：
 *   **角色名**（`default`）、**模型 selector**（`provider/model-id`，该模型活跃时生效、
 *   与角色无关）、**供应商通配**（`provider/*` 保留失败模型的 id 只换供应商；
 *   `openrouter/google/*` 这类 id 前缀通配 omp 也认——界面不做它的候选，手写的照原样显示）；
 * - 值是**有序**备用 selector（omp 按序尝试，顺序是语义的一部分）；
 * - 条目可带 `:档位` 后缀（`low` / `high` / `max` / `off`）；不带则**继承失败轮次的档位**，
 *   `provider/*` 条目总是继承；
 * - 触发时机：限流 / 过载 / 5xx / 网络类错误；**上下文溢出不走这条**（那个走压缩）；
 * - `modelFallback = false` 时链**完全不生效**（omp 的判据）。
 */
export type FallbackChainsInfo = {
 chains: Record<string, string[]>;
 /** `retry.modelFallback`（默认 true）。 */
 modelFallback: boolean;
 /** `retry.fallbackRevertPolicy`：`cooldown-expiry`（默认，冷却结束回主模型）/ `never`。 */
 revertPolicy: string;
};

/**
 * 记忆文件分类（后端按相对路径判定）：长期记忆 / 摘要 / 原始记忆 / 教训 /
 * 会话摘要 / 技能包 / 其他——前端据此显示中文标签。
 */
export type MemoryFileKind = "memory" | "summary" | "raw" | "learned" | "rollout" | "skill" | "other";

/** 一个记忆目录里的文件（`path` 恒为相对路径、`/` 分隔）。 */
export type MemoryFileView = {
 path: string;
 size: number;
 /** 修改时间（毫秒）。 */
 modified: number;
 kind: MemoryFileKind;
};

/**
 * 一个项目的记忆（= `~/.omp/agent/memories/` 下的一个目录）。
 * `path` 为 null = 目录名解不回真实路径（原项目已删 / 改名），此时 `name` 是编码名。
 */
export type MemoryProjectView = {
 /** 记忆目录名（编码名；查看 / 删除都回传它）。 */
 dir: string;
 path: string | null;
 name: string;
 projectId: string | null;
 files: MemoryFileView[];
 totalBytes: number;
 /** 目录内最近一次修改时间（毫秒；0 = 没有可读文件）。 */
 updatedAt: number;
};

/** 单个记忆文件的正文（`truncated` = 超过后端上限被截断）。 */
export type MemoryFileContent = {
 text: string;
 bytes: number;
 truncated: boolean;
 modified: number;
};

/**
 * 使用统计（设置 ›「使用统计」）：omp 会话 jsonl 里 assistant 消息 `usage` 的聚合。
 * 页面只展示三项指标——tokens 用量、Cache 命中率、活跃天数；数字与派生指标
 * （命中率 / 活跃天数 / 连续天数）一律由后端算好，前端只做格式化。
 *
 * 口径要点（`src-tauri/src/usage.rs` 与本类型的注释必须一致）：
 * - `total` = omp 的 `totalTokens` 累加（= `input + output + cacheRead + cacheWrite`），
 *   `input` 是**未缓存**输入；
 * - `calls` 是带 usage 的 assistant 消息条数（= 模型请求数，前端据此判断有无用量）。
 */
export type UsageBucket = {
 input: number;
 output: number;
 cacheRead: number;
 cacheWrite: number;
 total: number;
 calls: number;
};

/** 范围总览（派生指标全部后端算好）。 */
export type UsageTotals = UsageBucket & {
 /** 范围内有请求的天数。 */
 activeDays: number;
 /** 连续活跃天数（今天还没跑但昨天跑了不算断签）。 */
 currentStreak: number;
 longestStreak: number;
 /** 缓存命中率 = cacheRead / (input + cacheRead)；无分母时为 null。 */
 cacheHitRate: number | null;
};

/** 热力图格子里的一个模型用量（后端已按 token 降序）。 */
export type UsageHeatModel = { model: string; total: number };

/** 热力图的一格（`date` = 本地日期；没跑的日子补零，日历才成网格）。 */
export type UsageHeatRow = { date: string; total: number; models: UsageHeatModel[] };

/** 使用统计整体回包（`truncated` = 因扫描预算提前收手，统计可能不全）。 */
export type UsageStats = {
 totals: UsageTotals;
 /** 热力图：最近 53 周（周日对齐、逐日补零、到今天为止），**不随 `days` 裁剪**。 */
 heat: UsageHeatRow[];
 scannedFiles: number;
 truncated: boolean;
};

// ---------- 供应商用量（设置 › 供应商用量） ----------

/**
 * 供应商侧的一个限额窗口（5 小时滚动 / 每周 / 每月…），来自 `omp usage --json`。
 * `usedFraction` / `percent` 上游可能只给其一，后端已归一到同源口径；超限时可能 >1。
 */
export type UsageLimit = {
 id: string;
 label: string;
 /** 窗口标识（`5h` / `7d` / `monthly` / `balance`；字典按它选窗口名，未知值回退 `windowLabel`）。 */
 windowId: string;
 windowLabel: string;
 /** 已用比例（0–1 小数）。 */
 usedFraction: number;
 /** 已用百分比（0–100 刻度）。 */
 percent: number;
 /** 上游状态（`ok` / `warning` / `exhausted`；开放枚举）。 */
 status: string;
 /** 下次重置时刻（epoch 毫秒）；上游没给为 null。 */
 resetsAt: number | null;
 /** 窗口时长（毫秒；monthly 恒缺省）；上游没给为 null。 */
 durationMs: number | null;
 /** 上游备注；没有为空数组。 */
 notes: string[];
 /** 金额 / 数量绝对值（仅非 percent 单位有意义；percent 单位时为 null）。 */
 used: number | null;
 /** 额度上限（与 `used` 同单位；余额型窗口没有上限时为 null）。 */
 limit: number | null;
 /** 剩余额（余额型窗口的主值；上游没给为 null）。 */
 remaining: number | null;
 /** 计量单位：`percent` / `usd` / `cny` / `credits` / `tokens` …（开放枚举）。 */
 unit: string;
};

/** 一个供应商的用量报告（一个账号一份——同一 provider 多账号时有多份）。 */
export type ProviderUsageReport = {
 provider: string;
 /** 套餐名（`OpenCode Go`）；上游没给为 null。 */
 planType: string | null;
 /** 账号标识（email / accountId / orgName 里第一个可用的）；多账号区分用。 */
 accountLabel: string | null;
 /** 数据真实抓取时刻（epoch 毫秒；0 = 上游未给）。 */
 fetchedAt: number;
 limits: UsageLimit[];
};

/** 已认证但本次拿不到用量的账号（界面给一行说明）。 */
export type ProviderUsageAccount = {
 provider: string;
 /** `api_key` / `oauth` / `unknown`。 */
 kind: string;
 email: string | null;
 accountId: string | null;
};

/** 被自动停用的凭据（刷新失败 / 上游失效；界面提示需重新登录）。 */
export type ProviderUsageDisabled = ProviderUsageAccount & {
 /** 停用原因（上游英文原文）；上游没给为 null。 */
 cause: string | null;
 /** 停用时刻（epoch 毫秒）；上游没给为 null。 */
 disabledAtMs: number | null;
};

/** 补充探针（壳侧查询，commandcode / deepseek 等）的失败记录：能查但这次没查到。 */
export type ExtraProbeFailure = {
 provider: string;
 message: string;
};

/** 供应商用量总览（`omp usage --json` 的投影 + 壳侧补充探针；只读，前端只格式化不重算）。 */
export type ProviderUsage = {
 /** 本次渲染时刻（epoch 毫秒）。 */
 generatedAt: number;
 reports: ProviderUsageReport[];
 accountsWithoutUsage: ProviderUsageAccount[];
 disabledCredentials: ProviderUsageDisabled[];
 /**
  * 已配置的供应商 id（取自模型目录缓存，与设置页「已配置」同一条口径）。
  * `reports` 只含有用量探针的供应商；两者相减 = 「配了但上游拿不到用量」。
  */
 configuredProviders: string[];
 /** 补充探针的失败记录（与「无用量数据」区分：这些是能查但这次没查到）。 */
 extraFailures: ExtraProbeFailure[];
};

/** 应用更新状态（Tauri updater，直接面向 GitHub Release latest.json）。 */
export type UpdateState =
 | { status: "idle" }
 | { status: "checking" }
 | { status: "latest"; current: string }
 | { status: "available"; version: string; current: string; body: string | null }
 | { status: "downloading"; version: string; downloaded: number; total: number | null }
 | { status: "ready"; version: string }
 | { status: "error"; message: string };

/**
 * omp 设置项（设置 ›「常用设置」）：值来自 `omp config list --json`。
 * `kind` 是 omp 的 schema 类型（boolean / number / enum / …），`description` 是上游英文说明
 * （原样透传，不翻译）；上游没有这个键时它整个缺席，界面据此显示「当前 omp 版本没有这个设置」。
 */
export type OmpSetting = {
 key: string;
 value: unknown;
 kind: string;
 description: string;
};

// ---------- V21 左栏：工作区（容器）→ 项目 → 目录行 ----------

/**
 * 工作区（V21）：多项目容器——协作的边界。
 * 成员关系在项目侧（`ProjectView.workspaceId`，一个项目最多属于一个工作区）；
 * `projectIds` 按项目注册顺序（前端渲染与协作根计算都用这个顺序）。
 */
export type WorkspaceView = {
 id: string;
 name: string;
 createdAt: number;
 /** 成员项目 id；空组合法（先建组、后加项目）。 */
 projectIds: string[];
};

/** 左栏目录行（V21 前叫「工作区行」）：项目主目录或它的一个 git worktree。 */
export type CheckoutView = {
 projectId: string;
 projectName: string;
 /** 工作目录：主目录 = 项目路径；worktree = worktree 路径。 */
 path: string;
 /** 检出的分支；detached / 非 git 仓库为 null。 */
 branch: string | null;
 /** detached 时的短 sha。 */
 head: string | null;
 isMain: boolean;
 missing: boolean;
};

/**
 * 左栏选中项（V21）：右栏视图范围的**唯一真相**。
 * - `group`：工作区视图（`id: null` = 未分组区）——范围 = 组内全部项目的全部目录；
 * - `checkout`：目录视图——范围 = 该目录。
 * store 里为 `null` 时表示「一个可用目录都没有」，终端不过滤（与 V11 口径一致）。
 */
export type SidebarSelection =
 | { kind: "group"; id: string | null }
 | { kind: "checkout"; path: string };

// ---------- 工作区提交 / 推送（V19） ----------

/**
 * 工作区 git 快照（行徽章用）：`git status --porcelain -b` 的只读投影。
 * 刷新时机见 `lib/commitTasks.ts`（启动 / 任务结束 / 窗口可见或获得焦点 / 终端转就绪 / 30s 兜底轮询）；
 * 点击提交面板里的按钮时，前端勾选与后端暂存校验才是最终裁决。
 */
export type WorkspaceGitState = {
 path: string;
 isRepo: boolean;
 /** 有未提交改动（含未跟踪文件——提交走 `add -A`，语义一致）。 */
 dirty: boolean;
 /** 本地领先上游的提交数（无上游 / detached 时为 0）。 */
 ahead: number;
 /** 本地落后上游的提交数（无上游 / detached 时为 0）。 */
 behind: number;
 upstream: string | null;
 /** 上游分支已在远程被删除（`[gone]`）：upstream 名仍在，但没有可比较的远程分支。 */
 upstreamGone: boolean;
};

/** 变更集里的一个文件（与 Rust `git_ops::ChangeFile` 同构）。`index` / `worktree` = porcelain 的 XY。 */
export type ChangeFile = {
 path: string;
 /** 重命名 / 复制时的原名 */
 origPath: string | null;
 /** 暂存区态：`M` / `A` / `D` / `R` / `?`（未跟踪时两位都是 `?`） */
 index: string;
 /** 工作区态 */
 worktree: string;
 untracked: boolean;
 /** 已跟踪改动的 +N（未跟踪恒 0） */
 add: number;
 /** 已跟踪改动的 -M */
 del: number;
};

/** 提交面板打开时的变更视图（与 Rust `git_ops::ChangeSet` 同构）。 */
export type ChangeSet = {
 isRepo: boolean;
 branch: string | null;
 /** detached 时的短 sha */
 head: string | null;
 upstream: string | null;
 upstreamGone: boolean;
 ahead: number;
 behind: number;
 files: ChangeFile[];
};

/** 提交任务阶段（与 Rust `git_commit::CommitPhase` 同构）。 */
export type CommitPhase =
 | "idle"
 | "checking"
 | "generating"
 | "generated"
 | "committing"
 | "pushing"
 | "committed"
 | "pushed"
 | "noop"
 | "failed"
 | "canceled";

/** 轨道：快速（壳侧单轮生成）/ 完整（omp commit，含 CHANGELOG）。 */
export type CommitMode = "fast" | "full";

/** 一次提交（短 sha + 摘要）；完整轨可能一次产出多条（split）。 */
export type CommitEntry = {
 sha: string;
 subject: string;
};

/** 任务终态与结果（与 Rust `git_commit::CommitOutcome` 同构）。 */
export type CommitOutcome = {
 phase: CommitPhase;
 /** 本次任务新建的提交（失败时也可能非空——部分成功：提交成功、推送失败）。 */
 commits: CommitEntry[];
 /** 快速轨生成的信息（`generated` 终态带回来）。 */
 message: string | null;
 error: string | null;
 hint: string | null;
};

/** git_commit → 前端事件（与 Rust `git_commit::CommitEvent` 同构，tag 为 `type`）。 */
export type CommitEvent =
 | { type: "line"; text: string }
 /** 生成流：模型 stdout 的增量，直接追加进编辑框 */
 | { type: "delta"; text: string }
 /** 生成结束：解析后的提交信息 */
 | { type: "message"; text: string }
 | { type: "phase"; phase: CommitPhase }
 | { type: "exit"; outcome: CommitOutcome };

/**
 * 前端任务视图（store 里按 cwd 存）：
 * - `files` / `selected` 是打开面板时的快照与勾选（勾选 = 本次提交包含哪些文件）；
 * - `message` 是可编辑的提交信息（生成结果或用户手改）；
 * - `log` 是完整轨的流式日志（快速轨不用它，只在错误摘要里体现）；
 * - 运行中关闭浮层 = 转后台（任务继续，行徽章指示）。
 */
export type CommitTaskView = {
 cwd: string;
 mode: CommitMode;
 phase: CommitPhase;
 files: ChangeFile[];
 selected: string[];
 message: string;
 /** 本轮是否已生成过信息（决定按钮显示「生成」还是「重新生成」）。 */
 generated: boolean;
 log: string[];
 commits: CommitEntry[];
 error: string | null;
 hint: string | null;
 startedAt: number;
};

/** 终端进程状态：运行中 / 已退出（退出码供展示）。 */
export type TerminalStatus = "running" | "exited";

/**
 * 终端标签上 π 的展示状态（颜色由它决定）：
 * `working` / `attention` / `ready` 来自 omp 的 OSC 标题（见 `lib/termTitle.ts`），
 * `exited` / `failed` 是进程结局（正常退出 / 异常退出或启动失败），
 * `unknown` = 还没有可判断的信息（刚打开、`tui.titleState` 关掉等）。
 */
export type TermTabState = "working" | "attention" | "ready" | "unknown" | "exited" | "failed";

/**
 * 打开中的终端（前端模型）。PTY 进程本身在后端 `pty` 进程表里；
 * 这里只放低频元数据——高频字节流走 Channel 直推 xterm，不进 store。
 */
export type TerminalView = {
 id: string;
 /** 归属项目；项目被移除后为 null（tab 保留，继续可用）。 */
 projectId: string | null;
 /** 工作目录（工作区目录：项目主目录或 worktree）。 */
 cwd: string;
 /** 工作区显示名（项目 · 分支）；会话标题到达前 tab 用它。 */
 label: string;
 /**
  * tab 上显示的**会话标题**（OSC 标题 `π <状态> <会话名>` 解析；null = 还没有会话标题）。
  * omp 在会话还没有标题时会把 cwd 的末段目录名当名字发出来（实测 18.2.x）——那是「项目名」
  * 不是会话标题，store 识别后落 null（见 `lib/termTitle.ts` 的 `isWorkspaceNameFallback`）。
  * 展示名 = `title ?? label`（`terminalDisplayName`）。
  */
 title: string | null;
 /** 标签 π 的状态（标题状态 + 进程结局，见 `lib/termTitle.ts`）；π 的颜色由它决定。 */
 state: TermTabState;
 status: TerminalStatus;
 exitCode: number | null;
 /** 恢复的历史会话（spawn 时透传 `--resume <id>` 前缀）；null = 新会话。 */
 resume: string | null;
 /**
  * 本终端**实际挂上**的工作区协作根（V21；同工作区其他成员项目的主目录，空 = 无）。
  * spawn 时由 `lib/workspaceGroups.ts` 的 `collabContextFor` 算出并写回 store——
  * tab 悬停提示展示的是「实际生效的参数」，不是「此刻应生效的参数」。
  */
 collab: string[];
 /** 重启计数：每次点「重启」+1，TerminalPane 依赖它重新 spawn。 */
 spawnSeq: number;
 createdAt: number;
};

/** PTY → 前端事件（与 Rust `pty::PtyEvent` 同构，tag 为 `type`）。 */
export type PtyEvent =
 | { type: "data"; data: string }
 | { type: "exit"; code: number | null };

/** `pty_spawn` 的入参（camelCase，与 Rust `PtySpawnOpts` 对齐）。 */
export type PtySpawnOpts = {
 id: string;
 cwd: string;
 cols: number;
 rows: number;
 resume?: string | null;
 /** 工作区协作根（V21）：同工作区其他成员项目的**主目录**，逐个 `--add-dir`。 */
 addDirs?: string[];
 /** 工作区拓扑说明（V21）：`--append-system-prompt=<文本>`；空 = 不注入。 */
 appendSystemPrompt?: string | null;
};

// ---------- 自定义模型配置（设置 › 供应商） ----------

/**
 * `<agentDir>/models.yml`（或回退的 `models.yaml`）的当前状态。
 * `hash` 是写入的乐观锁：界面基于 `text` 编辑，保存时回传读时的 hash——
 * 文件在界面之外被改过（用户手改 / 其它工具）时哈希不再匹配，写入被拒（重新加载后重试）。
 */
export type ModelsConfigFile = {
 path: string;
 exists: boolean;
 text: string;
 hash: string;
};

// ---------- 会话标题语言（V18） ----------

/** 标题语言档（壳的 `Locale` 归一：`zh-CN` → `zh`；只有中 / 英两档）。 */
export type TitlePromptLang = "zh" | "en";

/**
 * `sync_title_prompt` 的结果：`written` = 已写 / `unchanged` = 内容一致未写 /
 * `skipped` = 用户自写 `TITLE_SYSTEM.md`（后端不碰）。
 */
export type TitlePromptOutcome = {
 path: string;
 action: "written" | "unchanged" | "skipped";
};
