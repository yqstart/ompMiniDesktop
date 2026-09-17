import { useEffect, useRef, useState } from "react";
import { useApp, SIDEBAR_MAX, SIDEBAR_MIN } from "../stores/app";
import { applyTheme } from "../lib/theme";
import { useText } from "../lib/useText";
import { api } from "@shared/api";
import { WorkspaceSidebar } from "../components/sidebar/WorkspaceSidebar";
import { TerminalView } from "../components/terminal/TerminalView";
import { TerminalTabs } from "../components/terminal/TerminalTabs";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { HealthBanner } from "../components/HealthBanner";
import { SettingsPage } from "../components/SettingsPage";
import { UpdateDialog } from "../components/update/UpdateDialog";
import { newTerminalInActiveWorkspace } from "../lib/workspaces";
import { autoCheckOnBoot } from "../lib/appUpdate";

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

/** 终端快捷键（V11）：⌘T 新建 / ⌘W 关闭当前 / ⌘1..9 切标签（非 mac 平台用 Ctrl）。 */
function useTerminalHotkeys() {
 useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
   if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
   const s = useApp.getState();
   if (e.key === "t") {
    e.preventDefault();
    newTerminalInActiveWorkspace();
   } else if (e.key === "w") {
    // 设置标签激活时，⌘W 关的是设置标签（终端标签的关闭语义不变）
    if (s.settingsTabActive) {
     e.preventDefault();
     s.closeSettingsTab();
     return;
    }
    if (!s.activeTerminalId) return;
    e.preventDefault();
    s.requestCloseTerminal(s.activeTerminalId);
   } else if (/^[1-9]$/.test(e.key)) {
    const term = s.terminals[Number(e.key) - 1];
    if (!term) return;
    e.preventDefault();
    s.focusTerminal(term.id);
   }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
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
 // hover 才加宽热区：平时 3px 隐身细条，悬停/拖拽时 6px 好抓
 const [hot, setHot] = useState(false);
 // 拖拽中的视觉态用 state 表达（render 里不许读 ref），ref 只在事件/effect 里做快速判断
 const [draggingUi, setDraggingUi] = useState(false);

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

 return (
  <>
   {/* 桌面端：固定宽度 + 右缘拖拽条 */}
   <div className="relative hidden shrink-0 md:block" style={{ width }}>
    {children}
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
   </div>
   {/* 窄窗：抽屉由 sidebarOpen 控制 */}
   <SidebarDrawer>{children}</SidebarDrawer>
  </>
 );
}

function SidebarDrawer({ children }: { children: React.ReactNode }) {
 const { sidebarOpen, set } = useApp();
 if (!sidebarOpen) return null;
 return (
  <div className="fixed inset-0 z-40 md:hidden">
   <div
    className="absolute inset-0 bg-black/40"
    onClick={() => set({ sidebarOpen: false })}
    aria-hidden
   />
   <div className="absolute top-0 left-0 h-full w-72 max-w-[85vw] overflow-hidden rounded-r-lg bg-sidebar shadow-dialog">
    {children}
   </div>
  </div>
 );
}

export function App() {
 const { settingsTabOpen, settingsTabActive, closingTerminalId, set, sidebarWidth, setSidebarWidth, updateDialogOpen } = useApp();
 const terminals = useApp((s) => s.terminals);
 const t = useText();
 useTheme();
 useLocale();
 useTerminalHotkeys();

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
  try {
   document.documentElement.lang = useApp.getState().locale;
  } catch {
   // 非 DOM 环境忽略
  }
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
  api
   .listProjects()
   .then((projects) => set({ projects }))
   .catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, []);

 return (
  <div className="flex h-screen overflow-hidden bg-background text-sm text-foreground">
   <SidebarShell
    width={sidebarWidth}
    onResize={(w) => {
     if (w !== sidebarWidth) setSidebarWidth(w);
    }}
   >
    <WorkspaceSidebar />
   </SidebarShell>
   <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
    <HealthBanner />
    {/* 标签栏常驻（主区顶部）：终端标签 + 设置标签（单例）——设置打开时也看得见标签栏、
        点得回终端。终端区与设置页都**常驻挂载、只切显隐**（卸载 `TerminalPane` 的
        清理 effect 会 `pty_kill`，那是「关闭标签」才该发生的事）。 */}
    {(terminals.length > 0 || settingsTabOpen) && <TerminalTabs />}
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
   {updateDialogOpen && <UpdateDialog />}
  </div>
 );
}
