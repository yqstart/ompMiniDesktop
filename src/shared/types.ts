/** 前后端共享类型：overlay / 视图 / RPC / ViewMsg。 */

export type ApprovalMode = "always-ask" | "write" | "yolo";

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
  | { kind: "user"; id: string; text: string; mentions: string[] }
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
    }
  /** 服务端撤回（`method:"cancel"`，请求已 abort/超时）：把对应卡片从流里去掉。 */
  | { kind: "ui-cancel"; id: string; uiId: string };

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
