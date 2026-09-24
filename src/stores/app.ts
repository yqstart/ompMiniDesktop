import { create } from "zustand";
import type { CheckoutView, CommitOutcome, CommitTaskView, HealthInfo, ModelCatalog, ProjectView, SidebarSelection, TerminalStatus, TerminalView, UpdateState, WorkspaceGitState, WorkspaceView } from "@shared/types";
import type { Locale, LocaleMode } from "../lib/locale";
import { loadLocaleMode, resolveLocale, saveLocaleMode, systemLang } from "../lib/locale";
import { applyTheme, loadTheme, saveTheme, type ThemeMode } from "../lib/theme";
import { loadMyModels, saveMyModels } from "../lib/myModels";
import { loadCommitLangPrefs, saveCommitLangPrefs, type CommitLangPref } from "../lib/commitLang";
import { parseTermTitle, isWorkspaceNameFallback } from "../lib/termTitle";
import { checkoutGroupId, selectionScopePaths } from "../lib/workspaceGroups";

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

 /** 工作区清单（V21 多项目容器；`lib/checkouts.ts` 的 `loadCheckouts` 是唯一刷新入口，与目录行一起拉）。 */
 workspaceGroups: WorkspaceView[];
 /** 目录行清单（项目主目录 + git worktree；同上，唯一刷新入口）。 */
 checkouts: CheckoutView[];
 /** 打开中的终端（tab 元数据；PTY 进程与高频字节流都不进 store）。 */
 terminals: TerminalView[];
 /** 终端标签里当前激活的那个（切去设置标签时保持不变，回来就是「上次的终端」）。
  *  不变式：它**要么是 null，要么落在 `selection` 的范围里**——右栏视图按选中项过滤，
  *  范围外的激活项会让标签栏与面板同时空掉。`openTerminal` / `focusTerminal` / `closeTerminal` /
  *  `loadCheckouts` 四处负责维持。 */
 activeTerminalId: string | null;
 /** 左栏选中项（V21）：右栏终端视图的**范围真相**（`lib/workspaceGroups.ts` 的
  *  `selectionScopePaths`）、`＋` 新建终端的目标、左栏高亮。跟随 `openTerminal` / `focusTerminal` 走。 */
 selection: SidebarSelection | null;
 /** 快速切换面板是否打开（不持久化；仅在打开时挂载，关闭即卸载）。 */
 quickSwitcherOpen: boolean;
 /** 终端聚焦序号：每次成功打开或聚焦终端 +1，让选择同一终端也能恢复 xterm 焦点。 */
 terminalFocusSeq: number;
 /** 打开一个新终端并聚焦（返回新 id）。`resume` = 以 `omp --resume` 恢复历史会话。 */
 openTerminal: (opts: {
  projectId: string | null;
  cwd: string;
  label: string;
  resume?: string | null;
 }) => string;
 focusTerminal: (id: string) => void;
 /** 选中工作区（V21；`id: null` = 未分组区）：范围切到整组，激活终端收敛到范围内最近一个。 */
 selectGroup: (id: string | null) => void;
 closeTerminal: (id: string) => void;
 setTerminalStatus: (id: string, status: TerminalStatus, code: number | null) => void;
 /**
  * OSC 0/2 标题到达时更新 tab：解析 `π <状态> <会话名>`（`lib/termTitle.ts`），
  * 落会话标题与 π 的状态；omp 的「还没有标题」回退值（cwd 末段目录名）落 null。
  * 标题帧率很高（工作态转轮每 80ms 一帧），解析后只有「名字或状态真的变了」才写 store。
  */
 setTerminalTitle: (id: string, title: string) => void;
 /** spawn 时把「实际挂上的协作根」写回（V21；tab 悬停提示用；无变化不写，避免多余渲染）。 */
 setTerminalCollab: (id: string, dirs: string[]) => void;
 /** 启动失败（omp 缺失 / cwd 不存在等）：进程没起来，π 直接落失败态。 */
 failTerminal: (id: string) => void;
 /** 重启已退出的终端：`spawnSeq + 1` 触发 TerminalPane 重新 spawn；状态回落未知（新进程还没开口）。 */
 restartTerminal: (id: string) => void;
 /** 等待确认关闭的终端 id（运行中终端的 × / ⌘W 都先落到这里，由 ConfirmDialog 收口）。 */
 closingTerminalId: string | null;
 /** 请求关闭：运行中 → 弹出确认；已退出 → 直接关。 */
 requestCloseTerminal: (id: string) => void;
 confirmCloseTerminal: () => void;
 cancelCloseTerminal: () => void;

 // ---------- V14 工作区「提交并推送」（omp commit 集成，见 lib/commitTasks.ts） ----------

 /**
  * 工作区 git 快照（行徽章）：有改动小点 / 待推送 `BranchUp` / 非仓库降级。
  * 刷新时机（启动 / 任务结束 / 窗口可见或获得焦点 / 终端转就绪 / 30s 兜底轮询）在 `App`
  * 与 `lib/commitTasks.ts`；面板里的变更集与提交前的暂存复查才是最终裁决。
  */
 workspaceGitStates: Record<string, WorkspaceGitState>;
 setWorkspaceGitStates: (states: WorkspaceGitState[]) => void;
 /**
  * 提交任务（按 cwd 存）：运行中关闭浮层 = 转后台（任务继续，行徽章指示）；
  * 失败任务保留到「重试 / 新任务 / 用户清除」，成功任务在关闭浮层时清除（git 快照接管）。
  */
 commitTasks: Record<string, CommitTaskView>;
 /** 浮层当前查看的任务（cwd）；null = 浮层关着（任务本身不受影响）。 */
 activeCommitCwd: string | null;
 setCommitTask: (task: CommitTaskView) => void;
 patchCommitTask: (cwd: string, patch: Partial<CommitTaskView>) => void;
 appendCommitLog: (cwd: string, line: string) => void;
 /** 追加生成流（快速轨的模型输出直接进编辑框；有上限，防异常输出撑爆 store）。 */
 appendCommitMessage: (cwd: string, text: string) => void;
 finishCommitTask: (cwd: string, outcome: CommitOutcome) => void;
 /** 清除任务记录（浮层关闭时对非运行中的任务调用；见 `lib/commitTasks.ts` 的 `closeCommitPanel`）。 */
 dropCommitTask: (cwd: string) => void;
 setActiveCommitCwd: (cwd: string | null) => void;
 /**
  * 提交信息语言偏好（**按项目 id**，V14 增补）：同一项目的主目录与全部 worktree 共用，
  * 项目之间互不影响。「记住选择」= `remembered`（已写 localStorage），未记住的只在本次
  * 运行期间生效。任务发起时由 `lib/commitTasks.ts` 解析成给模型的要求文本（快速轨进提示词、
  * 完整轨走 `omp commit --context=`，见 `src/lib/commitLang.ts`）。
  */
 commitLangPrefs: Record<string, CommitLangPref>;
 setCommitLangPref: (projectId: string, pref: CommitLangPref) => void;
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

/** 提交任务日志行数上限（保尾）：异常输出不撑爆 store；与后端的错误摘要上限（TAIL_MAX）不是一回事。 */
const COMMIT_LOG_MAX = 1000;
/** 生成流的字符上限（保尾）：模型跑飞时的兜底；后端解析结果本身也有 4000 字符上限。 */
const COMMIT_MSG_MAX = 8000;

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

 workspaceGroups: [],
 checkouts: [],
 terminals: [],
 activeTerminalId: null,
 selection: null,
 quickSwitcherOpen: false,
 terminalFocusSeq: 0,
 openTerminal: ({ projectId, cwd, label, resume = null }) => {
  const id = crypto.randomUUID();
  const term: TerminalView = {
   id,
   projectId,
   cwd,
   label,
   title: null,
   state: "unknown",
   status: "running",
   exitCode: null,
   resume,
   collab: [],
   spawnSeq: 0,
   createdAt: Date.now(),
  };
  const s = get();
  // 工作区视图里开的终端保持组视图（范围不缩窄——组内别的目录的终端不该从标签栏消失）；
  // 其余情况切到目录视图。未分组项目（group = null）与工作区一样按「组」比对。
  const keepGroup = s.selection?.kind === "group" && s.selection.id === checkoutGroupId(cwd, s.checkouts, s.projects)
   ? s.selection
   : null;
  set({
   terminals: [...s.terminals, term],
   activeTerminalId: id,
   selection: keepGroup ?? { kind: "checkout", path: cwd },
   terminalFocusSeq: s.terminalFocusSeq + 1,
   // 新终端必然切回终端视图（设置标签留在标签栏里）
   settingsTabActive: false,
  });
  return id;
 },
 focusTerminal: (id) =>
  set((s) => {
   const hit = s.terminals.find((t) => t.id === id);
   if (!hit) return {};
   // 终端已在当前范围里 → 只切激活（工作区视图点组内终端不缩窄视图）；
   // 范围外（⌘⇧K 跨组跳转）→ 切到它的目录视图。`scope === null`（不过滤）时不算越界。
   const scope = selectionScopePaths(s.selection, s.workspaceGroups, s.checkouts, s.projects);
   const inScope = scope === null || scope.has(hit.cwd);
   return {
    activeTerminalId: id,
    selection: inScope ? s.selection : { kind: "checkout", path: hit.cwd },
    terminalFocusSeq: s.terminalFocusSeq + 1,
    settingsTabActive: false,
   };
  }),
 selectGroup: (id) =>
  set((s) => {
   const scope = selectionScopePaths({ kind: "group", id }, s.workspaceGroups, s.checkouts, s.projects);
   const scoped = scope === null ? s.terminals : s.terminals.filter((t) => scope.has(t.cwd));
   // 激活终端收敛到新范围内最近一个（在范围内就保持不动——不让视图跳来跳去）
   const keep = s.activeTerminalId !== null && scoped.some((t) => t.id === s.activeTerminalId)
    ? s.activeTerminalId
    : scoped[scoped.length - 1]?.id ?? null;
   return { selection: { kind: "group", id }, activeTerminalId: keep };
  }),
 closeTerminal: (id) =>
  set((s) => {
   const idx = s.terminals.findIndex((t) => t.id === id);
   if (idx < 0) return {};
   const scope = selectionScopePaths(s.selection, s.workspaceGroups, s.checkouts, s.projects);
   const inScope = (t: TerminalView) => scope === null || scope.has(t.cwd);
   const terminals = s.terminals.filter((t) => t.id !== id);
   // 关闭当前 tab 后聚焦**同一范围**里相邻的一个（优先右邻，退回左邻）：
   // 右栏视图按选中项过滤，跳到范围外的终端等于把人从当前视图里踢出去；
   // 范围内都关完就交回空态（`selection` 不动，空态里能接着新建）。
   let activeTerminalId = s.activeTerminalId;
   if (activeTerminalId === id) {
    const siblings = terminals.filter(inScope);
    const at = s.terminals.slice(0, idx).filter(inScope).length;
    const next = siblings[Math.min(at, siblings.length - 1)] ?? null;
    activeTerminalId = next ? next.id : null;
   }
   // 最后一个终端也关掉时：设置标签开着就切过去（否则主区回到空态）
   const settingsTabActive = terminals.length === 0 && s.settingsTabOpen ? true : s.settingsTabActive;
   return { terminals, activeTerminalId, settingsTabActive };
  }),
 setTerminalStatus: (id, status, code) =>
  set((s) => ({
   terminals: s.terminals.map((t) =>
    t.id === id
     ? {
      ...t,
      status,
      exitCode: code,
      // 进程结局直接落定 π：正常退出（0 / 信号收尾）绿、异常退出红；回到运行中则回落未知
      state: status === "exited" ? (code == null || code === 0 ? "exited" : "failed") : "unknown",
     }
     : t,
   ),
  })),
 setTerminalTitle: (id, title) =>
  set((s) => {
   const t = s.terminals.find((x) => x.id === id);
   // 已退出 / 启动失败的不再接收标题：收尾阶段可能还有缓冲输出，别把终态改回去
   if (!t || t.status !== "running" || !title.trim()) return {};
   const { phase, label } = parseTermTitle(title);
   // 名字为空（`π ⠋`）= 这一帧没带名字，保留上一次的会话标题；
   // 名字 == cwd 末段目录名 = omp 的「会话还没有标题」回退值（是项目名，不是会话标题）→ 清掉，
   // 展示层回退到工作区显示名（`terminalDisplayName`）。
   const nextTitle = !label ? t.title : isWorkspaceNameFallback(label, t.cwd) ? null : label;
   if (t.title === nextTitle && t.state === phase) return {};
   return { terminals: s.terminals.map((x) => (x.id === id ? { ...x, title: nextTitle, state: phase } : x)) };
  }),
 setTerminalCollab: (id, dirs) =>
  set((s) => {
   const t = s.terminals.find((x) => x.id === id);
   if (!t) return {};
   if (t.collab.length === dirs.length && t.collab.every((d, i) => d === dirs[i])) return {};
   return { terminals: s.terminals.map((x) => (x.id === id ? { ...x, collab: dirs } : x)) };
  }),
 failTerminal: (id) =>
  set((s) => ({
   terminals: s.terminals.map((t) =>
    t.id === id ? { ...t, status: "exited", exitCode: null, state: "failed" } : t,
   ),
  })),
 restartTerminal: (id) =>
  set((s) => ({
   terminals: s.terminals.map((t) =>
    // 重启 = 新进程（可能带 --resume）：清掉旧会话标题，等新的 OSC 标题到达（回退到工作区名）
    t.id === id ? { ...t, title: null, status: "running", exitCode: null, spawnSeq: t.spawnSeq + 1, state: "unknown" } : t,
   ),
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

 // ---------- V19 工作区提交 / 推送（见 lib/commitTasks.ts） ----------

 workspaceGitStates: {},
 setWorkspaceGitStates: (states) =>
  set((s) => {
   const next = { ...s.workspaceGitStates };
   for (const st of states) next[st.path] = st;
   return { workspaceGitStates: next };
  }),
 commitTasks: {},
 activeCommitCwd: null,
 setCommitTask: (task) => set((s) => ({ commitTasks: { ...s.commitTasks, [task.cwd]: task } })),
 patchCommitTask: (cwd, patch) =>
  set((s) => {
   const t = s.commitTasks[cwd];
   if (!t) return {};
   return { commitTasks: { ...s.commitTasks, [cwd]: { ...t, ...patch } } };
  }),
 appendCommitLog: (cwd, line) =>
  set((s) => {
   const t = s.commitTasks[cwd];
   if (!t) return {};
   const log =
    t.log.length >= COMMIT_LOG_MAX
     ? [...t.log.slice(t.log.length - COMMIT_LOG_MAX + 1), line]
     : [...t.log, line];
   return { commitTasks: { ...s.commitTasks, [cwd]: { ...t, log } } };
  }),
 appendCommitMessage: (cwd, text) =>
  set((s) => {
   const t = s.commitTasks[cwd];
   if (!t) return {};
   const raw = t.message + text;
   // 生成流可能很长（模型跑飞）：保头也保尾没意义，直接截到上限（编辑框里本来就只是草稿）
   const message = raw.length <= COMMIT_MSG_MAX ? raw : raw.slice(raw.length - COMMIT_MSG_MAX);
   return { commitTasks: { ...s.commitTasks, [cwd]: { ...t, message } } };
  }),
 finishCommitTask: (cwd, outcome) =>
  set((s) => {
   const t = s.commitTasks[cwd];
   if (!t) return {};
   // 浮层关着时任务结束：**失败保留**（行徽章亮起，等用户查看），其余终态即清
   // （「待推送 / 已推送」由 git 快照的行徽章接管，不清会让行上失去入口）。
   if (s.activeCommitCwd !== cwd && outcome.phase !== "failed") {
    const next = { ...s.commitTasks };
    delete next[cwd];
    return { commitTasks: next };
   }
   return {
    commitTasks: {
     ...s.commitTasks,
     [cwd]: {
      ...t,
      phase: outcome.phase,
      commits: outcome.commits,
      // 生成的信息随终态回来（编辑框里可能只有流式原文，落定用解析后的那份）
      message: outcome.message ?? t.message,
      generated: t.generated || outcome.phase === "generated",
      error: outcome.error,
      hint: outcome.hint,
     },
    },
   };
  }),
 dropCommitTask: (cwd) =>
  set((s) => {
   if (!s.commitTasks[cwd]) return {};
   const next = { ...s.commitTasks };
   delete next[cwd];
   return { commitTasks: next };
  }),
 setActiveCommitCwd: (cwd) => set({ activeCommitCwd: cwd }),
 commitLangPrefs: loadCommitLangPrefs(),
 setCommitLangPref: (projectId, pref) => {
  // 内存态与已记住的盘上副本一起更新（未记住的项目写盘时会被过滤掉）
  const next = { ...get().commitLangPrefs, [projectId]: pref };
  saveCommitLangPrefs(next);
  set({ commitLangPrefs: next });
 },
}));
