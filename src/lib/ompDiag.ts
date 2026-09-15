import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import { useApp } from "../stores/app";

/**
 * omp 自检与手动指定路径（设置页诊断区 + 顶部引导横幅共用一份实现）。
 *
 * 为什么需要：GUI 启动的进程 PATH 只有 launchd 默认值，homebrew / ~/.local/bin
 * 常常不在其中——用户装了 omp 也会被判"未找到"。所以引导横幅不能只报错，
 * 必须给出「重新检测」和「指定路径」两个动作。
 *
 * 两者都只写应用自己的覆盖层（`ompPath`），不写 omp 的配置文件。
 */
export type DiagResult = { ok: true } | { ok: false; message: string };

export async function refreshOmpHealth(): Promise<DiagResult> {
  try {
    useApp.getState().set({ health: await api.getHealth() });
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "自检失败" };
  }
}

/** `null` = 用户取消选择。 */
export async function pickOmpExecutable(): Promise<DiagResult | null> {
  const picked = await open({ multiple: false, directory: false, title: "选择 omp 可执行文件" });
  if (typeof picked !== "string" || !picked) return null;
  try {
    await api.setOmpPath(picked);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "指定 omp 路径失败" };
  }
  return refreshOmpHealth();
}
