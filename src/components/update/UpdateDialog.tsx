import { ArrowUpCircle, Download, Loader2, X } from "lucide-react";
import { useApp } from "../../stores/app";
import { checkForUpdate, deferUpdate, installUpdate, openUpdateDialog, relaunchToApply } from "../../lib/appUpdate";

/** 顶栏更新入口：无更新时隐藏；有更新时常亮，弹窗可稍后关闭。 */
export function UpdateBell() {
  const { update, updateDialogOpen } = useApp();
  if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready") {
    return null;
  }
  const label =
    update.status === "available"
      ? `发现新版本 ${update.version}，点击查看`
      : update.status === "downloading"
        ? "正在下载更新…"
        : `新版本 ${update.version} 已就绪`;
  return (
    <>
      <button
        onClick={openUpdateDialog}
        className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-[13px] text-accent transition-colors duration-200 hover:bg-background"
        aria-label={label}
      >
        <ArrowUpCircle size={14} aria-hidden />
        <span className="max-w-20 truncate">{update.status === "downloading" ? "下载中" : update.version}</span>
      </button>
      {updateDialogOpen && <UpdateDialog />}
    </>
  );
}

function Progress({ downloaded, total }: { downloaded: number; total: number | null }) {
  if (total == null || total <= 0) return <div className="text-xs text-muted">已下载 {(downloaded / 1024).toFixed(0)} KB…</div>;
  const pct = Math.min(100, Math.round((downloaded / total) * 100));
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="下载进度">
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted">{pct}%</div>
    </div>
  );
}

export function UpdateDialog() {
  const { update, set } = useApp();
  if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready" && update.status !== "error") {
    return null;
  }
  const close = () => set({ updateDialogOpen: false });

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label="应用更新">
      <div className="w-[420px] max-w-[90vw] rounded-lg border border-border bg-surface p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-accent" aria-hidden />
          <h2 className="text-[15px] font-semibold">
            {update.status === "ready" ? "更新已就绪" : update.status === "downloading" ? "正在下载更新" : update.status === "error" ? "更新失败" : `发现新版本 ${update.status === "available" ? update.version : ""}`}
          </h2>
          <button onClick={update.status === "available" ? deferUpdate : close} className="ml-auto cursor-pointer rounded p-1.5 transition-colors duration-200 hover:bg-background" aria-label="稍后更新">
            <X size={14} aria-hidden />
          </button>
        </div>

        {update.status === "available" && (
          <>
            <p className="mt-2 text-sm text-muted">当前 {update.current} → 新版 {update.version}。稍后可在顶栏重新打开。</p>
            {update.body && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-code p-2 text-xs whitespace-pre-wrap">{update.body}</pre>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={deferUpdate} className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background">
                稍后更新
              </button>
              <button
                onClick={() => void installUpdate()}
                className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
              >
                立即更新
              </button>
            </div>
          </>
        )}

        {update.status === "downloading" && (
          <div className="mt-3">
            <Progress downloaded={update.downloaded} total={update.total} />
            <p className="mt-2 text-xs text-muted">下载中，请稍候…</p>
          </div>
        )}

        {update.status === "ready" && (
          <>
            <p className="mt-2 text-sm">新版本已下载完成，重启后生效。现在重启吗？</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={close} className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background">
                稍后重启
              </button>
              <button
                onClick={() => void relaunchToApply()}
                className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
              >
                立即重启
              </button>
            </div>
          </>
        )}

        {update.status === "error" && (
          <>
            <p className="mt-2 text-sm text-danger">{update.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={close} className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background">
                关闭
              </button>
              <button
                onClick={() => void checkForUpdate("manual")}
                className="flex cursor-pointer items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
              >
                <Loader2 size={14} aria-hidden /> 重试
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
