import { ArrowUpCircle, Download, Loader2, X } from "lucide-react";
import { useApp } from "../../stores/app";
import { checkForUpdate, deferUpdate, installUpdate, openUpdateDialog, relaunchToApply } from "../../lib/appUpdate";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

/** 顶栏更新入口：无更新时隐藏；有更新时常亮，弹窗可稍后关闭。 */
export function UpdateBell() {
  const { update, updateDialogOpen } = useApp();
  const t = useText();
  if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready") {
    return null;
  }
  const label =
    update.status === "available"
      ? fmt(t.updateBellAvailable, update.version)
      : update.status === "downloading"
        ? t.updateBellDownloading
        : fmt(t.updateBellReady, update.version);
  return (
    <>
      <button
        onClick={openUpdateDialog}
        className="flex cursor-pointer items-center gap-1 rounded px-2 py-1 text-sm text-accent transition-colors duration-200 hover:bg-background"
        aria-label={label}
      >
        <ArrowUpCircle size={14} aria-hidden />
        <span className="max-w-20 truncate">{update.status === "downloading" ? t.updateDownloadingShort : update.version}</span>
      </button>
      {updateDialogOpen && <UpdateDialog />}
    </>
  );
}

function Progress({ downloaded, total }: { downloaded: number; total: number | null }) {
  const t = useText();
  if (total == null || total <= 0) return <div className="text-xs text-muted">{fmt(t.updateDownloadedKb, (downloaded / 1024).toFixed(0))}</div>;
  const pct = Math.min(100, Math.round((downloaded / total) * 100));
  return (
    <div>
      <div className="h-1.5 overflow-hidden rounded bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.updateProgressAria}>
        <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-xs text-muted">{pct}%</div>
    </div>
  );
}

export function UpdateDialog() {
  const { update, set } = useApp();
  const t = useText();
  if (update.status !== "available" && update.status !== "downloading" && update.status !== "ready" && update.status !== "error") {
    return null;
  }
  const close = () => set({ updateDialogOpen: false });

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/30" role="dialog" aria-modal="true" aria-label={t.updateDialogAria}>
      <div className="w-[420px] max-w-[90vw] rounded-lg border border-border bg-surface p-4 shadow-xl">
        <div className="flex items-center gap-2">
          <Download size={16} className="text-accent" aria-hidden />
          <h2 className="text-[15px] font-semibold">
            {update.status === "ready" ? t.updateReadyTitle : update.status === "downloading" ? t.updateDownloading : update.status === "error" ? t.updateFailedTitle : fmt(t.updateAvailable, update.status === "available" ? update.version : "")}
          </h2>
          <button onClick={update.status === "available" ? deferUpdate : close} className="ml-auto cursor-pointer rounded p-1.5 transition-colors duration-200 hover:bg-background" aria-label={t.updateDeferAria}>
            <X size={14} aria-hidden />
          </button>
        </div>

        {update.status === "available" && (
          <>
            <p className="mt-2 text-sm text-muted">{fmt(t.updateCurrentTo, update.current, update.version)}</p>
            {update.body && (
              <pre className="mt-2 max-h-48 overflow-auto rounded bg-code p-2 text-xs whitespace-pre-wrap">{update.body}</pre>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={deferUpdate} className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background">
                {t.updateLater}
              </button>
              <button
                onClick={() => void installUpdate()}
                className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
              >
                {t.updateNow}
              </button>
            </div>
          </>
        )}

        {update.status === "downloading" && (
          <div className="mt-3">
            <Progress downloaded={update.downloaded} total={update.total} />
            <p className="mt-2 text-xs text-muted">{t.updateWait}</p>
          </div>
        )}

        {update.status === "ready" && (
          <>
            <p className="mt-2 text-sm">{t.updateRestartAsk}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={close} className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background">
                {t.updateRestartLater}
              </button>
              <button
                onClick={() => void relaunchToApply()}
                className="cursor-pointer rounded bg-accent px-3 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
              >
                {t.updateRestartNow}
              </button>
            </div>
          </>
        )}

        {update.status === "error" && (
          <>
            <p className="mt-2 text-sm text-danger">{update.message}</p>
            <div className="mt-3 flex justify-end gap-2">
              <button onClick={close} className="cursor-pointer rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background">
                {t.close}
              </button>
              <button
                onClick={() => void checkForUpdate("manual")}
                className="flex cursor-pointer items-center gap-1 rounded bg-accent px-3 py-1.5 text-sm text-white transition-opacity duration-200 hover:opacity-90"
              >
                <Loader2 size={14} aria-hidden /> {t.retry}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
