import { create } from "zustand";
import type { HealthInfo, ImageAttachment, ModelCatalog, ProjectView, ProviderUsage, SessionRuntime, SessionStatus, SessionView, TodoPhase, UpdateState, ViewMsg } from "@shared/types";
import type { Locale, LocaleMode } from "../lib/locale";
import { loadLocaleMode, resolveLocale, saveLocaleMode, systemLang } from "../lib/locale";
import { applyTheme, loadTheme, saveTheme, type ThemeMode } from "../lib/theme";
import { loadFavorites, saveFavorites } from "../lib/favoriteModels";

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
 /** 常用模型（本应用偏好，localStorage 持久化；见 src/lib/favoriteModels.ts）。空数组 = 输入框选择器回退全部可用模型。 */
 favoriteModels: string[];
 setFavoriteModels: (list: string[]) => void;
 currentModel: string | null;
 currentThinking: string | null;
 /** 当前模型可用思考档（omp 真值；null = 不支持思考）。驱动思考档下拉只列支持项。 */
 currentEfforts: string[] | null;
 /** 当前会话的运行时真值快照（上下文占用 / 本轮用量 / 耗时）：状态条纯透传的数据源。 */
 currentRuntime: SessionRuntime | null;
 /** 任务计划（`todoPhases` 真值 + `todo_reminder` 事件合并，按会话隔离；只读展示）。 */
 plansBySession: Record<string, TodoPhase[]>;
 sessionApprovals: Record<string, string>;
 /** 供应商配额快照（`omp usage --json`；输入框上方「用量限额」入口的数据源）。 */
 providerUsage: ProviderUsage | null;
 /** 配额读取失败的原因（成功时为 null；浮层里显示这一行）。 */
 providerUsageError: string | null;
 /** 配额是否正在拉取（刷新按钮的 loader 与首屏占位都用它）。 */
 providerUsageLoading: boolean;
 /** 输入框工具行与上方上下文条的下拉互斥：同一时刻只开一个（model/thinking/permission/project/branch/context/usage）。 */
 composerMenu: "model" | "thinking" | "permission" | "project" | "branch" | "context" | "usage" | null;
 settingsOpen: boolean;
 sidebarOpen: boolean;
 update: UpdateState;
 updateDismissedVersion: string | null;
 /** 更新弹窗显隐（available 常驻入口，弹窗可单独关闭=稍后）。 */
 updateDialogOpen: boolean;
 /** 界面语言偏好三档（跟随系统 / 简体中文 / English；只作用于本应用展示，localStorage 持久化）。 */
 localeMode: LocaleMode;
 /** 实际生效的语言（`localeMode` 解析后的结果；字典与 `<html lang>` 用它）。 */
 locale: Locale;
 setLocaleMode: (mode: LocaleMode) => void;
 /** 皮肤（只作用于本应用展示，localStorage 持久化；`system` 跟随系统偏好）。 */
 theme: ThemeMode;
 setTheme: (theme: ThemeMode) => void;
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

/**
 * 侧栏宽度下限由左栏底部那一行的**内容**决定：设置按钮（图标 + 全称）+ 语言切换 + 皮肤切换
 * 并排不挤压所需的最小宽度（最宽文案按英文界面算，`Settings` 比「设置」长）。比这更窄，
 * 设置按钮的文案就会开始 `truncate`——那不该是「用户可以拖到的状态」。
 *
 * 实测（真实渲染）：英文界面下这一行需要 287px，即侧栏 288px 是临界；这里留 4px 给
 * 字体渲染差异（换平台 / 换字体时 `Settings` 会宽一点点）。
 */
export const SIDEBAR_MIN = 292;
export const SIDEBAR_MAX = 480;
/** 默认宽度 = 下限：默认就取「底部行刚好完整」的宽度，内容区拿到最多的横向空间。 */
export const SIDEBAR_DEFAULT = SIDEBAR_MIN;

/** 启动时的语言偏好（模块加载时读一次，供 store 初始化解析出实际语言）。 */
const INITIAL_LOCALE_MODE = loadLocaleMode();
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
 favoriteModels: loadFavorites(),
 setFavoriteModels: (list) => {
  saveFavorites(list);
  set({ favoriteModels: list });
 },
 currentModel: null,
 currentThinking: null,
 currentEfforts: null,
 currentRuntime: null,
 plansBySession: {},
 sessionApprovals: {},
 providerUsage: null,
 providerUsageError: null,
 providerUsageLoading: false,
 composerMenu: null,
 settingsOpen: false,
 sidebarOpen: false,
 update: { status: "idle" },
 updateDismissedVersion: null,
 updateDialogOpen: false,
 localeMode: INITIAL_LOCALE_MODE,
 locale: resolveLocale(INITIAL_LOCALE_MODE, systemLang()),
 setLocaleMode: (mode) => {
  saveLocaleMode(mode);
  const locale = resolveLocale(mode, systemLang());
  try {
   document.documentElement.lang = locale;
  } catch {
   // 非 DOM 环境（单测）忽略
  }
  set({ localeMode: mode, locale });
 },
 theme: loadTheme(),
 setTheme: (theme) => {
  saveTheme(theme);
  // 同步落 class：useEffect 在 paint 之后跑，只靠它会让切皮肤先闪一帧旧皮肤
  applyTheme(theme);
  set({ theme });
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
