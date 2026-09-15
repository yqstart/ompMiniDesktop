import { useEffect, useRef, useState } from "react";
import { useApp, SIDEBAR_MAX, SIDEBAR_MIN } from "../stores/app";
import { api } from "@shared/api";
import { Sidebar } from "../components/sidebar/Sidebar";
import { TopBar } from "../components/thread/TopBar";
import { Thread } from "../components/thread/Thread";
import { StatusBar } from "../components/thread/StatusBar";
import { Composer } from "../components/composer/Composer";
import { HealthBanner } from "../components/HealthBanner";
import { SettingsPage } from "../components/SettingsPage";

function useTheme() {
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () =>
      document.documentElement.classList.toggle("dark", mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
}

import { useSessionEvents } from "../lib/useSessionEvents";
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
  // hover 才加宽热区：平时 3px 细线，悬停/拖拽时 7px 好抓
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
          aria-label="调整侧栏宽度"
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
          className={`absolute top-0 -right-0.5 z-10 h-full cursor-col-resize touch-none transition-colors focus-visible:outline-none ${
            hot || draggingUi ? "w-[7px] bg-accent/30" : "w-[3px] bg-transparent hover:bg-accent/20"
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
      <div className="absolute top-0 left-0 h-full w-72 max-w-[85vw] overflow-hidden rounded-r-xl bg-sidebar shadow-xl">
        {children}
      </div>
    </div>
  );
}

export function App() {
  const { settingsOpen, set, sidebarWidth, setSidebarWidth } = useApp();
  useTheme();
  useSessionEvents();

  useEffect(() => {
    // 启动静默检查更新（有更新只点亮入口，不打断）
    void autoCheckOnBoot();
  }, []);

  useEffect(() => {
    api
      .getHealth()
      .then((health) => set({ health }))
      .catch(() =>
        set({
          health: {
            omp: { ompPath: null, ompVersion: null, agentDir: "", errors: ["健康检查失败"] },
            modelsError: "健康检查失败",
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
