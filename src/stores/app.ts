import { create } from "zustand";
import type { HealthInfo, ModelCatalog, ProjectView, TerminalStatus, TerminalView, UpdateState, WorkspaceView } from "@shared/types";
import type { Locale, LocaleMode } from "../lib/locale";
import { loadLocaleMode, resolveLocale, saveLocaleMode, systemLang } from "../lib/locale";
import { applyTheme, loadTheme, saveTheme, type ThemeMode } from "../lib/theme";
import { loadMyModels, saveMyModels } from "../lib/myModels";

type AppState = {
 health: HealthInfo | null;
 /** 项目列表（覆盖层；工作区树由 `workspaces` 管）。 */
 projects: ProjectView[];
 /** 模型目录（设置页模型页签用；启动时静默加载一次）。 */
 models: ModelCatalog | null;
 /** 我的模型（本应用偏好，localStorage 持久化；模型选择器的候选范围，空 = 全部；见 src/lib/myModels.ts）。 */
 myModels: string[];
 setMyModels: (list: string[]) => void;
 /** 设置标签（单例）是否打开：打开后在标签栏里与终端标签并列；关闭才卸载设置页。 */
 settingsTabOpen: boolean;
 /** 主区当前显示的是设置标签（`activeTerminalId` 保持不变，作为「上次的终端」）。 */
 settingsTabActive: boolean;
 /** 打开 / 聚焦设置标签（已打开则只切过去）。 */
 openSettingsTab: () => void;
 /** 关闭设置标签：主区回到最近激活的终端标签（一个终端都没有则回到空态）。 */
 closeSettingsTab: () => void;
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
 /** 左侧栏宽度（292–480，默认 292，持久化 localStorage）。 */
 sidebarWidth: number;
 setSidebarWidth: (w: number) => void;

 // ---------- V11 终端工作区 ----------

 /** 工作区清单（`lib/workspaces.ts` 的 `loadWorkspaces` 是唯一刷新入口）。 */
 workspaces: WorkspaceView[];
 /** 打开中的终端（tab 元数据；PTY 进程与高频字节流都不进 store）。 */
 terminals: TerminalView[];
 /** 终端标签里当前激活的那个（切去设置标签时保持不变，回来就是「上次的终端」）。 */
 activeTerminalId: string | null;
 /** 左栏选中的工作区（按 `path` 标识；`＋` 新建终端用它当目录）。 */
 activeWorkspacePath: string | null;
 setActiveWorkspace: (path: string | null) => void;
 /** 打开一个新终端并聚焦（返回新 id）。`resume` = 以 `omp --resume` 恢复历史会话。 */
 openTerminal: (opts: {
  projectId: string | null;
  cwd: string;
  label: string;
  resume?: string | null;
 }) => string;
 focusTerminal: (id: string) => void;
 closeTerminal: (id: string) => void;
 setTerminalStatus: (id: string, status: TerminalStatus, code: number | null) => void;
 /** OSC 0/2 到达时更新 tab 标题（omp TUI 会带会话名发）。 */
 setTerminalTitle: (id: string, title: string) => void;
 /** 重启已退出的终端：`spawnSeq + 1` 触发 TerminalPane 重新 spawn。 */
 restartTerminal: (id: string) => void;
 /** 项目被移除时解除终端的归属（tab 与进程保留，继续可用）。 */
 detachTerminalProject: (projectId: string) => void;
 /** 等待确认关闭的终端 id（运行中终端的 × / ⌘W 都先落到这里，由 ConfirmDialog 收口）。 */
 closingTerminalId: string | null;
 /** 请求关闭：运行中 → 弹出确认；已退出 → 直接关。 */
 requestCloseTerminal: (id: string) => void;
 confirmCloseTerminal: () => void;
 cancelCloseTerminal: () => void;
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
 models: null,
 myModels: loadMyModels(),
 setMyModels: (list) => {
  saveMyModels(list);
  set({ myModels: list });
 },
 settingsTabOpen: false,
 settingsTabActive: false,
 openSettingsTab: () => set({ settingsTabOpen: true, settingsTabActive: true }),
 closeSettingsTab: () => set({ settingsTabOpen: false, settingsTabActive: false }),
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
 set: (p) => set(p),
 sidebarWidth: loadSidebarWidth(),
 setSidebarWidth: (w) => {
  const v = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
  try {
   localStorage.setItem("omp.sidebarWidth", String(v));
  } catch {
   // 持久化失败不阻断本次拖拽
  }
  set({ sidebarWidth: v });
 },

 // ---------- V11 终端工作区 ----------

 workspaces: [],
 terminals: [],
 activeTerminalId: null,
 activeWorkspacePath: null,
 setActiveWorkspace: (path) => set({ activeWorkspacePath: path }),
 openTerminal: ({ projectId, cwd, label, resume = null }) => {
  const id = crypto.randomUUID();
  const term: TerminalView = {
   id,
   projectId,
   cwd,
   label,
   title: label,
   status: "running",
   exitCode: null,
   resume,
   spawnSeq: 0,
   createdAt: Date.now(),
  };
  set((s) => ({
   terminals: [...s.terminals, term],
   activeTerminalId: id,
   activeWorkspacePath: cwd,
   // 新终端必然切回终端视图（设置标签留在标签栏里）
   settingsTabActive: false,
  }));
  return id;
 },
 focusTerminal: (id) =>
  set((s) => {
   const hit = s.terminals.find((t) => t.id === id);
   return hit ? { activeTerminalId: id, activeWorkspacePath: hit.cwd, settingsTabActive: false } : {};
  }),
 closeTerminal: (id) =>
  set((s) => {
   const idx = s.terminals.findIndex((t) => t.id === id);
   if (idx < 0) return {};
   const terminals = s.terminals.filter((t) => t.id !== id);
   // 关闭当前 tab 后聚焦相邻的一个（优先右邻，退回左邻）；全关则回到空态
   let activeTerminalId = s.activeTerminalId;
   if (activeTerminalId === id) {
    const next = terminals[Math.min(idx, terminals.length - 1)] ?? null;
    activeTerminalId = next ? next.id : null;
   }
   // 最后一个终端也关掉时：设置标签开着就切过去（否则主区回到空态）
   const settingsTabActive = terminals.length === 0 && s.settingsTabOpen ? true : s.settingsTabActive;
   return { terminals, activeTerminalId, settingsTabActive };
  }),
 setTerminalStatus: (id, status, code) =>
  set((s) => ({
   terminals: s.terminals.map((t) => (t.id === id ? { ...t, status, exitCode: code } : t)),
  })),
 setTerminalTitle: (id, title) =>
  set((s) => {
   const t = s.terminals.find((x) => x.id === id);
   // 只换真正变化的标题：OSC 会在每个 turn 反复发，白白触发整表更新
   if (!t || t.title === title || !title.trim()) return {};
   return { terminals: s.terminals.map((x) => (x.id === id ? { ...x, title } : x)) };
  }),
 restartTerminal: (id) =>
  set((s) => ({
   terminals: s.terminals.map((t) =>
    t.id === id ? { ...t, status: "running", exitCode: null, spawnSeq: t.spawnSeq + 1 } : t,
   ),
  })),
 detachTerminalProject: (projectId) =>
  set((s) => ({
   terminals: s.terminals.map((t) => (t.projectId === projectId ? { ...t, projectId: null } : t)),
  })),
 closingTerminalId: null,
 requestCloseTerminal: (id) => {
  const term = get().terminals.find((t) => t.id === id);
  if (!term) return;
  if (term.status === "running") {
   set({ closingTerminalId: id });
   return;
  }
  get().closeTerminal(id);
 },
 confirmCloseTerminal: () => {
  const id = get().closingTerminalId;
  if (id) get().closeTerminal(id);
  set({ closingTerminalId: null });
 },
 cancelCloseTerminal: () => set({ closingTerminalId: null }),
}));
