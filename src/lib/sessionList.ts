import { api } from "@shared/api";
import { useApp } from "../stores/app";

/**
 * 会话列表刷新的唯一入口（V2 M7a）：一次调用同时落「会话数组 + 扫描统计」。
 *
 * 之前各处直接 `api.listSessions().then(set({sessions}))`，谁也拿不到
 * 「sessions 目录里总共有多少 / 这次扫了多少」——超过窗口的老会话静默消失。
 * 现在统一走这里：左栏据此显示「已扫描最近 N 个（共 M 个）· 继续扫描」。
 */

/** 每次「继续扫描」新增的文件数（与后端默认窗口一致）。 */
export const SCAN_STEP = 500;
/** 扫描窗口上限：再大也不该一次解析上万个文件（后端同样夹到 5000）。 */
export const SCAN_MAX = 5000;

/**
 * 拉取会话列表并写入 store。`limit` 不传时用当前窗口大小（`sessionScanLimit`）。
 * 失败静默（调用方各自决定要不要提示），返回是否成功，便于链式逻辑判断。
 */
export async function loadSessions(limit?: number): Promise<boolean> {
  const st = useApp.getState();
  const want = Math.min(SCAN_MAX, Math.max(SCAN_STEP, limit ?? st.sessionScanLimit));
  try {
    const page = await api.listSessions(undefined, want);
    useApp.getState().set({
      sessions: page.sessions,
      sessionScanLimit: want,
      sessionScan: { totalFiles: page.totalFiles, scannedFiles: page.scannedFiles },
    });
    return true;
  } catch {
    return false;
  }
}

/** 「继续扫描」：窗口 +500 后重扫（不要重新拉项目列表，那是另一件事）。 */
export async function scanMoreSessions(): Promise<void> {
  const st = useApp.getState();
  await loadSessions(st.sessionScanLimit + SCAN_STEP);
}
