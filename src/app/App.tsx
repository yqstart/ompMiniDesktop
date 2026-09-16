import { useEffect, useRef, useState } from "react";
import { useApp, SIDEBAR_MAX, SIDEBAR_MIN } from "../stores/app";
import { applyTheme } from "../lib/theme";
import { useText } from "../lib/useText";
import { api } from "@shared/api";
import { Sidebar } from "../components/sidebar/Sidebar";
import { TopBar } from "../components/thread/TopBar";
import { Thread } from "../components/thread/Thread";
import { StatusBar } from "../components/thread/StatusBar";
import { Composer } from "../components/composer/Composer";
import { HealthBanner } from "../components/HealthBanner";
import { SettingsPage } from "../components/SettingsPage";

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

import { useSessionEvents } from "../lib/useSessionEvents";
import { useTaskNotifications } from "../lib/useTaskNotifications";
import { autoCheckOnBoot } from "../lib/appUpdate";

/** 左侧栏外壳：桌面端可左右拖拽调宽（220–480px，持久化）；窄窗（<768px）收起为抽屉。 */
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
      {/* 窄窗：抽屉由 sidebarOpen 控制（保持既有行为） */}
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
  const { settingsOpen, set, sidebarWidth, setSidebarWidth } = useApp();
  const t = useText();
  useTheme();
  useLocale();
  useSessionEvents();
  useTaskNotifications();
  useEffect(() => {
    void import("../lib/openPath").then((m) => m.hydrateDrafts());
  }, []);

  useEffect(() => {
    // 启动静默检查更新（有更新只点亮入口，不打断）
    void autoCheckOnBoot();
  }, []);

  useEffect(() => {
    // 启动就把模型目录拉进 store（后台、静默、失败无所谓）：它同时喂给
    // ModelPicker / 设置页的模型页签，以及「用量限额」里「配了但拿不到用量」的说明行
    // （后端只读这份缓存，不自己跑 `omp models --json`——那条命令冷启动约 10s）。
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
    // 覆盖层里的会话级权限覆盖：启动时水合一次。不水合的话权限徽标只显示全局档，
    // 与「本会话覆盖」的真实值不一致（重启后尤其明显）。
    api
      .getOverlay()
      .then((ov) => set({ sessionApprovals: ov.sessionApproval ?? {} }))
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
        <Sidebar />
      </SidebarShell>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <HealthBanner />
        {settingsOpen ? (
          <SettingsPage />
        ) : (
          <>
            <TopBar />
            <Thread />
            <StatusBar />
            <Composer />
          </>
        )}
      </main>
    </div>
  );
}
