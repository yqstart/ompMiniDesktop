import { Loader2, RefreshCw } from "lucide-react";
import { useApp } from "../stores/app";
import { checkForUpdate, getAppVersion, openUpdateDialog } from "../lib/appUpdate";
import { useEffect, useState } from "react";

export function SettingsPage() {
  const { health, set, update } = useApp();
  const [version, setVersion] = useState("…");

  useEffect(() => {
    void getAppVersion().then(setVersion);
  }, []);

  const checking = update.status === "checking";
  const updateHint =
    update.status === "latest"
      ? `已是最新（${update.current}）`
      : update.status === "available"
        ? `发现新版本 ${update.version}`
        : update.status === "downloading"
          ? "正在下载更新…"
          : update.status === "ready"
            ? `新版本 ${update.version} 已就绪，重启生效`
            : update.status === "error"
              ? `检查失败：${update.message}`
              : null;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 py-8">
      <h1 className="text-xl font-semibold">设置</h1>
      <p className="text-sm text-muted">
        V1 暂不在此提供设置。Provider Key、模型目录等请用 omp CLI 管理。
      </p>
      <div className="rounded border border-border bg-surface p-3">
        <div className="text-xs text-muted">config path（只读）</div>
        <div className="font-mono text-xs break-all">{health?.omp.agentDir ?? "未知"}</div>
      </div>

      <section aria-label="应用更新" className="rounded border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">应用更新</h2>
          <span className="font-mono text-xs text-muted">当前 v{version}</span>
          <button
            onClick={() => void checkForUpdate("manual").then((r) => {
              if (r === "available") openUpdateDialog();
            })}
            disabled={checking}
            className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background disabled:opacity-50"
            aria-label="检查更新"
          >
            {checking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
            检查更新
          </button>
        </div>
        {updateHint && (
          <div className="mt-2 text-sm text-muted">
            {updateHint}
            {(update.status === "available" || update.status === "ready") && (
              <button onClick={openUpdateDialog} className="ml-2 cursor-pointer text-accent">
                查看详情
              </button>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-muted">更新包来自 GitHub Release；下载完成后可选择立即重启或稍后重启（下次启动生效）。</p>
      </section>

      <div>
        <button
          onClick={() => set({ settingsOpen: false })}
          className="cursor-pointer rounded border border-border px-4 py-2 text-sm transition-colors duration-200 hover:bg-background"
        >
          返回
        </button>
      </div>
    </div>
  );
}
