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
    };

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
