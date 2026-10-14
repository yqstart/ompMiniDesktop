import { create } from "zustand";
import type { BtwRecord, CheckoutView, CommitOutcome, CommitTaskView, Goal, HealthInfo, ImageAttachment, ModelCatalog, OmpUpdate, OmpUpdateRun, ProjectView, QueuedMessages, RefPickerTarget, SessionRuntime, SessionStatus, SessionView, SubAgentInfo, TodoPhase, UpdateState, ViewMsg, WorkspaceGitState, WorkspaceView } from "@shared/types";
import type { Locale, LocaleMode } from "../lib/locale";
import { loadLocaleMode, resolveLocale, saveLocaleMode, systemLang } from "../lib/locale";
import { applyTheme, loadTheme, saveTheme, type ThemeMode } from "../lib/theme";
import { loadMyModels, saveMyModels } from "../lib/myModels";
import { loadCommitLangPrefs, saveCommitLangPrefs, type CommitLangPref } from "../lib/commitLang";

type AppState = {
 health: HealthInfo | null;
 /** 项目列表（覆盖层；工作区树由 `workspaces` 管）。 */
 projects: ProjectView[];
 /** 模型目录（设置页模型页签用；启动时静默加载一次）。 */
 models: ModelCatalog | null;
 /** 我的模型（本应用偏好，localStorage 持久化；模型选择器的候选范围，空 = 全部；见 src/lib/myModels.ts）。 */
 myModels: string[];
 setMyModels: (list: string[]) => void;
 /** 设置视图是否打开（v1 起：设置是覆盖主区的独立视图，不再是标签；关闭才卸载设置页）。 */
 settingsTabOpen: boolean;
 /** 主区当前显示的是设置视图（聊天视图保持挂载，只切显隐）。 */
 settingsTabActive: boolean;
 /** 设置视图内搜索是否展开（v3：顶部搜索 / ⌘F；关闭设置视图时复位）。 */
 settingsSearchOpen: boolean;
 /** 打开设置视图（已打开则只切过去；搜索复位到折叠态）。 */
 openSettingsTab: () => void;
 /** 关闭设置视图：主区回到聊天视图（搜索一并复位）。 */
 closeSettingsTab: () => void;
 sidebarOpen: boolean;
 update: UpdateState;
 updateDismissedVersion: string | null;
 /** 更新弹窗显隐（入口 = 左栏字标行的应用版本 chip；弹窗可单独关闭=稍后）。 */
 updateDialogOpen: boolean;
 /**
  * omp 运行时更新检查状态（`lib/ompUpdate.ts`；左栏字标行的版本 chip 与详情弹窗用）。
  * 与本应用的 `update` 互不相干：那条走 Tauri updater，这条跑 `omp update --check`。
  */
 ompUpdate: OmpUpdate;
 /** omp 更新详情弹窗显隐（App 常驻挂载，由字标行的版本 chip 打开）。 */
 ompUpdateDialogOpen: boolean;
 /**
  * 正在跑 / 刚跑完的 `omp update`（V24；null = 本次运行还没发起过）。
  * 日志有上限（见 `lib/ompUpdate.ts` 的 `OMP_UPDATE_LOG_MAX`）；终态保留到下次发起，
  * 失败 / 取消可以直接重试。
  */
 ompUpdateRun: OmpUpdateRun | null;
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
 /** 右侧上下文面板是否展开（v2 三栏；localStorage 持久化，**默认收起**——首启不自动展开）。
  *  面板始终停靠为主区第三栏：打开 = 布局变三栏，会话列让位、不被遮盖。 */
 contextPanelOpen: boolean;
 setContextPanelOpen: (v: boolean) => void;

 // ---------- 聊天形态（v1 起唯一形态） ----------

 /**
  * 已知的聊天会话视图（新建 / 打开 / 侧栏扫描 / 归档恢复时补进；顶栏标题与上下文条从这里取）。
  * 不是「全部会话」的镜像——会话列表仍在 `list_sessions`（侧栏按需拉）。
  */
 sessions: SessionView[];
 /** 当前在聊天视图里打开的会话 id。 */
 activeSessionId: string | null;
 /** 会话消息流（ViewMsg 归一；高频流式增量只改这里）。 */
 eventsBySession: Record<string, ViewMsg[]>;
 /** 会话运行状态（`omp-status://<id>` 事件的落点；状态胶囊 / 通知用）。 */
 statusBySession: Record<string, SessionStatus>;
 /** 输入草稿（按会话隔离，内存态）。 */
 drafts: Record<string, string>;
 /** 待发送图片附件（按会话隔离，只存在内存里，发送成功即清空）。 */
 attachmentsBySession: Record<string, ImageAttachment[]>;
 /** 待发队列真值（V40）：`queue_update` 帧与运行时回读的落点（omp 侧是权威，可撤回 / 提升）。 */
 queuedBySession: Record<string, QueuedMessages>;
 /** goal 目标模式状态（V40）：`goal_updated` 帧与回读的落点；null = 没有目标。 */
 goalBySession: Record<string, Goal | null>;
 /** 子代理注册表（V41）：`subagent_lifecycle` 帧与打开会话时 `get_subagents` 补拉的落点。 */
 subagentsBySession: Record<string, SubAgentInfo[]>;
 /** 当前会话的模型 selector（`provider/id`；工具行选择器显示与用量入口用）。 */
 currentModel: string | null;
 /** 当前思考档（omp 真值回填；null = 未知）。 */
 currentThinking: string | null;
 /** 当前模型可用思考档（omp 真值；null = 不支持思考）。驱动思考档下拉只列支持项。 */
 currentEfforts: string[] | null;
 /** 当前会话的运行时真值快照（上下文占用 / 本轮用量 / 耗时）：状态条纯透传的数据源。 */
 currentRuntime: SessionRuntime | null;
 /**
  * 完成未读标记（v2 左栏状态标）：会话在**后台跑完一轮**、用户还没打开过它。
  * 由左栏列表刷新时对比 running 快照产生（前后台状态真值只有列表里有），打开会话即清。
  * 运行期状态，不持久化（重启后「未读」没有意义）。
  */
 unreadBySession: Record<string, true>;
 markUnread: (sid: string) => void;
 clearUnread: (sid: string) => void;
 /** 任务计划（`todoPhases` 真值 + `todo_reminder` 事件合并，按会话隔离；只读展示）。 */
 plansBySession: Record<string, TodoPhase[]>;
 /** 会话级权限覆盖（覆盖层 `sessionApproval` 的水合；徽标显示用）。 */
 sessionApprovals: Record<string, string>;
 /** 输入卡内的下拉互斥槽：同一时刻只开一个（model/approval/plus/project/branch/context/usage）。 */
 composerMenu: "model" | "approval" | "plus" | "project" | "branch" | "context" | "usage" | null;
 /** 消息流「首屏增量」窗口：当前会话已渲染的消息条数（首屏 200 条）。 */
 threadLimitSid: string | null;
 threadLimit: number;
 draftOf: (sid: string | null) => string;
 setDraft: (sid: string | null, text: string) => void;
 attachmentsOf: (sid: string | null) => ImageAttachment[];
 addAttachments: (sid: string | null, items: ImageAttachment[]) => void;
 removeAttachment: (sid: string | null, index: number) => void;
 clearAttachments: (sid: string | null) => void;
 queuedOf: (sid: string | null) => QueuedMessages;
 /** 队列快照写入（`queue_update` 帧 / 运行时回读的唯一入口）。 */
 applyQueue: (sid: string, q: QueuedMessages) => void;
 goalOf: (sid: string | null) => Goal | null;
 /** goal 状态写入（`goal_updated` 帧 / 回读的唯一入口）。 */
 setGoal: (sid: string, goal: Goal | null) => void;
 subagentsOf: (sid: string | null) => SubAgentInfo[];
 /** upsert 一个子代理（生命周期帧；按 id 覆盖全量字段）。 */
 upsertSubagent: (sid: string, info: SubAgentInfo) => void;
 /** 整表替换（打开会话时的 `get_subagents` 补拉；不动已有 running 条目——注册表可能滞后于帧）。 */
 setSubagents: (sid: string, list: SubAgentInfo[]) => void;
 /** 会话导航（⌘[ / ⌘]，V40）：打开过的会话顺序栈（新的在后，上限 50）。 */
 navStack: string[];
 /** 栈内当前位置（-1 = 空）。 */
 navIdx: number;
 /** 打开会话时压栈；返回导航目标（`navStep`）由调用方打开。 */
 pushNav: (sid: string) => void;
 /** 前后一步（-1 后退 / +1 前进）；返回目标会话 id（没有则 null，调用方不动）。 */
 navStep: (dir: -1 | 1) => string | null;
 /** 执行模式切换的挂起重启标记（V40）：running 时切档挂标记，idle 收敛后自动重启生效。 */
 approvalRestartBySession: Record<string, true>;
 markApprovalRestart: (sid: string) => void;
 clearApprovalRestart: (sid: string) => void;
 /** 旁问面板状态（V40；`/btw` 与划选「旁问」的落点）。 */
 btw: BtwPanelState;
 setBtw: (p: Partial<BtwPanelState>) => void;
 /** 消息流查找条显隐（⌘F，V40）。 */
 findOpen: boolean;
 setFindOpen: (v: boolean) => void;
 /** 查找条查询串（V40）：放 store 统一「关闭即清 / 切会话自然隔离」（组件本地态会被 lint 的级联渲染规则挡住）。 */
 findQuery: string;
 /** 查询串所属会话（切会话后旧查询不生效——FindBar 按 `findQuerySid === activeSessionId` 取）。 */
 findQuerySid: string | null;
 setFindQuery: (q: string) => void;
 /** 全局执行模式档（omp `tools.approvalMode`；启动与切换时落 store，Shift+Tab 循环读它）。 */
 globalApproval: string;
 setGlobalApproval: (mode: string) => void;
 /** 会话统计弹窗显隐（`/status` 与上下文面板入口；V40）。 */
 statsOpen: boolean;
 setStatsOpen: (v: boolean) => void;
 /** 文件改动弹窗的目标路径（工具卡「查看改动」按钮；null = 关闭；V40）。 */
 diffPath: string | null;
 setDiffPath: (path: string | null) => void;
 /** 新建会话（左栏主命令 / ⌘T）的最新失败文案：两处入口共用左栏内联错误条这一个渲染面，
  *  免得「点了没反应」（`null` = 无提示；成功或用户关掉即清）。 */
 newChatError: string | null;
 setNewChatError: (message: string | null) => void;
 /** 命令中心（⌘K，V41）：聊天形态的全局动作面板开关。 */
 paletteOpen: boolean;
 setPaletteOpen: (v: boolean) => void;
 appendEvents: (sid: string, msgs: ViewMsg[]) => void;
 /** 展开更早的消息（按页递增）；打开新会话时由 openSessionWithHistory 重置。 */
 growThreadLimit: (by: number) => void;
 resetThreadLimit: (sid: string) => void;

 // ---------- 工作区容器与引用浮层（见 lib/workspaceGroups.ts / lib/checkouts.ts） ----------

 /** 工作区清单（V21 多项目容器；`lib/checkouts.ts` 的 `loadCheckouts` 是唯一刷新入口，与目录行一起拉）。 */
 workspaceGroups: WorkspaceView[];
 /** 目录行清单（项目主目录 + git worktree；同上，唯一刷新入口）。 */
 checkouts: CheckoutView[];
 /** 「供应商用量」弹窗是否打开（V15；入口 = 聊天顶栏右端的 `Gauge` 键，只在打开时挂载）。 */
 providerUsageOpen: boolean;
 /** 引用工作区文件浮层（V22）的目标（null = 关闭；只在打开时挂载）：
  *  注入目标 = 该会话的 Composer 草稿（追加 `@<绝对路径> `，焦点随后交还输入框）。 */
 refPickerTarget: RefPickerTarget | null;
 /** Composer 聚焦序号：引用浮层注入草稿后 +1，让输入框拿回焦点接着写。 */
 composerFocusSeq: number;

 // ---------- V14 工作区「提交并推送」（omp commit 集成，见 lib/commitTasks.ts） ----------

 /**
  * 工作区 git 快照（行徽章）：有改动小点 / 待推送 `BranchUp` / 非仓库降级。
  * 刷新时机（启动 / 任务结束 / 窗口可见或获得焦点 / 30s 兜底轮询）在 `App`
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
/** 消息流单页条数：首屏只渲染最后 200 条，其余按需向上加载（MASTER §7）。 */
export const THREAD_PAGE = 200;

/**
 * 旁问面板状态（V40，`/btw` 与划选「旁问」的落点）。
 * 面板是单会话单通道：omp 每个会话同一时刻只跑一个旁问（运行中不允许再开）。
 */
export type BtwPanelState = {
 open: boolean;
 sessionId: string | null;
 /** 话题记录（最新在前；omp `get_btw_history` 口径；运行中的记录带部分答案）。 */
 records: BtwRecord[];
 /** 正在流式作答的记录 id（该条显示为运行中 + 取消按钮）。 */
 busyRecordId: string | null;
 /** 输入框草稿（放 store：划选「旁问」的预填与新打开面板都直接写它，组件无本地拷贝）。 */
 draft: string;
 /** 最近一次提问失败信息（成功提问 / 关闭面板时清）。 */
 error: string | null;
};

const BTW_CLOSED: BtwPanelState = { open: false, sessionId: null, records: [], busyRecordId: null, draft: "", error: null };
export const EMPTY_QUEUE: QueuedMessages = { steering: [], followUp: [] };
/** 无子代理时的稳定空引用（选择器返回同引用，避免无谓重渲染）。 */
export const EMPTY_SUBAGENTS: SubAgentInfo[] = [];
/** 形态概念随 v1 退场（聊天是唯一形态）：启动时清掉旧的 localStorage 键。 */
try {
 localStorage.removeItem("omp.appMode.v1");
} catch {
 // 无痕模式等取不到持久化：无须清理
}

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

/** 右上下文面板的初始展开态（v2）：**默认收起**（首次启动不自动占位），用户展开后记住。 */
function loadContextPanelOpen(): boolean {
 try {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem("omp.contextPanel.v1") === "1";
 } catch {
  return false;
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
 settingsSearchOpen: false,
 openSettingsTab: () => set({ settingsTabOpen: true, settingsTabActive: true, settingsSearchOpen: false }),
 closeSettingsTab: () => set({ settingsTabOpen: false, settingsTabActive: false, settingsSearchOpen: false }),
 sidebarOpen: false,
 update: { status: "idle" },
 updateDismissedVersion: null,
 updateDialogOpen: false,
 ompUpdate: { status: "idle", current: null, latest: null, channel: null, message: null, checkedAt: null },
 ompUpdateDialogOpen: false,
 ompUpdateRun: null,
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
 contextPanelOpen: loadContextPanelOpen(),
 setContextPanelOpen: (v) => {
  try {
   localStorage.setItem("omp.contextPanel.v1", v ? "1" : "0");
  } catch {
   // 持久化失败不阻断本次切换
  }
  set({ contextPanelOpen: v });
 },

 // ---------- 聊天形态（v1 起唯一形态） ----------

 sessions: [],
 activeSessionId: null,
 eventsBySession: {},
 statusBySession: {},
 drafts: {},
 attachmentsBySession: {},
 queuedBySession: {},
 goalBySession: {},
 subagentsBySession: {},
 navStack: [],
 navIdx: -1,
 approvalRestartBySession: {},
 btw: BTW_CLOSED,
 findOpen: false,
 findQuery: "",
 findQuerySid: null,
 globalApproval: "write",
 statsOpen: false,
 diffPath: null,
 newChatError: null,
 paletteOpen: false,
 currentModel: null,
 currentThinking: null,
 currentEfforts: null,
 currentRuntime: null,
 unreadBySession: {},
 markUnread: (sid) =>
  set((s) => (s.unreadBySession[sid] ? {} : { unreadBySession: { ...s.unreadBySession, [sid]: true } })),
 clearUnread: (sid) =>
  set((s) => {
   if (!s.unreadBySession[sid]) return {};
   const next = { ...s.unreadBySession };
   delete next[sid];
   return { unreadBySession: next };
  }),
 plansBySession: {},
 sessionApprovals: {},
 composerMenu: null,
 threadLimitSid: null,
 threadLimit: THREAD_PAGE,
 draftOf: (sid) => (sid ? get().drafts[sid] ?? "" : ""),
 setDraft: (sid, text) =>
  set((s) => (sid ? { drafts: { ...s.drafts, [sid]: text } } : {})),
 attachmentsOf: (sid) => (sid ? get().attachmentsBySession[sid] ?? [] : []),
 addAttachments: (sid, items) =>
  set((s) =>
   sid && items.length > 0
    ? { attachmentsBySession: { ...s.attachmentsBySession, [sid]: [...(s.attachmentsBySession[sid] ?? []), ...items] } }
    : {},
  ),
 removeAttachment: (sid, index) =>
  set((s) => {
   if (!sid) return {};
   const cur = s.attachmentsBySession[sid] ?? [];
   return { attachmentsBySession: { ...s.attachmentsBySession, [sid]: cur.filter((_, i) => i !== index) } };
  }),
 clearAttachments: (sid) =>
  set((s) => (sid ? { attachmentsBySession: { ...s.attachmentsBySession, [sid]: [] } } : {})),
 queuedOf: (sid) => (sid ? get().queuedBySession[sid] ?? EMPTY_QUEUE : EMPTY_QUEUE),
 applyQueue: (sid, q) => set((s) => ({ queuedBySession: { ...s.queuedBySession, [sid]: q } })),
 goalOf: (sid) => (sid ? get().goalBySession[sid] ?? null : null),
 setGoal: (sid, goal) => set((s) => ({ goalBySession: { ...s.goalBySession, [sid]: goal } })),
 subagentsOf: (sid) => (sid ? get().subagentsBySession[sid] ?? EMPTY_SUBAGENTS : EMPTY_SUBAGENTS),
 upsertSubagent: (sid, info) =>
  set((s) => {
   const cur = s.subagentsBySession[sid] ?? [];
   const idx = cur.findIndex((x) => x.id === info.id);
   const next = idx >= 0 ? cur.map((x) => (x.id === info.id ? info : x)) : [...cur, info];
   return { subagentsBySession: { ...s.subagentsBySession, [sid]: next } };
  }),
 setSubagents: (sid, list) =>
  set((s) => {
   const cur = s.subagentsBySession[sid] ?? [];
   // 合并口径：以补拉为准，但保留补拉里没有的 running 条目（帧比注册表快是常态）
   const byId = new Map(list.map((x) => [x.id, x]));
   const next = [...list.map((x) => byId.get(x.id) ?? x)];
   for (const x of cur) {
    if (x.status === "running" && !byId.has(x.id)) next.push(x);
   }
   return { subagentsBySession: { ...s.subagentsBySession, [sid]: next } };
  }),
 pushNav: (sid) => {
  if (!sid) return;
  const { navStack, navIdx } = get();
  if (navIdx >= 0 && navStack[navIdx] === sid) return;
  const trimmed = navIdx >= 0 ? navStack.slice(0, navIdx + 1) : [];
  const next = [...trimmed.filter((x) => x !== sid), sid].slice(-50);
  set({ navStack: next, navIdx: next.length - 1 });
 },
 navStep: (dir) => {
  const { navStack, navIdx } = get();
  const next = navIdx + dir;
  if (next < 0 || next >= navStack.length) return null;
  set({ navIdx: next });
  return navStack[next];
 },
 markApprovalRestart: (sid) => set((s) => ({ approvalRestartBySession: { ...s.approvalRestartBySession, [sid]: true } })),
 clearApprovalRestart: (sid) =>
  set((s) => {
   if (!(sid in s.approvalRestartBySession)) return {};
   const next = { ...s.approvalRestartBySession };
   delete next[sid];
   return { approvalRestartBySession: next };
  }),
 setBtw: (p) => set((s) => ({ btw: { ...s.btw, ...p } })),
 setFindOpen: (v) => set(v ? { findOpen: true } : { findOpen: false, findQuery: "", findQuerySid: null }),
 setFindQuery: (q) => set((s) => ({ findQuery: q, findQuerySid: s.activeSessionId })),
 setGlobalApproval: (mode) => set({ globalApproval: mode }),
 setStatsOpen: (v) => set({ statsOpen: v }),
 setDiffPath: (path) => set({ diffPath: path }),
 setNewChatError: (message) => set({ newChatError: message }),
 setPaletteOpen: (v) => set({ paletteOpen: v }),
 appendEvents: (sid, msgs) =>
  set((s) => ({ eventsBySession: { ...s.eventsBySession, [sid]: [...(s.eventsBySession[sid] ?? []), ...msgs] } })),
 growThreadLimit: (by) => set((s) => ({ threadLimit: s.threadLimit + by })),
 resetThreadLimit: (sid) => set({ threadLimitSid: sid, threadLimit: THREAD_PAGE }),

 // ---------- 工作区容器与引用浮层 ----------

 workspaceGroups: [],
 checkouts: [],
 providerUsageOpen: false,
 refPickerTarget: null,
 composerFocusSeq: 0,

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
