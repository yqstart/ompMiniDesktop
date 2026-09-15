import { useEffect } from "react";
import { useApp } from "../stores/app";
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

export function App() {
  const { settingsOpen, set } = useApp();
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-[13px] text-foreground">
      <div className="hidden w-66 shrink-0 md:block">
        <Sidebar />
      </div>
      <main className="flex min-w-0 flex-1 flex-col bg-background">
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
