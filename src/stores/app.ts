import { create } from "zustand";
import type { AvailableCommand, HealthInfo, ImageAttachment, ModelCatalog, ProjectView, SessionRuntime, SessionStatus, SessionView, TodoPhase, UpdateState, ViewMsg } from "@shared/types";
import type { Locale } from "../lib/locale";
import { loadLocale, saveLocale } from "../lib/locale";

type AppState = {
 health: HealthInfo | null;
 projects: ProjectView[];
 activeProjectId: string | null;
 sessions: SessionView[];
 /** 会话扫描统计（V2 M7a）：目录里共多少 jsonl / 本次解析了多少。 */
 sessionScan: { totalFiles: number; scannedFiles: number };
 /** 当前扫描窗口大小（点「继续扫描」按 500 递增，上限 5000）。 */
 sessionScanLimit: number;
 activeSessionId: string | null;
 eventsBySession: Record<string, ViewMsg[]>;
 statusBySession: Record<string, SessionStatus>;
 drafts: Record<string, string>;
 /** 待发送图片附件（按会话隔离，只存在内存里，发送成功即清空）。 */
 attachmentsBySession: Record<string, ImageAttachment[]>;
 models: ModelCatalog | null;
 currentModel: string | null;
 currentThinking: string | null;
 /** 当前模型可用思考档（omp 真值；null = 不支持思考）。驱动思考档下拉只列支持项。 */
 currentEfforts: string[] | null;
 /** 当前会话的运行时真值快照（上下文占用 / 本轮用量 / 耗时）：状态条纯透传的数据源。 */
 currentRuntime: SessionRuntime | null;
 /** 可用命令面（`available_commands_update` 缓存，按会话隔离；`/` 补全的数据源）。 */
 commandsBySession: Record<string, AvailableCommand[]>;
 /** 任务计划（`todoPhases` 真值 + `todo_reminder` 事件合并，按会话隔离；只读展示）。 */
 plansBySession: Record<string, TodoPhase[]>;
 sessionApprovals: Record<string, string>;
 /** 输入框工具行与上方上下文条的下拉互斥：同一时刻只开一个（model/thinking/permission/project/branch）。 */
 composerMenu: "model" | "thinking" | "permission" | "project" | "branch" | null;
 settingsOpen: boolean;
 sidebarOpen: boolean;
 update: UpdateState;
 updateDismissedVersion: string | null;
 /** 更新弹窗显隐（available 常驻入口，弹窗可单独关闭=稍后）。 */
 updateDialogOpen: boolean;
 /** 设置页界面语言（只作用于本应用展示，localStorage 持久化）。 */
 locale: Locale;
 setLocale: (locale: Locale) => void;
 set: (p: Partial<AppState>) => void;
 draftOf: (sid: string | null) => string;
 setDraft: (sid: string | null, text: string) => void;
 attachmentsOf: (sid: string | null) => ImageAttachment[];
 addAttachments: (sid: string | null, items: ImageAttachment[]) => void;
 removeAttachment: (sid: string | null, index: number) => void;
 clearAttachments: (sid: string | null) => void;
 appendEvents: (sid: string, msgs: ViewMsg[]) => void;
 /** 左侧栏宽度（220–480，默认 264，持久化 localStorage）。 */
 sidebarWidth: number;
 setSidebarWidth: (w: number) => void;
 /** 消息流「首屏增量」窗口：当前会话已渲染的消息条数（见 MASTER §7：首屏 200 条）。 */
 threadLimitSid: string | null;
 threadLimit: number;
 /** 展开更早的消息（按页递增）；打开新会话时由 openSessionWithHistory 重置。 */
 growThreadLimit: (by: number) => void;
 resetThreadLimit: (sid: string) => void;
};

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 264;
/** 消息流单页条数：首屏只渲染最后 200 条，其余按需向上加载（MASTER §7）。 */
export const THREAD_PAGE = 200;

function loadSidebarWidth(): number {
 try {
  if (typeof localStorage === "undefined") return SIDEBAR_DEFAULT;
  const v = Number(localStorage.getItem("omp.sidebarWidth"));
  if (!Number.isFinite(v)) return SIDEBAR_DEFAULT;
  return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
 } catch {
  // 无痕模式等取不到持久化时回默认宽度
  return SIDEBAR_DEFAULT;
 }
}

export const useApp = create<AppState>((set, get) => ({
 health: null,
 projects: [],
 activeProjectId: null,
 sessions: [],
 sessionScan: { totalFiles: 0, scannedFiles: 0 },
 sessionScanLimit: 500,
 activeSessionId: null,
 eventsBySession: {},
 statusBySession: {},
 drafts: {},
 attachmentsBySession: {},
 models: null,
 currentModel: null,
 currentThinking: null,
 currentEfforts: null,
 currentRuntime: null,
 commandsBySession: {},
 plansBySession: {},
 sessionApprovals: {},
 composerMenu: null,
 settingsOpen: false,
 sidebarOpen: false,
 update: { status: "idle" },
 updateDismissedVersion: null,
 updateDialogOpen: false,
 locale: loadLocale(),
 setLocale: (locale) => {
  saveLocale(locale);
  try {
   document.documentElement.lang = locale;
  } catch {
   // 非 DOM 环境（单测）忽略
  }
  set({ locale });
 },
 sidebarWidth: loadSidebarWidth(),
 threadLimitSid: null,
 threadLimit: THREAD_PAGE,
 growThreadLimit: (by) => set((s) => ({ threadLimit: s.threadLimit + by })),
 resetThreadLimit: (sid) => set({ threadLimitSid: sid, threadLimit: THREAD_PAGE }),
 setSidebarWidth: (w) => {
  const v = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
  try {
   localStorage.setItem("omp.sidebarWidth", String(v));
  } catch {
   // 持久化失败不阻断本次拖拽
  }
  set({ sidebarWidth: v });
 },
 set: (p) => set(p),
 draftOf: (sid) => (sid ? (get().drafts[sid] ?? "") : ""),
 setDraft: (sid, text) =>
  set((s) => ({ drafts: sid ? { ...s.drafts, [sid]: text } : s.drafts })),
 attachmentsOf: (sid) => (sid ? (get().attachmentsBySession[sid] ?? []) : []),
 addAttachments: (sid, items) =>
  set((s) =>
   sid && items.length > 0
    ? { attachmentsBySession: { ...s.attachmentsBySession, [sid]: [...(s.attachmentsBySession[sid] ?? []), ...items] } }
    : s,
  ),
 removeAttachment: (sid, index) =>
  set((s) => {
   if (!sid) return s;
   const cur = s.attachmentsBySession[sid] ?? [];
   const next = cur.filter((_, i) => i !== index);
   return { attachmentsBySession: { ...s.attachmentsBySession, [sid]: next } };
  }),
 clearAttachments: (sid) =>
  set((s) => (sid ? { attachmentsBySession: { ...s.attachmentsBySession, [sid]: [] } } : s)),
 appendEvents: (sid, msgs) =>
  set((s) => ({
   eventsBySession: {
    ...s.eventsBySession,
    [sid]: [...(s.eventsBySession[sid] ?? []), ...msgs],
   },
  })),
}));

/* 会话视图（SessionView）不带派生逻辑：分组、归档过滤等都在 lib 里做。
   （历史上这里有个 `activeSessionsOf` 过滤器，左栏改为只列进行中的会话后没人再用了。） */
