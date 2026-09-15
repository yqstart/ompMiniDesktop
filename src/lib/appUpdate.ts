import type { DownloadEvent } from "@tauri-apps/plugin-updater";
import { useApp } from "../stores/app";
import type { UpdateState } from "@shared/types";

/**
 * 应用内更新：直接面向 GitHub Release `latest.json`（Tauri updater 标准链路）。
 * - auto（启动静默检查）：有更新只点亮入口 + toast 提示，不打断用户。
 * - manual（设置页按钮）：有更新弹「立即更新 / 稍后」；无更新给明确反馈。
 * - 稍后：关闭弹窗但保留顶栏入口 + 状态，下次启动重新检查。
 * - 安装完成：询问「立即重启 / 稍后」（稍后则下次启动生效）。
 */

let pending: import("@tauri-apps/plugin-updater").Update | null = null;
let checking = false;
let installing = false;

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function setUpdate(p: { update?: UpdateState; updateDismissedVersion?: string | null; updateDialogOpen?: boolean }) {
  useApp.setState(p as never);
}

export async function getAppVersion(): Promise<string> {
  if (!isTauri()) return "dev";
  try {
    const { getVersion } = await import("@tauri-apps/api/app");
    return await getVersion();
  } catch {
    return "dev";
  }
}

/** 启动时调用一次：静默检查，有更新只点亮入口。 */
export async function autoCheckOnBoot(): Promise<void> {
  if (!isTauri() || import.meta.env.DEV) return;
  // 稍后过的版本本轮不再打扰（重启后重置）
  await checkForUpdate("auto").catch(() => undefined);
}

export async function checkForUpdate(
  mode: "auto" | "manual",
): Promise<"available" | "latest" | "skipped" | "error"> {
  const st = useApp.getState();
  if (!isTauri()) return "skipped";
  if (import.meta.env.DEV) {
    if (mode === "manual") setUpdate({ update: { status: "error", message: "开发模式下不检查更新" } });
    return "skipped";
  }
  if (checking || installing) return "skipped";
  checking = true;
  if (mode === "manual") setUpdate({ update: { status: "checking" } });
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      if (pending) {
        await pending.close().catch(() => undefined);
        pending = null;
      }
      const current = await getAppVersion();
      setUpdate({ update: { status: mode === "manual" ? "latest" : "idle", current } });
      return "latest";
    }
    pending = update;
    setUpdate({
      update: {
        status: "available",
        version: update.version,
        current: update.currentVersion,
        body: update.body ?? null,
      },
      // auto 且本轮已稍后：只点亮入口不弹窗；否则弹窗
      updateDialogOpen: mode === "manual" ? true : st.updateDismissedVersion !== update.version,
    });
    return "available";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (mode === "manual") setUpdate({ update: { status: "error", message } });
    else console.warn("[ompMiniDesktop] 自动检查更新失败", e);
    return "error";
  } finally {
    checking = false;
  }
}

/** 稍后：关闭弹窗，保留顶栏入口；本轮 auto 不再弹窗打扰。 */
export function deferUpdate(): void {
  const st = useApp.getState();
  if (st.update.status === "available") {
    setUpdate({ updateDismissedVersion: st.update.version, updateDialogOpen: false });
  } else {
    setUpdate({ updateDialogOpen: false });
  }
  // available 状态本身保留（入口常亮），只关弹窗
}

export function openUpdateDialog(): void {
  setUpdate({ updateDialogOpen: true });
}

/** 立即更新：下载 → 安装 → 询问重启。取消重启则下次启动生效。 */
export async function installUpdate(): Promise<"updated" | "deferred" | "error" | "skipped"> {
  if (!pending) return "skipped";
  if (installing) return "skipped";
  installing = true;
  const update = pending;
  const st = useApp.getState();
  if (st.update.status !== "downloading") {
    setUpdate({
      update: { status: "downloading", version: update.version, downloaded: 0, total: null },
    });
  }
  try {
    await update.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === "Started") {
        setUpdate({
          update: {
            status: "downloading",
            version: update.version,
            downloaded: 0,
            total: event.data.contentLength ?? null,
          },
        });
      } else if (event.event === "Progress") {
        const cur = useApp.getState().update;
        if (cur.status === "downloading") {
          setUpdate({
            update: { ...cur, downloaded: cur.downloaded + event.data.chunkLength },
          });
        }
      }
    });
    setUpdate({ update: { status: "ready", version: update.version } });
    return "deferred";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    setUpdate({ update: { status: "error", message } });
    return "error";
  } finally {
    installing = false;
  }
}

/** 用户确认重启：关闭更新句柄后 relaunch。 */
export async function relaunchToApply(): Promise<void> {
  if (pending) {
    await pending.close().catch(() => undefined);
    pending = null;
  }
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}
