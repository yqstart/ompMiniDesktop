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
 /** 有请求的天数（**全量历史**，与热力图同口径，不随所选范围裁剪）。 */
 activeDays: number;
 /** 连续活跃天数（今天还没跑但昨天跑了不算断签；全量历史）。 */
 currentStreak: number;
 /** 最长连续活跃天数（全量历史）。 */
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
 * omp 运行时更新检查（`omp update --check` 的回包）：当前版本 / 新版本号 / 渠道。
 * `latest` 为 null = 上游判定「已是最新」；这是 **omp 自己**的更新，与本应用的更新
 * （`UpdateState`，走 Tauri updater）是两条独立链路。
 */
export type OmpUpdateStatus = {
 current: string | null;
 latest: string | null;
 /** `stable` / `canary`（上游只在 canary 档打印渠道标签，缺省即 stable）。 */
 channel: string;
};

/** 前端持有的 omp 更新检查状态（`lib/ompUpdate.ts` 从回包派生 + 时间戳）。 */
export type OmpUpdate = {
 status: "idle" | "checking" | "available" | "latest" | "error";
 current: string | null;
 latest: string | null;
 channel: string | null;
 /** 失败原因（上游 stderr 原文，原样透传，不进字典）。 */
 message: string | null;
 /** 上次检查完成时间（epoch ms）；null = 本次运行还没检查过。 */
 checkedAt: number | null;
};

/**
 * 执行更新（`omp update`）的终局阶段。`running` 是**前端本地态**——后端只在结束时发终态
 * （与 Rust `omp_update::OmpUpdatePhase` 同构）。
 */
export type OmpUpdatePhase = "running" | "done" | "failed" | "canceled";

/** 一次 `omp update` 的终局（Channel 的 `exit` 事件 payload）。 */
export type OmpUpdateOutcome = {
 phase: OmpUpdatePhase;
 /** 更新前的版本（后端跑更新前探的 `omp --version`）。 */
 from: string | null;
 /** 失败原因（两路输出尾行摘要）；成功 / 取消时为 null。 */
 error: string | null;
};

/** `start_omp_update` → 前端事件（与 Rust `omp_update::OmpUpdateEvent` 同构，tag 为 `type`）。 */
export type OmpUpdateEvent =
 | { type: "line"; text: string }
 | { type: "exit"; outcome: OmpUpdateOutcome };

/** 前端持有的更新任务（store 里的 `ompUpdateRun`；日志有上限，见 `lib/ompUpdate.ts`）。 */
export type OmpUpdateRun = {
 phase: OmpUpdatePhase;
 lines: string[];
 from: string | null;
 /** 更新后的版本：成功时等健康检查刷新后回填（拿不到就 null，界面退到通用文案）。 */
 to: string | null;
 error: string | null;
 /** 任务发起时间（epoch ms）：慢网络下界面要显示「已用时 N」，让人知道它还在跑。 */
 startedAt: number | null;
};

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

/**
 * 设置目录里的一项（设置页用；与 Rust `settings::CatalogItem` 同构）：在 `OmpSetting` 之上带了
 * **分组**（上游人读清单的 `[appearance]` …，空 = 只在 JSON 里出现）与 **enum 取值表**
 * （JSON 不给枚举取值，只能从人读文本解析）。
 * `value === null` 有两种含义，靠 `redacted` 区分：未设置（上游没有显式值）/ 值被上游隐藏
 * （令牌类键——`config get` 能读回，但 `config list` 一律脱敏）。
 */
export type OmpCatalogItem = {
 key: string;
 value: unknown;
 kind: string;
 description: string;
 section: string;
 options: string[];
 redacted: boolean;
};

/** 上游设置目录（分组顺序 + 全部项，顺序照上游清单；页面按精选清单过滤后显示）。 */
export type OmpSettingsCatalog = {
 sections: string[];
 items: OmpCatalogItem[];
};

// ---------- V21 左栏：工作区（容器）→ 项目 → 目录行 ----------

/**
 * 工作区（V21）：多项目容器——协作的边界。
 * 成员关系在项目侧（`ProjectView.workspaceId`，一个项目最多属于一个工作区）；
 * `projectIds` 按左栏顺序（`overlay.projects` 的数组顺序；V26 起可在左栏拖拽调整）。
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
 * 引用浮层（V22）：一个项目的文件列表（`git ls-files -c -o --exclude-standard` 的只读投影）。
 * 路径是**相对该项目目录**的 POSIX 形式；`error` 非空 = 这个项目列不出文件
 * （非 git 仓库 / 目录不存在 / git 缺失），浮层只对它显示一行提示。
 */
export type ProjectFiles = {
 path: string;
 files: string[];
 truncated: boolean;
 error: string | null;
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

// ---------- 插件（设置 ›「插件」） ----------

/**
 * 插件声明的一个可选特性（omp manifest 的 `features`）。
 * `enabled` 是**当前生效**值（显式列表说了算，没写列表就按 `defaultEnabled`）——界面直接照着画。
 */
export type PluginFeature = {
 name: string;
 /** manifest 里的说明（上游英文，原样透传）。 */
 description: string;
 defaultEnabled: boolean;
 enabled: boolean;
};

/** 一个 npm / link 插件（`omp plugin list --json` 的 `npm` 条目）。 */
export type PluginItem = {
 name: string;
 version: string;
 /** 安装路径（link 的是软链目标）。 */
 path: string;
 description: string;
 features: PluginFeature[];
 /** `enabledFeatures` 已被显式写过 = 不再回落 manifest 默认（界面标「已自定义」）。 */
 featuresCustomized: boolean;
 enabled: boolean;
};

/** 一个市场插件（`omp plugin list --json` 的 `marketplace` 条目）。 */
export type MarketPluginItem = {
 /** `名字@市场名`（卸载 / 启停都要原样回传）。 */
 id: string;
 version: string;
 scope: "user" | "project";
 /** 被项目级同名安装遮住时的说明。 */
 shadowedBy: string | null;
 enabled: boolean;
};

/** 插件清单。`cwd` = 本次读取钉的工作目录（决定项目级可见范围）。 */
export type PluginsView = {
 cwd: string;
 npm: PluginItem[];
 marketplace: MarketPluginItem[];
};

/** 一个插件的特性集合（写回后回读）。 */
export type PluginFeatures = {
 plugin: string;
 enabledFeatures: string[];
 availableFeatures: string[];
};

/** 插件体检的一行（`status` 上游值原样）。 */
export type PluginDoctorFinding = {
 name: string;
 status: string;
 message: string;
 fixed: boolean;
};

// ---------- 技能（设置 ›「技能」） ----------

/** 一个被 omp 发现到的技能（`omp skill list --json` 的一条）。 */
export type SkillItem = {
 name: string;
 /** frontmatter 的 `description`（上游 / 用户自写，原样透传）。 */
 description: string;
 filePath: string;
 /** `SKILL.md` 所在目录。 */
 baseDir: string;
 /** `<provider>:<level>`（如 `native:project`、`agents:user`、`omp-plugins:user`）。 */
 source: string;
 /** `hide` / `disable-model-invocation`：不参与自动匹配，只能显式调用。 */
 hide: boolean;
};

/** 发现过程中的警告（同名冲突等）。 */
export type SkillWarning = {
 skillPath: string;
 message: string;
};

/**
 * 技能清单：`cwd` = 本次发现钉的范围（家目录 = 只看用户级）。
 * `disabled` 是 `disabledExtensions` 里的技能名——**被停用的技能上游不再列出来**，
 * 「已停用」行只能从这份配置读（拿不到描述与路径，上游行为）。
 */
export type SkillsView = {
 cwd: string;
 skills: SkillItem[];
 disabled: string[];
 warnings: SkillWarning[];
};

/** `SKILL.md` 的正文（`truncated` = 超过后端上限被截断）。 */
export type SkillFileContent = {
 text: string;
 bytes: number;
 truncated: boolean;
};

// ==================== 聊天形态（V32 恢复自 V1–V10） ====================

/** 消息里的一张图片：与 omp jsonl / prompt.images 的 image 内容块同构（base64，不带 data: 前缀）。 */
export type ImageBlock = { mimeType: string; data: string };

/**
 * `@文件` 提及被 omp 读进上下文后，`fileMention` 消息里的一条文件记录（V2 M6b）。
 * `skippedReason` 有值时表示 omp 跳过了自动读取（binary / tooLarge）。
 */
export type MentionFile = {
 path: string;
 lineCount?: number;
 byteSize?: number;
 skippedReason?: string;
};

/** `check_paths` 的返回：输入框里 @提及 的存在性提示（只读 stat，不读内容）。 */
export type PathCheck = { path: string; exists: boolean; isDir: boolean };

/**
 * 待发送的图片附件（本地读取，随 `prompt.images` 一次性发给 omp，不落覆盖层、不进草稿）。
 * `dataBase64` 与 `ImageBlock.data` 同格式；`name` 只用于输入框里的可读标签。
 */
export type ImageAttachment = { name: string; mimeType: string; dataBase64: string; bytes: number };

/** 模型精简引用（真值回读用，selector = provider/id）。 */
export type ModelRef = {
 provider: string;
 id: string;
 name?: string | null;
};

/** 上下文占用（omp `get_state.contextUsage`），纯透传，前端只做格式化。 */
export type ContextUsage = {
 tokens: number | null;
 contextWindow: number | null;
 /** omp 给的就是百分比（0–100）；缺失或窗口为 0 时为 null。 */
 percent: number | null;
};

/** 上下文分项的一档（`parts[].id`，展示名一律走字典）。 */
export type ContextPartId =
 | "messages"
 | "systemPrompt"
 | "skills"
 | "tools"
 | "mcpTools"
 | "systemContext";

/** 会话累计缓存用量（会话文件里逐轮 usage 求和，口径与设置页「使用统计」一致）。 */
export type ContextCacheStats = {
 input: number;
 cacheRead: number;
 cacheWrite: number;
 /** cacheRead / (input + cacheRead)，0–1；分母为 0 时 null。 */
 hitRate: number | null;
};

/**
 * 上下文分项（`get_context_breakdown`）。
 *
 * 真值与估算的分界（后端 `context.rs` 的口径，界面必须照此标注）：
 * 「已用 / 窗口 / 非消息」是 omp 真值，「消息 = 已用 − 非消息」也是真值；
 * 非消息的其余五档是按字符量估算后**缩放到非消息真值**的结果——各档之和恒等于真值，
 * 但档与档之间怎么切是估算。
 */
export type ContextBreakdown = {
 usedTokens: number | null;
 contextWindow: number | null;
 /** 0–100（与 omp 同式同值）。 */
 percent: number | null;
 nonMessageTokens: number | null;
 /** 各档之和 = `usedTokens`；读不到锚点（非消息真值）时为空数组。 */
 parts: { id: ContextPartId; tokens: number }[];
 cache: ContextCacheStats;
};

/** 最近一轮用量（omp `message_end.message.usage`）。 */
export type TurnUsage = {
 input: number | null;
 output: number | null;
 totalTokens: number | null;
 cacheRead: number | null;
 reasoningTokens: number | null;
 costTotal: number | null;
};

/**
 * 会话运行时真值：omp `get_state` / `set_model` / `message_end` 回读的
 * 模型、可用思考档、当前档、上下文占用与本轮用量。
 * 打开会话时经 `get_session_runtime` 回填，其后变化经 `omp-state://<id>` 推送。
 */
export type SessionRuntime = {
 model: ModelRef | null;
 /** 当前模型可用思考档（omp `thinking.efforts`）；null = 不支持思考。 */
 efforts: string[] | null;
 thinkingLevel: string | null;
 contextUsage?: ContextUsage | null;
 usage?: TurnUsage | null;
 /** 本轮耗时（毫秒，omp 原值）。 */
 durationMs?: number | null;
 /** 本轮首字延迟（毫秒）。 */
 ttftMs?: number | null;
 /** 排队中的消息数（`get_state.queuedMessageCount`，流式排队时展示）。 */
 queuedCount?: number | null;
 /** 任务计划（`get_state.todoPhases` 原样透传；只读展示）。 */
 todoPhases?: TodoPhase[] | null;
 /** 可用命令（`available_commands_update` 缓存；`/` 补全的数据源）。 */
 commands?: AvailableCommand[] | null;
};

/** 任务计划的一条任务（`get_state.todoPhases` 原样透传）。 */
export type TodoTask = { id: string; content: string; status: string };

/** 任务计划的一个阶段。 */
export type TodoPhase = { id: string; name: string; tasks: TodoTask[] };

/** 可用命令的一条子命令（omp `subcommands[]` 原样透传；本期只作行内说明，不做二级补全）。 */
export type AvailableSubcommand = { name: string; description?: string; usage?: string };

/**
 * 可用命令（`available_commands_update` 透传；`/` 补全的数据源）。
 *
 * `source` 实测取值：`builtin` / `skill` / `extension` / `custom` / `file`。
 * **技能就是命令面里 `skill:<名>` 的那批**（omp 的 `skills.enableSkillCommands`），不是另一套
 * 数据——所以补全列表不另扫技能目录，扫了只会与命令面重复，还要复刻 omp 的加载优先级。
 * `hint` 线上形状是 `input.hint`，由 `lib/slashCommands.ts` 归一时折平（类型保留扁平写法）。
 */
export type AvailableCommand = {
 name: string;
 description?: string;
 aliases?: string[];
 /** 参数提示（omp `input.hint`，如 `/compact` → `[soft|remote|snapcompact] [focus]`）。 */
 hint?: string;
 /** 来源；`skill` 归入补全列表的「技能」组。 */
 source?: string;
 subcommands?: AvailableSubcommand[];
};

/**
 * 输入框上方上下文条的 git **只读**信息（后端 `get_git_info`）。
 * 非仓库 / 未装 git / 目录缺失时为 `isRepo:false`，前端整段隐藏分支展示，不当错误弹。
 */
export type GitInfo = {
 isRepo: boolean;
 /** 当前分支名；detached HEAD 时为短 sha；未知 null。 */
 branch: string | null;
 detached: boolean;
 /** 本地分支清单（当前分支置顶，其余按最近提交倒序）。 */
 branches: string[];
 /** 有未提交的已跟踪文件改动；null = 未检测 / 超时。 */
 dirty: boolean | null;
 /** 降级原因（tooltip 与日志用）。 */
 error: string | null;
};

/** 思考档全集（docs/v1-schedule.md §4）。 */
export const THINKING_LEVELS = [
 "off",
 "minimal",
 "low",
 "medium",
 "high",
 "xhigh",
 "max",
 "auto",
] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/**
 * omp `extension_ui_request` 里**需要用户回包**的交互方法（V2 M5 实测口径）。
 * 其余方法（notify / setStatus / setWidget / setTitle / set_editor_text）是单向通知，
 * `cancel` 是服务端撤回，都不进这张卡。
 */
export type UiMethod = "select" | "confirm" | "input" | "editor";

/**
 * 一次写 / 改文件的行数增量（工具行走尾的 `+N −M`）。
 * 由调用参数（`write.content` / `edit.new_string` 与 `edit.old_string`）在归一时刻算好，
 * **不保留原文**——只留两个计数，长文件内容不进前端内存。
 */
export type DiffStat = { added: number; removed: number };

/** ViewMsg：RPC delta 与 jsonl 文件块的统一渲染模型。 */
export type ViewMsg =
 | {
  kind: "user";
  id: string;
  text: string;
  mentions: string[];
  /** 随消息发出的图片（实时帧或 jsonl 的 image 内容块）；渲染为气泡内缩略图。 */
  images?: ImageBlock[];
  /** 因体积过大被刻意省略的图片数（历史回放不做无上限 base64 常驻）。 */
  imagesOmitted?: number;
 }
 | { kind: "text"; id: string; seq: number; text: string; complete: boolean }
 | { kind: "thinking"; id: string; text: string; seconds: number; complete: boolean }
 | {
  kind: "tool";
  id: string;
  toolCallId: string;
  name: string;
  intent: string;
  argsSummary: string;
  state: "streaming" | "running" | "ok" | "error";
  output: string;
  outputFull?: string;
  streamIndex: number;
  /** 写 / 改文件的行数增量（只有 write / edit 会有；其余工具缺省）。 */
  diffStat?: DiffStat;
 }
 | {
  kind: "approval";
  id: string;
  uiId: string;
  toolName: string;
  command: string;
  cwd: string;
  title: string;
 }
 | {
  kind: "divider";
  id: string;
  divider: "model" | "thinking" | "title" | "exit" | "turn";
  text: string;
 }
 /**
  * 本地命令输出（`/` 命令经 `command_output` 透传）：无 agent turn，
  * 渲染为灰字代码区，不触碰运行状态（状态机已由后端收敛到 idle）。
  */
 | { kind: "command"; id: string; output: string }
 /**
  * 任务计划（`get_state.todoPhases` / `todo_reminder`）：长任务的阶段清单，
  * 只读展示（改计划走 prompt 下指令），与 ToolCard 时间线互补。
  */
 | { kind: "plan"; id: string; phases: TodoPhase[] }
 /**
  * 通用 UI 请求（非审批）：omp 的 `confirm` / `input` / `editor` 与非审批 `select`。
  * 回包语义各不相同（`{confirmed}` / `{value}` / `{cancelled}`），由后端 `respond_ui` 按 `method` 组装。
  */
 | {
  kind: "ui";
  id: string;
  uiId: string;
  method: UiMethod;
  title: string;
  /** `confirm` 的正文。 */
  message?: string;
  /** `input` 的占位文案。 */
  placeholder?: string;
  /** `editor` 的预填内容。 */
  prefill?: string;
  /** 非审批 `select` 的选项。 */
  options?: string[];
  /** `select` 选项描述（与 `options` 位置对齐，无描述的位置为 null）。 */
  optionDetails?: (string | null)[];
 }
 /** 服务端撤回（`method:"cancel"`，请求已 abort/超时）：把对应卡片从流里去掉。 */
 | { kind: "ui-cancel"; id: string; uiId: string }
 /** `@文件` 提及被 omp 读进上下文（`fileMention` 消息）：渲染成一排文件芯片。 */
 | { kind: "files"; id: string; files: MentionFile[] };

export type SessionStatus =
 | { state: "running" }
 | { state: "idle" }
 | { state: "awaiting-approval" }
 | { state: "error"; detail: string }
 | { state: "exited"; detail: string };
