import type { ReactNode } from "react";
import { Download, Loader, X } from "reicon-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useApp } from "../../stores/app";
import { checkForUpdate, deferUpdate, installUpdate, relaunchToApply } from "../../lib/appUpdate";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

/**
 * 应用更新弹窗（V11：顶栏 UpdateBell 退场后，由 App 常驻挂载、`updateDialogOpen` 控制显隐；
 * 有更新的常驻提醒改由左栏「设置」入口上的小点承担）。
 */
function Progress({ downloaded, total }: { downloaded: number; total: number | null }) {
 const t = useText();
 if (total == null || total <= 0) return <div className="text-[13px] text-muted">{fmt(t.updateDownloadedKb, (downloaded / 1024).toFixed(0))}</div>;
 const pct = Math.min(100, Math.round((downloaded / total) * 100));
 return (
  <div>
   <div className="h-1.5 overflow-hidden rounded bg-border" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t.updateProgressAria}>
    <div className="h-full bg-accent transition-[width] duration-100" style={{ width: `${pct}%` }} />
   </div>
   <div className="mt-1 text-[11px] text-faint">{pct}%</div>
  </div>
 );
}

/** 更新说明里的链接：点击交给系统浏览器（`opener` 插件），不让 webview 自己导航走。 */
function NotesLink({ href, children }: { href?: string; children?: ReactNode }) {
 return (
  <button
   type="button"
   onClick={() => {
    if (href) void openUrl(href).catch(() => undefined);
   }}
   className="cursor-pointer text-accent underline underline-offset-2"
  >
   {children}
  </button>
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
  <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={t.updateDialogAria}>
   <div className="w-[420px] max-w-full rounded-xl border border-border bg-elevated p-6 shadow-dialog">
    <div className="flex items-center gap-2">
     <Download size={16} className="text-accent" aria-hidden />
     <h2 className="text-[15px] font-semibold">
      {update.status === "ready" ? t.updateReadyTitle : update.status === "downloading" ? t.updateDownloading : update.status === "error" ? t.updateFailedTitle : fmt(t.updateAvailable, update.status === "available" ? update.version : "")}
     </h2>
     <button onClick={update.status === "available" ? deferUpdate : close} className="ml-auto cursor-pointer rounded p-1.5 transition-colors duration-100 hover:bg-hover" aria-label={t.updateDeferAria}>
      <X size={14} aria-hidden />
     </button>
    </div>

    {update.status === "available" && (
     <>
      <p className="mt-2 text-sm text-muted">{fmt(t.updateCurrentTo, update.current, update.version)}</p>
      {update.body && (
       <>
        <p className="mt-3 text-[11px] text-faint">{t.updateNotes}</p>
        {/* 更新说明 = Release 里 CHANGELOG 本版本整节（Markdown）。按不可信输入处理：
            react-markdown 默认不渲染原始 HTML；链接一律交给系统浏览器，不给 webview 自行导航的机会。 */}
        <div className="md-body mt-1 max-h-64 overflow-auto rounded-md bg-code p-3 text-[13px]">
         <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: NotesLink }}>
          {update.body}
         </ReactMarkdown>
        </div>
       </>
      )}
      <div className="mt-3 flex justify-end gap-2">
       <button onClick={deferUpdate} className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover">
        {t.updateLater}
       </button>
       <button
        onClick={() => void installUpdate()}
        className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground transition-opacity duration-100 hover:opacity-90"
       >
        {t.updateNow}
       </button>
      </div>
     </>
    )}

    {update.status === "downloading" && (
     <div className="mt-3">
      <Progress downloaded={update.downloaded} total={update.total} />
      <p className="mt-2 text-[13px] text-muted">{t.updateWait}</p>
     </div>
    )}

    {update.status === "ready" && (
     <>
      <p className="mt-2 text-sm">{t.updateRestartAsk}</p>
      <div className="mt-3 flex justify-end gap-2">
       <button onClick={close} className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover">
        {t.updateRestartLater}
       </button>
       <button
        onClick={() => void relaunchToApply()}
        className="cursor-pointer rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground transition-opacity duration-100 hover:opacity-90"
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
       <button onClick={close} className="cursor-pointer rounded-md border border-border px-3 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover">
        {t.close}
       </button>
       <button
        onClick={() => void checkForUpdate("manual")}
        className="flex cursor-pointer items-center gap-1 rounded-md bg-accent px-3 py-1.5 text-[13px] text-accent-foreground transition-opacity duration-100 hover:opacity-90"
       >
        <Loader size={14} aria-hidden /> {t.retry}
       </button>
      </div>
     </>
    )}
   </div>
  </div>
 );
}
