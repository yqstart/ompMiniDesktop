import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { ArrowUpRightSquare, Check, Copy, Key, Loader, Plus, Refresh, Trash2 } from "reicon-react";
import { api } from "@shared/api";
import { IPC } from "@shared/ipc";
import type { ModelInfo, ModelsConfigFile, ProviderLoginStatus, ProviderView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import {
 emptyProviderForm,
 parseModelsConfig,
 providerFormComplete,
 providerFormOf,
 removeProvider,
 upsertProvider,
 type CustomProviderForm,
 type CustomProviderView,
} from "../../lib/customModels";
import { useText } from "../../lib/useText";
import { ConfirmDialog } from "../ConfirmDialog";
import { CustomProviderEditForm } from "./CustomProviderEditForm";
import { DialogShell } from "./DialogShell";
import { ProviderModelsDialog, ProviderModelsList } from "./ProviderModelsDialog";
import { PICK_CUSTOM, ProviderPicker } from "./ProviderPicker";

/**
 * 设置 › 模型 ›「供应商」区块（V12c：登录型供应商与自定义模型合并为一个添加面板）。
 *
 * 一个「添加供应商」按钮包住两种添加方式，先选提供商：
 * - **自定义**（选择器首项）→ 写 omp 的 `<agentDir>/models.yml`（自建端点 / 网关 / 本地推理），
 *   保真编辑 + 预校验 + 备份，见 `lib/customModels.ts` 与 `src-tauri/src/models_config.rs`；
 * - **omp 供应商目录里的某个提供商** → 走 `omp auth-broker login` 把凭证写进 omp 的凭证库
 *   （API key 直接粘进下面的输入框；OAuth 型会给出浏览器链接）。上游输出**原样透传**：
 *   提问文案与流程随供应商变化，硬编码匹配会漂。登录成功立即刷新模型目录，就地挑选模型
 *   （星标 = 加入上面的「我的模型」，只影响本应用的选择器，不写 omp 的 `enabledModels`）。
 *
 * 「已配置」= 该供应商出现在 omp 当前模型目录里（有凭证或免钥），这是壳侧能拿到的最接近
 * 「已登录」的真值，不去直读 omp 的凭证库；列表只列已配置的登录型供应商 + models.yml 里的块
 * （未配置的提供商在「添加供应商」的选择器里）。
 */
export function ProvidersSection() {
 const t = useText();
 const { models, set, myModels, setMyModels } = useApp();
 const [providers, setProviders] = useState<ProviderView[] | null>(null);
 const [file, setFile] = useState<ModelsConfigFile | null>(null);
 const [login, setLogin] = useState<ProviderLoginStatus | null>(null);
 const [err, setErr] = useState<string | null>(null);
 const [busy, setBusy] = useState(false);
 const [refreshing, setRefreshing] = useState(false);
 const [pendingLogout, setPendingLogout] = useState<ProviderView | null>(null);
 /** 打开「挑选模型」弹窗的登录型供应商（null = 关闭）。 */
 const [picking, setPicking] = useState<ProviderView | null>(null);
 /** 添加面板：打开态 / 已选的登录型提供商（null = 还在选提供商）。 */
 const [addOpen, setAddOpen] = useState(false);
 const [addPick, setAddPick] = useState<string | null>(null);
 /** 自定义供应商表单（新建或编辑）；非 null 时占据面板位。 */
 const [editing, setEditing] = useState<{ form: CustomProviderForm; isNew: boolean } | null>(null);
 const [formErr, setFormErr] = useState<string | null>(null);
 /** 自定义行的删除确认目标（行内确认：设置页是可滚动容器，浮层会被裁掉）。 */
 const [pendingRemove, setPendingRemove] = useState<string | null>(null);

 /** 拉供应商清单 + models.yml + 模型目录（「已配置」标记、挑选面板与登录成功后的刷新都靠目录）。
  *  写成 promise 链（而不是在 effect 里同步调用）——state 只在回调里更新，
  *  符合 react-hooks 对「effect 内同步 setState 会级联渲染」的约束。 */
 const load = useCallback(
  (force: boolean) =>
   Promise.allSettled([
    api.listProviders().then((list) => setProviders(list)),
    api.readModelsConfig().then((f) => setFile(f)),
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
   .then((s) => {
    setLogin(s);
    // 切走设置页再回来：把未走完的登录恢复到面板里（不然它就成了看不见的后台进程）
    if (s.running && s.provider) {
     setAddOpen(true);
     setAddPick(s.provider);
    }
   })
   .catch(() => { });
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时拉一次
 }, []);

 // 登录进度：后端推的是**全量快照**（不是增量），这里直接覆盖即可
 useEffect(() => {
  const un = listen<ProviderLoginStatus>(IPC.providerLogin, (e) => {
   setLogin(e.payload);
   // 成功了：凭证变了 → 供应商状态与模型目录都要重取（后端也已作废目录缓存）
   if (e.payload.done?.ok) void load(true);
  });
  return () => {
   void un.then((f) => f());
  };
 }, [load]);

 /** 发起 `auth-broker login`：上游先打印取 key 的说明 / 授权链接，用户在面板里回答提问。 */
 const startLogin = async (id: string) => {
  setErr(null);
  try {
   await api.startProviderLogin(id);
  } catch (e) {
   setErr(e instanceof Error ? e.message : t.loginFailed);
  }
 };

 /** 添加面板：选完提供商立即开始流程（自定义 → 表单；其余 → 凭据卡）。 */
 const pickProvider = (id: string) => {
  setFormErr(null);
  setPendingRemove(null);
  if (id === PICK_CUSTOM) {
   setEditing({ form: emptyProviderForm(), isNew: true });
   return;
  }
  setAddPick(id);
  void startLogin(id);
 };

 /** 打开添加面板（未选提供商）。 */
 const openAdd = () => {
  setFormErr(null);
  setPendingRemove(null);
  setPicking(null);
  setAddPick(null);
  setEditing(null);
  setAddOpen(true);
 };

 /** 关闭面板；`cancelLogin` 时顺手终止还在跑的登录子进程（关闭 = 放弃这次添加）。 */
 const closeAdd = async (cancelLogin: boolean) => {
  setAddOpen(false);
  setAddPick(null);
  setEditing(null);
  setFormErr(null);
  if (cancelLogin && login?.running) {
   try {
    await api.cancelProviderLogin();
   } catch {
    // 已经结束了：忽略（状态由事件流收敛）
   }
  }
 };

 /** 行上的「登录」：重新走一遍该供应商的凭据流程（更新 key / 重新授权）。 */
 const relogin = (id: string) => {
  setFormErr(null);
  setPendingRemove(null);
  setPicking(null);
  setEditing(null);
  setAddOpen(true);
  setAddPick(id);
  void startLogin(id);
 };

 const beginEdit = (id: string) => {
  if (!file) return;
  const form = providerFormOf(file.text, id);
  if (!form) return;
  setFormErr(null);
  setPendingRemove(null);
  setPicking(null);
  setAddPick(null);
  setAddOpen(true);
  setEditing({ form, isNew: false });
 };

 /** 保存自定义供应商：表单 → 保真编辑 → 后端预校验 + 落盘（失败时原文件不动）。 */
 const saveCustom = async () => {
  if (!editing || !file) return;
  if (!providerFormComplete(editing.form)) {
   setFormErr(t.customFormIncomplete);
   return;
  }
  const edited = upsertProvider(file.text, editing.form);
  if (!edited.ok) {
   setFormErr(edited.error);
   return;
  }
  setBusy(true);
  setFormErr(null);
  try {
   const next = await api.writeModelsConfig(edited.text, file.hash);
   setFile(next);
   setEditing(null);
   setAddOpen(false);
   setAddPick(null);
   // 写入已通过 omp 预校验——目录里立刻能看到（有凭证或免钥时）
   const catalog = await api.refreshModels();
   set({ models: catalog });
  } catch (e) {
   setFormErr(e instanceof Error ? e.message : t.opFailed);
  } finally {
   setBusy(false);
  }
 };

 const doRemove = async (id: string) => {
  if (!file) return;
  setPendingRemove(null);
  setBusy(true);
  setErr(null);
  try {
   const edited = removeProvider(file.text, id);
   if (!edited.ok) {
    setErr(edited.error);
    return;
   }
   const next = await api.writeModelsConfig(edited.text, file.hash);
   setFile(next);
   const catalog = await api.refreshModels();
   set({ models: catalog });
  } catch (e) {
   setErr(e instanceof Error ? e.message : t.opFailed);
  } finally {
   setBusy(false);
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
  setRefreshing(true);
  setErr(null);
  try {
   await load(true);
  } finally {
   setRefreshing(false);
  }
 };

 const catalog = models?.models ?? [];
 const configured = (providers ?? []).filter((p) => p.configured);
 const parsed = file ? parseModelsConfig(file.text) : { providers: [], error: null };
 const pickedProvider = addPick ? (providers?.find((p) => p.id === addPick) ?? null) : null;
 /** 只认当前提供商的登录快照：刚点完时事件还没到，旧快照（上一次登录 / 初始空态）不算数。 */
 const activeLogin = login && login.provider === addPick ? login : null;

 return (
  <>
   {err && (
    <p role="alert" className="rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
     {err}
    </p>
   )}

   <section aria-label={t.providersSection} className="rounded-md border border-border bg-surface p-3.5">
    <div className="flex items-center gap-2">
     <Key size={14} aria-hidden className="text-muted" />
     <h2 className="text-sm font-medium">{t.providersSection}</h2>
     <button
      onClick={() => void refreshAll()}
      disabled={refreshing || busy}
      className="ml-auto flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      aria-label={t.providersRefresh}
      title={t.providersRefresh}
     >
      {refreshing ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
      {t.refresh}
     </button>
    </div>
    <p className="mt-1.5 text-[13px] text-faint">{t.providersHint}</p>

    {parsed.error && (
     <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
      {parsed.error.kind === "yaml" ? fmt(t.customYamlBroken, parsed.error.message) : t.customShapeBroken}
     </p>
    )}

    <div className="mt-2">
     {providers === null ? (
      <div className="py-2 text-[13px] text-muted">{t.archivedLoading}</div>
     ) : (
      <>
       {providers.length === 0 && (
        <div className="py-2 text-[13px] text-muted">{t.providerEmpty}</div>
       )}
       {providers.length > 0 && configured.length === 0 && parsed.providers.length === 0 && (
        <div className="py-2 text-[13px] text-muted">{t.providersEmptyAll}</div>
       )}
       {configured.map((p) => (
        <div key={p.id} className="border-t border-border-soft first:border-t-0">
         <div className="flex items-center gap-2 py-2">
          <div className="min-w-0 flex-1">
           <div className="truncate text-sm">{p.name}</div>
           <div className="font-mono text-xs text-muted">{p.id}</div>
          </div>
          <span className="shrink-0 text-[13px] text-ok">{t.providerConfigured}</span>
          <button
           onClick={() => setPicking(p)}
           className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
          >
           {t.providersPick}
          </button>
          <button
           onClick={() => relogin(p.id)}
           className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
           aria-label={fmt(t.providerLogin + " {0}", p.id)}
          >
           {t.providerLogin}
          </button>
          <button
           onClick={() => setPendingLogout(p)}
           className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
           aria-label={fmt(t.providerLogout + " {0}", p.id)}
          >
           {t.providerLogout}
          </button>
         </div>
        </div>
       ))}
       {parsed.providers.map((v) => (
        <CustomRow
         key={v.id}
         view={v}
         activeCount={catalog.filter((m) => m.provider === v.id).length}
         busy={busy}
         pending={pendingRemove === v.id}
         editing={!editing?.isNew && editing?.form.id === v.id}
         onEdit={() => beginEdit(v.id)}
         onAskRemove={() => {
          setPendingRemove(v.id);
          setEditing(null);
         }}
         onCancelRemove={() => setPendingRemove(null)}
         onRemove={() => void doRemove(v.id)}
        />
       ))}
      </>
     )}
    </div>

    {file && (
     <p className="mt-2 font-mono text-[10px] break-all text-faint" title={file.path}>
      {file.path}
      {!file.exists && ` · ${t.customFileMissing}`}
     </p>
    )}

    <button
     onClick={openAdd}
     disabled={providers === null || !!parsed.error}
     className="mt-2 flex cursor-pointer items-center gap-1 rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
    >
     <Plus size={12} aria-hidden />
     {t.providersAdd}
    </button>
   </section>

   {/* 挑选模型：该供应商在目录里的全部模型（搜索 + 星标）——fixed 弹窗，数据多也能过滤 */}
   {picking && (
    <ProviderModelsDialog
     provider={picking}
     catalog={catalog}
     myModels={myModels}
     onChange={setMyModels}
     onClose={() => setPicking(null)}
    />
   )}

   {/* 添加供应商：一个弹窗换内容——选提供商 →（「自定义」表单 ｜ 提供商凭据流程） */}
   {(addOpen || !!editing) && (
    <DialogShell
     title={
      editing
       ? editing.isNew
        ? t.customFormNew
        : fmt(t.customFormEdit, editing.form.id)
       : addPick === null
        ? t.providersAddPick
        : fmt(t.providersAddTitle, pickedProvider?.name ?? addPick)
     }
     onClose={() => void closeAdd(true)}
     width={editing ? "max-w-2xl" : "max-w-xl"}
    >
     {editing ? (
      <CustomProviderEditForm
       form={editing.form}
       isNew={editing.isNew}
       busy={busy}
       error={formErr}
       existingIds={parsed.providers.map((p) => p.id)}
       onChange={(form) => setEditing({ ...editing, form })}
       onCancel={() => {
        setEditing(null);
        setFormErr(null);
       }}
       onSave={() => void saveCustom()}
      />
     ) : addPick === null ? (
      <ProviderPicker providers={providers ?? []} onPick={pickProvider} />
     ) : (
      <LoginFlow
       providerId={addPick}
       providerName={pickedProvider?.name ?? null}
       status={activeLogin}
       catalog={catalog}
       myModels={myModels}
       onModelsChange={setMyModels}
       onClose={() => void closeAdd(!!activeLogin?.running)}
      />
     )}
    </DialogShell>
   )}

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

/** 一行自定义供应商（models.yml）：自定义块给编辑 / 删除；覆盖型块只读（手工维护的语义界面表达不了）。 */
function CustomRow({
 view,
 activeCount,
 busy,
 pending,
 editing,
 onEdit,
 onAskRemove,
 onCancelRemove,
 onRemove,
}: {
 view: CustomProviderView;
 activeCount: number;
 busy: boolean;
 pending: boolean;
 editing: boolean;
 onEdit: () => void;
 onAskRemove: () => void;
 onCancelRemove: () => void;
 onRemove: () => void;
}) {
 const t = useText();
 const kindLabel = view.kind === "custom" ? t.customKindCustom : t.customKindOverride;
 return (
  <div className="flex items-center gap-2 border-t border-border-soft py-2 first:border-t-0">
   <div className="min-w-0 flex-1">
    <div className="flex items-center gap-1.5">
     <span className="truncate font-mono text-sm">{view.id}</span>
     <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted">{kindLabel}</span>
     {view.kind === "custom" && (
      <span className={`shrink-0 text-[11px] ${activeCount > 0 ? "text-ok" : "text-faint"}`}>
       {activeCount > 0 ? fmt(t.customActive, String(activeCount)) : t.customInactive}
      </span>
     )}
    </div>
    <div className="truncate font-mono text-xs text-muted" title={view.baseUrl ?? undefined}>
     {view.baseUrl ?? "—"}
     {view.kind === "custom" && ` · ${fmt(t.customModelCount, String(view.modelCount))}`}
     {view.extraKeys.length > 0 && ` · ${fmt(t.customExtraKeys, view.extraKeys.join(" / "))}`}
    </div>
   </div>

   {view.kind === "override" ? (
    <span className="shrink-0 max-w-40 text-right text-[11px] text-faint">{t.customOverrideHint}</span>
   ) : pending ? (
    <>
     <span className="shrink-0 text-[13px] text-warn">{fmt(t.customRemoveConfirm, view.id)}</span>
     <button
      onClick={onRemove}
      disabled={busy}
      className="shrink-0 cursor-pointer rounded-md border border-danger/50 px-2.5 py-1 text-[13px] text-danger transition-colors duration-100 hover:bg-danger/10 disabled:opacity-50"
     >
      {t.customRemove}
     </button>
     <button
      onClick={onCancelRemove}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover"
     >
      {t.cancel}
     </button>
    </>
   ) : (
    <>
     <button
      onClick={onEdit}
      disabled={busy || editing}
      className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-50"
     >
      {t.customEdit}
     </button>
     <button
      onClick={onAskRemove}
      disabled={busy || editing}
      aria-label={fmt(t.customRemoveAria, view.id)}
      className="flex shrink-0 cursor-pointer items-center rounded-md border border-border p-1.5 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-50"
     >
      <Trash2 size={12} aria-hidden />
     </button>
    </>
   )}
  </div>
 );
}

/**
 * 凭据流程卡（添加 / 重新登录某个登录型供应商）：上游输出窗口 + URL（打开 / 复制）+ 输入行。
 * API key 直接粘进输入框提交；OAuth 型按上游给的链接去浏览器授权。成功后就地给出该供应商的
 * 模型列表——星标即加入「我的模型」（挑选入口的第二处，第一处是行内的「挑选模型」）。
 */
function LoginFlow({
 providerId,
 providerName,
 status,
 catalog,
 myModels,
 onModelsChange,
 onClose,
}: {
 providerId: string;
 providerName: string | null;
 /** 事件还没到时为 null（刚点完，正等第一次快照）——按「进行中」显示。 */
 status: ProviderLoginStatus | null;
 catalog: ModelInfo[];
 myModels: string[];
 onModelsChange: (next: string[]) => void;
 onClose: () => void;
}) {
 const t = useText();
 const [text, setText] = useState("");
 const [copied, setCopied] = useState(false);
 const running = status?.running ?? true;
 const done = status?.done ?? null;
 const ok = !!done?.ok;

 const copyUrl = async () => {
  if (!status?.url) return;
  try {
   await navigator.clipboard.writeText(status.url);
   setCopied(true);
   window.setTimeout(() => setCopied(false), 1500);
  } catch {
   // 复制失败不阻断流程：URL 就在屏幕上，可以手动选中
  }
 };

 const send = async () => {
  const v = text.trim();
  if (!v) return;
  try {
   await api.providerLoginInput(v);
   setText("");
  } catch {
   // 子进程已结束：状态由事件流收敛，不再打扰用户
  }
 };

 const title = ok
  ? fmt(t.providersAddAdded, providerName ?? providerId)
  : running
   ? t.loginWaiting
   : done?.cancelled
    ? t.loginCancelled
    : t.loginFailed;

 return (
  <div className="rounded border border-accent/40 bg-accent/5 p-2.5">
   <div className="flex items-center gap-2 text-sm">
    {running ? (
     <Loader size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
    ) : ok ? (
     <Check size={14} className="shrink-0 text-ok" aria-hidden />
    ) : (
     <Key size={14} className="shrink-0 text-warn" aria-hidden />
    )}
    <span className={running || ok ? "" : "text-warn"}>{title}</span>
    <span className="ml-auto shrink-0 font-mono text-xs text-muted">{providerId}</span>
    <button
     onClick={onClose}
     className="shrink-0 cursor-pointer rounded border border-border px-2 py-0.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     {running ? t.cancel : ok ? t.providersAddDone : t.close}
    </button>
   </div>

   {status?.done?.message && (
    <p className="mt-2 font-mono text-xs break-words text-danger">{status.done.message}</p>
   )}

   {status?.url && (
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

   {status && status.lines.length > 0 && (
    <div className="mt-2">
     <div className="text-[13px] text-faint">{t.loginOutput}</div>
     <pre className="mt-1 max-h-36 overflow-y-auto rounded bg-background p-2 font-mono text-xs whitespace-pre-wrap text-muted">
      {status.lines.join("\n")}
     </pre>
    </div>
   )}

   {running && (
    <>
     <p className="mt-2 text-[12px] text-faint">{t.providersAddHint}</p>
     <form
      className="mt-1 flex items-center gap-2"
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
     </form>
    </>
   )}

   {ok && (
    <div className="mt-2 rounded-md border border-border bg-background p-2">
     <ProviderModelsList providerId={providerId} catalog={catalog} myModels={myModels} onChange={onModelsChange} />
    </div>
   )}
  </div>
 );
}
