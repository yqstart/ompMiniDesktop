import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useApp, SIDEBAR_MAX, SIDEBAR_MIN } from "../stores/app";
import { applyTheme } from "../lib/theme";
import { useText } from "../lib/useText";
import { api } from "@shared/api";
import { IPC } from "@shared/ipc";
import type { ModelCatalog } from "@shared/types";
import { ChatSidebar } from "../components/sidebar/ChatSidebar";
import { ReferencePicker } from "../components/ReferencePicker";
import { CommandPalette } from "../components/CommandPalette";
import { CommitTaskPanel } from "../components/git/CommitTaskPanel";
import { HealthBanner } from "../components/HealthBanner";
import { SettingsPage } from "../components/SettingsPage";
import { ChatView } from "../components/thread/ChatView";
import { ContextPanel } from "../components/panel/ContextPanel";
import { UpdateDialog } from "../components/update/UpdateDialog";
import { OmpUpdateDialog } from "../components/update/OmpUpdateDialog";
import { ProviderUsageDialog } from "../components/usage/ProviderUsageDialog";
import { newChatInDefaultCheckout } from "../lib/checkouts";
import { openSessionWithHistory } from "../lib/sessionOpen";
import { refreshWorkspaceGitState, startWorkspaceGitPolling } from "../lib/commitTasks";
import { autoCheckOnBoot } from "../lib/appUpdate";
import { autoCheckOmpUpdate } from "../lib/ompUpdate";
import { loadApprovalState } from "../lib/sessionApproval";
import { ensureOmpDefaultThinking } from "../lib/thinkingDefault";
import { syncTitlePromptLanguage } from "../lib/titlePrompt";
import { hasOpenDialog, useDialogFocus } from "../lib/useDropdown";
import { isMacKeyboard } from "../lib/platform";

/** 皮肤落 class（浅色 token 是 `:root` 默认、深色挂在 `.dark`，见 src/index.css）。
 *  显式选深/浅时不听系统——系统偏好变了也不该动用户手动选的档。 */
function useTheme() {
 const theme = useApp((s) => s.theme);
 useEffect(() => {
  applyTheme(theme);
  if (theme !== "system") return;
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => applyTheme(theme);
  mq.addEventListener("change", apply);
  return () => mq.removeEventListener("change", apply);
 }, [theme]);
}

/** 界面语言：`system` 档跟随系统语言（与皮肤同模式）——WebView 的系统 UI 语言变了就重新解析一次。
 *  实际语言与 `<html lang>` 的落点在 `stores/app.ts` 的 `setLocaleMode`。 */
function useLocale() {
 const localeMode = useApp((s) => s.localeMode);
 const setLocaleMode = useApp((s) => s.setLocaleMode);
 useEffect(() => {
  if (localeMode !== "system") return;
  const apply = () => setLocaleMode("system");
  window.addEventListener("languagechange", apply);
  return () => window.removeEventListener("languagechange", apply);
 }, [localeMode, setLocaleMode]);
}

/**
 * 会话标题语言（V18）：界面语言落定（含启动）后，把语言同步给 omp 的自动标题 prompt
 * （`<agentDir>/TITLE_SYSTEM.md`，见 `lib/titlePrompt.ts`）——omp 只在**会话启动**时读它，
 * 所以切语言对**新开的会话**生效，已开的会话保持原语言（上游口径，壳侧不代偿）。
 * 等健康检查把 agentDir 解析出来再写：非默认 profile / `PI_CONFIG_DIR` 下两者路径不同。
 */
function useTitlePromptSync() {
 const locale = useApp((s) => s.locale);
 const agentDir = useApp((s) => s.health?.omp.agentDir);
 useEffect(() => {
  if (!agentDir) return;
  void syncTitlePromptLanguage(locale);
 }, [agentDir, locale]);
}

/**
 * 工作区 git 快照的刷新时机——启动 / 工作区清单变化 / 窗口转可见或重新获得焦点 /
 * **可见时 30s 兜底轮询**。任务结束后的单点刷新在 `lib/commitTasks.ts` 里；
 * 点按钮时的**后端预检**才是最终裁决。
 */
function useWorkspaceGitRefresh() {
 const checkouts = useApp((s) => s.checkouts);

 useEffect(() => {
  void refreshWorkspaceGitState(checkouts.map((w) => w.path));
 }, [checkouts]);

 useEffect(() => {
  // 转可见与重新获得焦点（点回本应用）都刷一轮：徽章是「现在有没有东西要处理」的提示
  const onVisible = () => {
   if (!document.hidden) void refreshWorkspaceGitState();
  };
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  return () => {
   document.removeEventListener("visibilitychange", onVisible);
   window.removeEventListener("focus", onVisible);
  };
 }, []);

 // 兜底轮询：会话里的 git 活动（agent 或手敲）不改变任何前端状态，等不到「转就绪」那个时机
 useEffect(() => startWorkspaceGitPolling(), []);
}

/**
 * 全局快捷键（v2；非 mac 平台用 Ctrl）：⌘, 打开设置 / ⌘T 新建聊天 / ⌘W 关设置 /
 * ⌘F 会话内查找（设置视图内 = 聚焦设置搜索）/ ⌘K 命令中心 / ⌘⇧G 上下文面板 /
 * ⌘[ ⌘] 会话导航 / ⌘⇧P 引用工作区文件。
 */
function useHotkeys() {
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (e.defaultPrevented || e.isComposing || e.altKey) return;
   const mod = isMacKeyboard() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
   if (!mod) return;
   const key = e.key.toLowerCase();
   const s = useApp.getState();
   // ⌘F / ⌘K / ⌘[ / ⌘]（会话内动作）、⌘⇧P（引用浮层）与 ⌘,（打开设置）即使焦点在输入框里也要生效——
   // 聊天常态就是在 Composer 里打字，被 typing 守卫吞掉等于入口断掉；
   // 其余组合键（⌘T / ⌘W）输入中只阻断不执行。
   const chatKey = key === "f" || key === "[" || key === "]" || key === "k" || (key === "g" && e.shiftKey);
   const refPick = key === "p" && e.shiftKey;
   const openSettings = key === ",";
   const owned = chatKey || refPick || openSettings || key === "t" || key === "w";
   if (!owned) return;
   const el = document.activeElement;
   const typing = el instanceof HTMLElement && !!el.closest("input, textarea, select, [contenteditable='true']");
   // 识别到本应用组合键就先截获，避免浏览器默认行为；模态或输入中只阻断不执行。
   e.preventDefault();
   e.stopPropagation();
   if (e.repeat || hasOpenDialog() || (typing && !refPick && !chatKey && !openSettings)) return;
   if (openSettings) {
    // ⌘, 打开设置（Codex 口径；已打开则只切过去——与系统惯例一致，不做 toggle）
    if (!s.settingsTabActive) s.openSettingsTab();
    return;
   }
   if (key === "w") {
    // ⌘W 只关设置视图（v1 收敛口径；输入中由上面的 typing 守卫挡住）
    if (s.settingsTabActive) s.closeSettingsTab();
    return;
   }
   if (key === "t") {
    // 新建会话（v2）：目标 = 当前会话所在目录，没有当前会话时用第一个可用项目主目录；
    // 失败进左栏内联错误条（与左栏同名入口共用一处），不再「点了没反应」
    void newChatInDefaultCheckout().then((r) => useApp.getState().setNewChatError(r.ok ? null : r.message));
    return;
   }
   if (refPick) {
    // 引用工作区文件（V22；注入 Composer 草稿）：设置视图激活 / 没有会话时不触发
    if (s.settingsTabActive || !s.activeSessionId) return;
    s.set({ refPickerTarget: { sessionId: s.activeSessionId } });
    return;
   }
   // 设置视图内（v3）：⌘F = 展开并聚焦设置搜索；⌘K / ⌘[ / ⌘] 等会话内动作不抢这几个键
   if (s.settingsTabActive) {
    if (key === "f") s.set({ settingsSearchOpen: true });
    return;
   }
   if (key === "f") {
    // 会话内查找：没有会话时无处可查，不打开横条
    if (s.activeSessionId) s.setFindOpen(true);
   } else if (key === "k") {
    // 命令中心（V41）：再按一次收起（toggle）
    s.setPaletteOpen(!s.paletteOpen);
   } else if (key === "g" && e.shiftKey) {
    // 右上下文面板开关（v2 §5）：面板始终停靠为第三栏，切换只影响这一栏在不在
    s.setContextPanelOpen(!s.contextPanelOpen);
   } else {
    // 会话导航栈：空栈 / 到头由 `navStep` 返回 null（此时什么都不做）
    const id = s.navStep(key === "[" ? -1 : 1);
    if (id) void openSessionWithHistory(id);
   }
  };
  window.addEventListener("keydown", onKey, true);
  return () => window.removeEventListener("keydown", onKey, true);
 }, []);
}

/** 左侧栏外壳：桌面端可左右拖拽调宽（292–480px，持久化）；窄窗（<768px）收起为抽屉。 */
function SidebarShell({
 width,
 onResize,
 children,
}: {
 width: number;
 onResize: (w: number) => void;
 children: React.ReactNode;
}) {
 const dragging = useRef(false);
 const t = useText();
 const { sidebarOpen, set } = useApp();
 const shellRef = useRef<HTMLDivElement>(null);
 // hover 才加宽热区：平时 3px 隐身细条，悬停/拖拽时 6px 好抓
 const [hot, setHot] = useState(false);
 // 拖拽中的视觉态用 state 表达（render 里不许读 ref），ref 只在事件/effect 里做快速判断
 const [draggingUi, setDraggingUi] = useState(false);
 const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);

 useEffect(() => {
  const move = (e: PointerEvent) => {
   if (!dragging.current) return;
   const clamped = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(e.clientX)));
   onResize(clamped);
  };
  const up = () => {
   dragging.current = false;
   setDraggingUi(false);
   document.body.style.cursor = "";
   document.body.style.userSelect = "";
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  return () => {
   window.removeEventListener("pointermove", move);
   window.removeEventListener("pointerup", up);
  };
 }, [onResize]);

 useEffect(() => {
  const query = window.matchMedia("(max-width: 767px)");
  const onChange = () => {
   setNarrow(query.matches);
   if (!query.matches) set({ sidebarOpen: false });
  };
  onChange();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
 }, [set]);

 useDialogFocus(shellRef, narrow && sidebarOpen, () => set({ sidebarOpen: false }));
 const closeDrawer = () => set({ sidebarOpen: false });

 return (
  <>
   {/* 同一份侧栏子树：桌面用宽度容器，窄窗定位态态态组件重现挂载。 */}
   <div
    ref={shellRef}
    role={narrow && sidebarOpen ? "dialog" : undefined}
    aria-modal={narrow && sidebarOpen ? true : undefined}
    aria-label={narrow && sidebarOpen ? t.workspaceTitle : undefined}
    tabIndex={narrow && sidebarOpen ? -1 : undefined}
    className={narrow
     ? sidebarOpen
      ? "fixed inset-0 z-20 md:hidden"
      : "hidden"
     : "relative hidden shrink-0 md:block"}
    style={narrow ? undefined : { width }}
   >
    {narrow && sidebarOpen && (
     <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} aria-hidden />
    )}
    <div className={narrow
     ? "absolute top-0 left-0 h-full w-[min(292px,calc(100vw-24px))] overflow-hidden rounded-r-lg bg-sidebar shadow-dialog"
     : "h-full w-full"}>
     {children}
    </div>
    {!narrow && (
     <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t.resizeSidebar}
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onKeyDown={(e) => {
       if (e.key === "ArrowLeft") onResize(width - 8);
       if (e.key === "ArrowRight") onResize(width + 8);
      }}
      onPointerDown={(e) => {
       dragging.current = true;
       setDraggingUi(true);
       document.body.style.cursor = "col-resize";
       document.body.style.userSelect = "none";
       (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => {
       if (!dragging.current) setHot(false);
      }}
      className={`absolute top-0 right-0 z-10 h-full cursor-col-resize touch-none transition-colors focus-visible:outline-none ${hot || draggingUi ? "w-1.5 bg-accent/45" : "w-[3px] bg-transparent"
       }`}
     />
    )}
   </div>
  </>
 );
}
export function App() {
 const { settingsTabOpen, settingsTabActive, set, sidebarWidth, setSidebarWidth, updateDialogOpen, ompUpdateDialogOpen, sidebarOpen, providerUsageOpen, refPickerTarget, paletteOpen } = useApp();
 const t = useText();
 useTheme();
 useLocale();
 useHotkeys();
 useWorkspaceGitRefresh();
 useTitlePromptSync();

 useEffect(() => {
  // 启动静默检查应用更新：检查中转轮、结论落 chip（已最新绿点 / 有新版本 accent / 失败 warn）；
  // 有新版本才弹窗（本轮已「稍后」过则只留 chip 状态），不打断
  void autoCheckOnBoot();
 }, []);

 useEffect(() => {
  // 启动就水合执行模式真值（覆盖层的本会话覆盖 + omp 全局默认档）：输入卡上的档位显示读它。
  // 读不到就停在「未知」——**不许拿某一档兜底**（兜底 = 显示与 omp 实际生效的不一致）。
  void loadApprovalState();
 }, []);

 useEffect(() => {
  // 启动就读 omp 的默认思考档（`defaultThinkingLevel`）：思考档选择器的默认显示与兜底档读它
  // （见 `lib/thinkingDefault.ts`）。读不到退回最高档兜底，打开思考档菜单时自然重试。
  void ensureOmpDefaultThinking();
 }, []);

 useEffect(() => {
  // 启动就把模型目录拉进 store（后台、静默、失败无所谓）：设置页模型页签用它。
  // 后端把拉取收敛成单飞 + 缓存（`omp models --json` 实测 2–10s），这里不阻塞任何界面。
  api
   .getModels()
   .then((models) => set({ models }))
   .catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
  // 目录快照刷新完成（冷启动真拉 / 过期后台刷新 / 手动刷新）：后端广播整份快照，
  // 这里直接换掉 store——设置页（模型 / 供应商）据此原地更新，不必自己轮询重拉。
  let active = true;
  const un = listen<ModelCatalog>(IPC.modelsRefreshed, (e) => {
   if (active) set({ models: e.payload });
  });
  return () => {
   active = false;
   void un.then((dispose) => dispose()).catch(() => undefined);
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
  api
   .getHealth()
   .then((health) => {
    set({ health });
    // omp 在就顺手静默查一次它的新版本（单飞 + 5 分钟冷却在 lib 里；失败只落状态不打扰）
    if (health.omp.ompPath) void autoCheckOmpUpdate();
   })
   .catch(() =>
    set({
     health: {
      omp: { ompPath: null, ompVersion: null, agentDir: "", errors: [t.healthCheckFailed] },
      modelsError: t.healthCheckFailed,
      ok: false,
     },
    }),
   );
  // 项目与工作区由侧栏统一拉取；App 只负责健康与模型，避免重复请求覆盖侧栏错误态。
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 return (
  <div className="flex h-screen overflow-hidden bg-sidebar text-sm text-foreground">
   <SidebarShell
    width={sidebarWidth}
    onResize={(w) => {
     if (w !== sidebarWidth) setSidebarWidth(w);
    }}
   >
    {/* 左栏 = 聊天侧栏（v1 起唯一形态；工作区标题行 + 搜索 + 按工作区分段 + 拖拽排序） */}
    <ChatSidebar />
   </SidebarShell>
   <main inert={sidebarOpen ? true : undefined} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:border-border">
    <HealthBanner />
    {/* 聊天主区**常驻挂载、只切显隐**：切去设置视图只是 CSS 隐藏——
        卸载会断事件订阅（切走期间到达的帧就丢了），切回来还要重建滚动位置。
        设置视图激活时这个兄弟列也要一起收起：它自带 flex-1，留着会跟设置视图平分
        main 的高度（顶部凭空多出半屏空白）。 */}
    <div className={settingsTabActive ? "hidden" : "flex min-h-0 min-w-0 flex-1"}>
     <ChatView visible={!settingsTabActive} />
     {/* 右栏上下文面板（v2 三栏）：设置视图打开时整栏退场；打开即停靠为第三栏（不遮盖会话） */}
     {!settingsTabActive && <ContextPanel />}
    </div>
    {settingsTabOpen && <SettingsPage visible={settingsTabActive} />}
   </main>
   <CommitTaskPanel />
   {updateDialogOpen && <UpdateDialog />}
   {ompUpdateDialogOpen && <OmpUpdateDialog />}
   {/* 命令中心（⌘K，V41）：聊天动作 + 会话搜索面板；打开才挂载、关闭即卸载 */}
   {paletteOpen && <CommandPalette />}
   {providerUsageOpen && <ProviderUsageDialog />}
   {refPickerTarget && <ReferencePicker />}
  </div>
 );
}
