import { useEffect, useRef, useState } from "react";
import { useApp, SIDEBAR_MAX, SIDEBAR_MIN } from "../stores/app";
import { applyTheme } from "../lib/theme";
import { useText } from "../lib/useText";
import { api } from "@shared/api";
import type { TermTabState } from "@shared/types";
import { WorkspaceSidebar } from "../components/sidebar/WorkspaceSidebar";
import { TerminalView } from "../components/terminal/TerminalView";
import { TerminalTabs } from "../components/terminal/TerminalTabs";
import { QuickSwitcher } from "../components/terminal/QuickSwitcher";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { CommitTaskPanel } from "../components/git/CommitTaskPanel";
import { HealthBanner } from "../components/HealthBanner";
import { SettingsPage } from "../components/SettingsPage";
import { UpdateDialog } from "../components/update/UpdateDialog";
import { newTerminalInActiveWorkspace } from "../lib/workspaces";
import { terminalsInWorkspace } from "../lib/terminalScope";
import { refreshWorkspaceGitState, scheduleWorkspaceGitRefresh, startWorkspaceGitPolling } from "../lib/commitTasks";
import { autoCheckOnBoot } from "../lib/appUpdate";
import { hasOpenDialog, useDialogFocus } from "../lib/useDropdown";
import { isMacKeyboard } from "../lib/termInput";
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
 * 工作区 git 快照的刷新时机——启动 / 工作区清单变化 / 窗口转可见或重新获得焦点 /
 * 终端刚干完活（π 由工作态转就绪或等待确认，防抖 2s）/ **可见时 30s 兜底轮询**。
 * 任务结束后的单点刷新在 `lib/commitTasks.ts` 里；点按钮时的**后端预检**才是最终裁决。
 */
function useWorkspaceGitRefresh() {
 const workspaces = useApp((s) => s.workspaces);
 const terminals = useApp((s) => s.terminals);
 const prevStates = useRef<Map<string, TermTabState>>(new Map());

 useEffect(() => {
  void refreshWorkspaceGitState(workspaces.map((w) => w.path));
 }, [workspaces]);

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

 // 兜底轮询：终端里的 git 活动（agent 或手敲）不改变 π 状态，等不到「转就绪」那个时机
 useEffect(() => startWorkspaceGitPolling(), []);

 useEffect(() => {
  let woke = false;
  const seen = new Set<string>();
  for (const term of terminals) {
   seen.add(term.id);
   const prev = prevStates.current.get(term.id);
   if (prev === "working" && (term.state === "ready" || term.state === "attention")) woke = true;
   prevStates.current.set(term.id, term.state);
  }
  for (const id of [...prevStates.current.keys()]) {
   if (!seen.has(id)) prevStates.current.delete(id);
  }
  if (woke) scheduleWorkspaceGitRefresh();
 }, [terminals]);
}

/** 终端快捷键（V11）：⌘T 新建 / ⌘W 关闭当前 / ⌘1..9 切标签（非 mac 平台用 Ctrl）。 */
function useTerminalHotkeys() {
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (e.defaultPrevented || e.isComposing || e.altKey) return;
   const mod = isMacKeyboard() ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
   if (!mod) return;
   const key = e.key.toLowerCase();
   const owned = key === "t" || key === "w" || key === "k" || /^[1-9]$/.test(key);
   if (!owned || (key === "k" && !e.shiftKey) || (key !== "k" && e.shiftKey)) return;
   const el = document.activeElement;
   const typing = el instanceof HTMLElement
    && !el.closest(".xterm-helper-textarea")
    && !!el.closest("input, textarea, select, [contenteditable='true']");
   // 识别到本应用组合键就先截获，避免浏览器默认或漏进 PTY；模态或输入中只阻断不执行。
   e.preventDefault();
   e.stopPropagation();
   if (e.repeat || hasOpenDialog() || typing) return;
   const s = useApp.getState();
   if (key === "t") {
    newTerminalInActiveWorkspace();
   } else if (key === "k") {
    s.set({ quickSwitcherOpen: true });
   } else if (key === "w") {
    // 设置标签激活时，⌘W 关的是设置标签（终端标签的关闭语义不变）
    if (s.settingsTabActive) {
     s.closeSettingsTab();
     return;
    }
    if (!s.activeTerminalId) return;
    s.requestCloseTerminal(s.activeTerminalId);
   } else {
    // ⌘1..9 的序号 = **当前工作区**里的终端顺序（与右栏视图一致的过滤列表）
    const term = terminalsInWorkspace(s.terminals, s.activeWorkspacePath)[Number(key) - 1];
    if (!term) return;
    s.focusTerminal(term.id);
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
   {/* 同一份侧栏子树：桌面用宽度容器，窗窗定位态态态组件重现挂载。 */}
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
 const { settingsTabOpen, settingsTabActive, closingTerminalId, set, sidebarWidth, setSidebarWidth, updateDialogOpen, sidebarOpen, quickSwitcherOpen } = useApp();
 const t = useText();
 useTheme();
 useLocale();
 useTerminalHotkeys();
 useWorkspaceGitRefresh();

 useEffect(() => {
  // 启动静默检查更新（有更新点亮设置入口的小点，不打断）
  void autoCheckOnBoot();
 }, []);

 useEffect(() => {
  // 启动就把模型目录拉进 store（后台、静默、失败无所谓）：设置页模型页签用它。
  api
   .getModels()
   .then((models) => set({ models }))
   .catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 useEffect(() => {
  api
   .getHealth()
   .then((health) => set({ health }))
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
    <WorkspaceSidebar />
   </SidebarShell>
   <main inert={sidebarOpen ? true : undefined} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background md:my-2 md:mr-2 md:rounded-xl md:border md:border-border">
    <HealthBanner />
    {/* 标签栏常驻（主区顶部）：终端标签 + 设置标签（单例）——设置打开时也看得见标签栏、
       点得回终端。终端区与设置页都**常驻挂载、只切显隐**（卸载 `TerminalPane` 的
       清理 effect 会 `pty_kill`，那是「关闭标签」才该发生的事）。 */}
    <TerminalTabs />
    <TerminalView visible={!settingsTabActive} />
    {settingsTabOpen && <SettingsPage visible={settingsTabActive} />}
    {/* 关闭确认常驻这层：设置标签激活时点终端标签的 × 也要弹得出来 */}
    <ConfirmDialog
     open={closingTerminalId !== null}
     title={t.termCloseRunningTitle}
     detail={t.termCloseRunningBody}
     confirmLabel={t.termClose}
     danger
     onConfirm={() => useApp.getState().confirmCloseTerminal()}
     onCancel={() => useApp.getState().cancelCloseTerminal()}
    />
   </main>
   <CommitTaskPanel />
   {updateDialogOpen && <UpdateDialog />}
   {quickSwitcherOpen && <QuickSwitcher />}
  </div>
 );
}
