import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRightSquare, Check, Copy, Key, Loader, Refresh } from "reicon-react";
import { api } from "@shared/api";
import { IPC } from "@shared/ipc";
import type { ProviderLoginStatus, ProviderView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { ConfirmDialog } from "../ConfirmDialog";

/**
 * 设置 › 供应商：把 omp 的 **login / logout** 搬进界面（模型角色与可用模型在「模型」页签）。
 *
 * 口径（实现依据见 `src-tauri/src/providers.rs` 头注释）：
 * - 登录 / 登出走 `omp auth-broker` 子进程，**不走 RPC**——RPC 模式在「一个供应商都没登录」
 *   的环境里起不来（要先解析出可用模型），而那是这个页面最主要的首次使用场景；
 * - 「已配置」= 该供应商出现在 omp 当前模型目录里（有凭证或免钥），这是壳侧能拿到的最接近
 *   「已登录」的真值，不去直读 omp 的凭证库。
 *
 * 登录输出是上游文本（URL 行 + 进度 + 需要用户回答的提问），原样透传：
 * 提问文案随供应商变化，硬编码匹配会漂，显示给用户看才是稳的。
 */
export function ProvidersPanel() {
 const t = useText();
 const { models, set } = useApp();
 const [providers, setProviders] = useState<ProviderView[] | null>(null);
 const [login, setLogin] = useState<ProviderLoginStatus | null>(null);
 const [loginHidden, setLoginHidden] = useState(false);
 const [err, setErr] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const [pendingLogout, setPendingLogout] = useState<ProviderView | null>(null);
 /** 登录卡：开始登录时把它滚进视野（列表二十多条，卡片可能落在视口外）。 */
 const loginRef = useRef<HTMLDivElement>(null);

 /** 拉供应商清单 + 模型目录（「已配置」标记与登录成功后的刷新都靠目录）。
  *  写成 promise 链（而不是在 effect 里同步调用）——state 只在回调里更新，
  *  符合 react-hooks 对「effect 内同步 setState 会级联渲染」的约束。 */
 const load = useCallback(
  (force: boolean) =>
   Promise.allSettled([
    api.listProviders().then((list) => setProviders(list)),
    (force ? api.refreshModels() : api.getModels()).then((c) => set({ models: c })),
   ]).then((res) => {
    const bad = res.find((r) => r.status === "rejected");
    setErr(
     bad && bad.status === "rejected"
      ? bad.reason instanceof Error
       ? bad.reason.message
       : t.providerLoadFailed
      : null,
    );
   }),
  [set, t.providerLoadFailed],
 );

 useEffect(() => {
  void load(!models);
  void api
   .getProviderLogin()
   .then((s) => setLogin(s))
   .catch(() => { });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉一次
 }, []);

 // 登录进度：后端推的是**全量快照**（不是增量），这里直接覆盖即可
 useEffect(() => {
  const un = listen<ProviderLoginStatus>(IPC.providerLogin, (e) => {
   setLogin(e.payload);
   if (e.payload.running) setLoginHidden(false);
   if (e.payload.done?.ok) {
    // 成功了：凭证变了 → 供应商状态与模型目录都要重取（后端也已作废目录缓存）
    void load(true);
   }
  });
  return () => {
   void un.then((f) => f());
  };
 }, [load]);

 // 登录一开始就把它滚进视野：供应商列表二十多条，登录卡可能落在视口外
 useEffect(() => {
  if (login?.running) loginRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
 }, [login?.running]);

 const startLogin = async (id: string) => {
  setLoginHidden(false);
  setErr(null);
  try {
   await api.startProviderLogin(id);
  } catch (e) {
   setErr(e instanceof Error ? e.message : t.loginFailed);
  }
 };

 const doLogout = async () => {
  const p = pendingLogout;
  setPendingLogout(null);
  if (!p) return;
  setBusy(true);
  setErr(null);
  try {
   await api.logoutProvider(p.id);
   await load(true);
  } catch (e) {
   setErr(e instanceof Error ? e.message : t.opFailed);
  } finally {
   setBusy(false);
  }
 };

 const refreshAll = async () => {
  setBusy(true);
  setErr(null);
  try {
   await load(true);
  } finally {
   setBusy(false);
  }
 };

 const showLogin = !!login && login.provider !== "" && !loginHidden && (login.running || !!login.done);

 return (
  <>
   {err && (
    <p role="alert" className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {err}
    </p>
   )}

   {/* 供应商：登录 / 登出（omp auth-broker） */}
   <section aria-label={t.providersSection} className="rounded-md border border-border bg-surface p-3.5">
    <div className="flex items-center gap-2">
     <Key size={14} aria-hidden className="text-muted" />
     <h2 className="text-sm font-medium">{t.providersSection}</h2>
     <button
      onClick={() => void refreshAll()}
      disabled={busy}
      className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={t.providersRefresh}
      title={t.providersRefresh}
     >
      {busy ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      {t.refresh}
     </button>
    </div>
    <p className="mt-1.5 text-[13px] text-faint">{t.providersHint}</p>

    {/* 登录卡放在列表**上方**：点「登录」后它立刻在视野内（列表有二十多条，
            卡片放列表尾部等于"点了没反应"）。再用 scrollIntoView 兜一道。 */}
    {showLogin && login && (
     <div ref={loginRef}>
      <LoginPanel
       status={login}
       onClose={() => setLoginHidden(true)}
       onError={(m) => setErr(m)}
      />
     </div>
    )}

    <div className="mt-2">
     {providers === null ? (
      <div className="py-2 text-[13px] text-muted">{t.archivedLoading}</div>
     ) : providers.length === 0 ? (
      <div className="py-2 text-[13px] text-muted">{t.providerEmpty}</div>
     ) : (
      providers.map((p) => (
       <div key={p.id} className="flex items-center gap-2 border-t border-border-soft py-2 first:border-t-0">
        <div className="min-w-0 flex-1">
         <div className="truncate text-sm">{p.name}</div>
         <div className="font-mono text-xs text-muted">{p.id}</div>
        </div>
        <span className={`shrink-0 text-[13px] ${p.configured ? "text-ok" : "text-muted"}`}>
         {p.configured ? t.providerConfigured : t.providerNotConfigured}
        </span>
        <button
         onClick={() => void startLogin(p.id)}
         className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
         aria-label={fmt(t.providerLogin + " {0}", p.id)}
        >
         {t.providerLogin}
        </button>
        {p.configured && (
         <button
          onClick={() => setPendingLogout(p)}
          className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
          aria-label={fmt(t.providerLogout + " {0}", p.id)}
         >
          {t.providerLogout}
         </button>
        )}
       </div>
      ))
     )}
    </div>
   </section>

   <ConfirmDialog
    open={!!pendingLogout}
    danger
    title={pendingLogout ? fmt(t.logoutConfirmTitle, pendingLogout.name) : ""}
    detail={t.logoutConfirmDetail}
    confirmLabel={t.providerLogout}
    onCancel={() => setPendingLogout(null)}
    onConfirm={() => void doLogout()}
   />
  </>
 );
}

/** 登录流程卡：URL（打开 / 复制）+ 上游输出窗口 + 输入行 + 取消。 */
function LoginPanel({
 status,
 onClose,
 onError,
}: {
 status: ProviderLoginStatus;
 onClose: () => void;
 onError: (message: string) => void;
}) {
 const t = useText();
 const [text, setText] = useState("");
 const [copied, setCopied] = useState(false);

 const copyUrl = async () => {
  if (!status.url) return;
  try {
   await navigator.clipboard.writeText(status.url);
   setCopied(true);
   window.setTimeout(() => setCopied(false), 1500);
  } catch {
   onError(t.copyFailed);
  }
 };

 const send = async () => {
  const v = text.trim();
  if (!v) return;
  try {
   await api.providerLoginInput(v);
   setText("");
  } catch (e) {
   onError(e instanceof Error ? e.message : t.opFailed);
  }
 };

 const cancel = async () => {
  try {
   await api.cancelProviderLogin();
  } catch {
   // 已经结束了：忽略（状态由事件流收敛）
  }
 };

 const title = status.running
  ? t.loginWaiting
  : status.done?.ok
   ? t.loginOk
   : status.done?.cancelled
    ? t.loginCancelled
    : t.loginFailed;

 return (
  <div className="mt-2 rounded border border-accent/40 bg-accent/5 p-2.5">
   <div className="flex items-center gap-2 text-sm">
    {status.running ? (
     <Loader size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
    ) : (
     <Key size={14} className="shrink-0 text-accent" aria-hidden />
    )}
    <span className={status.running || status.done?.ok ? "" : "text-warn"}>{title}</span>
    <span className="ml-auto font-mono text-xs text-muted">{status.provider}</span>
    {!status.running && (
     <button
      onClick={onClose}
      className="shrink-0 cursor-pointer text-[13px] text-muted transition-colors duration-100 hover:text-foreground"
     >
      {t.close}
     </button>
    )}
   </div>

   {status.done?.message && (
    <p className="mt-2 font-mono text-xs break-words text-danger">{status.done.message}</p>
   )}

   {status.url && (
    <div className="mt-2 flex items-start gap-2">
     <code className="min-w-0 flex-1 font-mono text-xs break-all text-muted">{status.url}</code>
     <button
      onClick={() => void openUrl(status.url!)}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
      aria-label={t.loginOpenBrowser}
     >
      <ArrowUpRightSquare size={11} aria-hidden />
      {t.loginOpenBrowser}
     </button>
     <button
      onClick={() => void copyUrl()}
      className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
      aria-label={t.loginCopyUrl}
     >
      {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
      {copied ? t.copied : t.loginCopyUrl}
     </button>
    </div>
   )}

   {status.lines.length > 0 && (
    <div className="mt-2">
     <div className="text-[13px] text-faint">{t.loginOutput}</div>
     <pre className="mt-1 max-h-36 overflow-y-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap text-muted">
      {status.lines.join("\n")}
     </pre>
    </div>
   )}

   {status.running && (
    <form
     className="mt-2 flex items-center gap-2"
     onSubmit={(e) => {
      e.preventDefault();
      void send();
     }}
    >
     <input
      value={text}
      onChange={(e) => setText(e.target.value)}
      placeholder={t.loginInputHint}
      aria-label={t.loginSend}
      className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none"
     />
     <button
      type="submit"
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
     >
      {t.loginSend}
     </button>
     <button
      type="button"
      onClick={() => void cancel()}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
     >
      {t.cancel}
     </button>
    </form>
   )}
  </div>
 );
}
