/** 前后端共享类型：overlay / 视图 / RPC / ViewMsg。 */

export type ApprovalMode = "always-ask" | "write" | "yolo";

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

/** 会话真相里的模型引用之外，覆盖层与视图共用的小类型集合。 */
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
 * 会话列表分页（V2 M7a）：`totalFiles` = sessions 目录下 jsonl 总数，
 * `scannedFiles` = 本次真正解析了头部的文件数。`totalFiles > scannedFiles` 时
 * 左栏给「继续扫描」入口——超出窗口的都是更老的会话，不是不存在。
 */
export type SessionPage = {
 sessions: SessionView[];
 totalFiles: number;
 scannedFiles: number;
};

/**
 * 会话内容搜索的一条命中（V2 M7b）：`hits` 是该会话正文里的命中次数，
 * `snippet` 是首个命中前后的单行片段。搜索面只有 user / assistant 的正文
 * （工具输出与 thinking 不进搜索面）。
 */
export type SessionHit = {
 id: string;
 title: string;
 timestamp: number;
 snippet: string;
 hits: number;
 archived: boolean;
};

/** 搜索结果：`truncated` = 因预算（文件数 / 字节 / 时间 / 命中上限）提前收手，结果可能不全。 */
export type SessionSearchResult = {
 hits: SessionHit[];
 scannedFiles: number;
 truncated: boolean;
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
 /** omp 给的是 0–1 比例；展示时换算成百分比。 */
 percent: number | null;
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

/** 可用命令（`available_commands_update` 透传；`/` 补全的数据源）。 */
export type AvailableCommand = {
 name: string;
 description?: string;
 aliases?: string[];
 hint?: string;
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
 * 供应商（omp `auth-broker list` 的 OAuth 供应商）+ 当前是否已有可用凭证。
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

/** 应用更新状态（Tauri updater，直接面向 GitHub Release latest.json）。 */
export type UpdateState =
 | { status: "idle" }
 | { status: "checking" }
 | { status: "latest"; current: string }
 | { status: "available"; version: string; current: string; body: string | null }
 | { status: "downloading"; version: string; downloaded: number; total: number | null }
 | { status: "ready"; version: string }
 | { status: "error"; message: string };
