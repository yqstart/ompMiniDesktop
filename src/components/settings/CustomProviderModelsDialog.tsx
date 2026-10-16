import { useState } from "react";
import { Check, Loader, Plus, Refresh, Trash2 } from "reicon-react";
import { api } from "@shared/api";
import type { DiscoveredModel, ModelsConfigFile } from "@shared/types";
import {
 emptyModelForm,
 isValidModelLimit,
 mergeDiscoveredModels,
 modelsComplete,
 providerFormOf,
 providerModelsOf,
 setProviderModels,
 type CustomModelForm,
} from "../../lib/customModels";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { DialogShell } from "./DialogShell";
import { Switch } from "./Switch";

/**
 * 自定义供应商的「挑选模型」弹窗（供应商配置与模型清单拆开之后的模型侧，2026-10-17）。
 *
 * 两段式：
 * 1. **清单**（主视图）= 该供应商在 `models.yml` 里的 `models` 列表：逐条可展开调参
 *    （显示名 / 上下文窗口 / 最大输出 / 推理 / 输入模态），也可手工添加或删除；
 * 2. **候选**（点「获取可用模型」进入）= 直接问端点要来的模型清单（`fetch_provider_models`），
 *    搜索 + 全选/取消全选（只作用于可见项）+「添加所选」把勾中的合并进清单——
 *    已有同 id 的条目保留用户调过的值，不重复、不覆盖。
 *
 * 口径参考 DeepSeek Harness 的「获取可用模型」：请求 URL / 认证头 / 响应解析全在
 * `src-tauri/src/provider_models.rs`；这里只管交互——拉取结果**不落盘**，真正写文件在
 * 「保存」（`setProviderModels` 保真编辑 + 后端预校验 / 备份 / 原子写 / 乐观锁）。
 */
export function CustomProviderModelsDialog({
 provider,
 file,
 onSaved,
 onClose,
}: {
 provider: { id: string; name: string };
 /** 打开时的 `models.yml` 快照（写入用它的 hash 做乐观锁）。 */
 file: ModelsConfigFile;
 /** 写入成功：回传新快照（父层据此刷新供应商行与模型目录）。 */
 onSaved: (file: ModelsConfigFile) => void;
 onClose: () => void;
}) {
 const t = useText();
 /** 打开时的快照：供应商级配置（探测要用 baseUrl / api / apiKey）与当前模型清单。
  *  清单形状界面表达不了（非 seq / 含非 map 项）时 `models` 为 null——**只读**，不许保存
  *  （保存会按空清单删掉 `models` 键，等于丢用户手工写的内容）。 */
 const [snapshot] = useState(() => ({
  config: providerFormOf(file.text, provider.id),
  models: providerModelsOf(file.text, provider.id),
 }));
 const config = snapshot.config;
 const readOnly = snapshot.models === null;
 const [models, setModels] = useState<CustomModelForm[]>(() => snapshot.models ?? []);
 const [expanded, setExpanded] = useState<number | null>(null);
 const [picking, setPicking] = useState(false);
 const [found, setFound] = useState<DiscoveredModel[]>([]);
 const [picked, setPicked] = useState<Set<string>>(new Set());
 const [q, setQ] = useState("");
 const [fetching, setFetching] = useState(false);
 const [fetchError, setFetchError] = useState<string | null>(null);
 const [saving, setSaving] = useState(false);
 const [saveError, setSaveError] = useState<string | null>(null);

 const errText = (e: unknown) => (e instanceof Error ? e.message : t.opFailed);

 /** 问端点要模型清单；成功即进候选视图，并默认勾选「清单里还没有的」（与 DSH 同口径）。 */
 const fetchModels = async () => {
  if (!config || fetching) return;
  setFetching(true);
  setFetchError(null);
  try {
   const list = await api.fetchProviderModels(config.baseUrl.trim(), config.api.trim(), config.apiKey.trim() || null);
   const known = new Set(models.map((m) => m.id.trim()));
   setFound(list);
   setPicked(new Set(list.filter((m) => !known.has(m.id.trim())).map((m) => m.id)));
   setQ("");
   setPicking(true);
  } catch (e) {
   setFetchError(errText(e));
  } finally {
   setFetching(false);
  }
 };

 const setModel = (i: number, next: Partial<CustomModelForm>) => {
  setModels(models.map((m, j) => (j === i ? { ...m, ...next } : m)));
 };

 const adopt = () => {
  const chosen = found.filter((m) => picked.has(m.id));
  setModels(mergeDiscoveredModels(models, chosen));
  setPicking(false);
  setExpanded(null);
 };

 const save = async () => {
  if (saving || readOnly) return;
  const edited = setProviderModels(file.text, provider.id, models);
  if (!edited.ok) {
   setSaveError(edited.error);
   return;
  }
  setSaving(true);
  setSaveError(null);
  try {
   onSaved(await api.writeModelsConfig(edited.text, file.hash));
  } catch (e) {
   setSaveError(errText(e));
  } finally {
   setSaving(false);
  }
 };

 const ids = models.map((m) => m.id.trim());
 const duplicate = ids.some((id, i) => id !== "" && ids.indexOf(id) !== i);
 const ready = modelsComplete(models) || models.length === 0;
 const search = q.trim().toLowerCase();
 const shown = search
  ? found.filter((m) => `${m.id} ${m.name ?? ""}`.toLowerCase().includes(search))
  : found;
 const shownPicked = shown.filter((m) => picked.has(m.id)).length;
 const inList = new Set(ids);

 return (
  <DialogShell
   title={picking ? t.customModelsPickTitle : fmt(t.providersPickTitle, provider.name)}
   onClose={onClose}
   width="max-w-2xl"
  >
   {picking ? (
    <>
     <p className="text-[13px] text-muted">{t.customModelsPickHint}</p>
     <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder={t.providersPickSearch}
      aria-label={t.providersPickSearch}
      className="mt-3 w-full rounded-md border border-border bg-background px-3 py-2.5 text-[13px]"
     />
     <div className="mt-3 flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint">{fmt(t.providersPickCount, String(shownPicked), String(shown.length))}</span>
      <button
       onClick={() => setPicked(new Set(shown.map((m) => m.id)))}
       disabled={shown.length === 0 || shownPicked === shown.length}
       className="ml-auto cursor-pointer rounded border border-border px-2 py-0.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
      >
       {search ? t.providersPickFilteredAll : t.providersPickAll}
      </button>
      <button
       onClick={() => setPicked(new Set())}
       disabled={shownPicked === 0}
       className="cursor-pointer rounded border border-border px-2 py-0.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-40"
      >
       {search ? t.providersPickFilteredNone : t.providersPickNone}
      </button>
     </div>
     {found.length === 0 ? (
      <p className="mt-3 text-[13px] text-muted">{t.customModelsFetchEmpty}</p>
     ) : shown.length === 0 ? (
      <p className="mt-3 text-[13px] text-muted">{t.noModelMatch}</p>
     ) : (
      <div className="mt-3">
       {shown.map((m) => (
        <label
         key={m.id}
         className="flex min-h-11 cursor-pointer flex-wrap items-center gap-2 border-t border-border-soft py-3 text-[13px] first:border-t-0"
        >
         <input
          type="checkbox"
          checked={picked.has(m.id)}
          onChange={() =>
           setPicked((prev) => {
            const next = new Set(prev);
            if (next.has(m.id)) next.delete(m.id);
            else next.add(m.id);
            return next;
           })
          }
          className="size-4 shrink-0 accent-[var(--color-accent)]"
         />
         <span className="min-w-0 flex-1 truncate">{m.name ?? m.id}</span>
         {inList.has(m.id) && (
          <span className="shrink-0 rounded border border-border px-1 text-[10px] text-muted">{t.customModelsAlreadyAdded}</span>
         )}
         <span className="min-w-0 basis-full pl-6 font-mono text-[11px] break-all text-faint sm:ml-auto sm:max-w-[50%] sm:basis-auto sm:pl-0">{m.id}</span>
        </label>
       ))}
      </div>
     )}
     <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
      <button
       onClick={adopt}
       disabled={picked.size === 0}
       className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md bg-active px-4 py-2 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       <Check size={12} aria-hidden />
       {t.customModelsAdopt}
      </button>
      <button
       onClick={() => setPicking(false)}
       className="min-h-9 cursor-pointer rounded-md px-3 py-2 text-[13px] text-muted transition-colors duration-100 hover:bg-hover"
      >
       {t.cancel}
      </button>
     </div>
    </>
   ) : (
    <>
     <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-faint">{fmt(t.customModelCount, String(models.length))}</span>
      {duplicate && <span className="text-[11px] text-danger">{t.customModelDuplicate}</span>}
      <button
       onClick={() => void fetchModels()}
       disabled={fetching || saving || !config}
       title={config ? undefined : t.customModelsNoConfig}
       className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 text-[12px] font-medium transition-colors duration-100 hover:bg-hover disabled:opacity-40"
      >
       {fetching ? <Loader size={12} className="animate-spin" aria-hidden /> : <Refresh size={12} aria-hidden />}
       {fetching ? t.customModelsFetching : t.customModelsFetch}
      </button>
     </div>
     {fetchError && (
      <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 font-mono text-xs break-all text-danger">
       {fetchError}
      </p>
     )}
     {readOnly && (
      <p role="alert" className="mt-2 rounded border border-danger/40 bg-danger/5 px-3 py-2 text-[13px] text-danger">
       {t.customModelsReadOnly}
      </p>
     )}

     {models.length === 0 ? (
      <p className="mt-3 rounded-md bg-background px-3 py-3 text-[13px] text-muted">{t.customModelsEmpty}</p>
     ) : (
      <div className="mt-2">
       {models.map((m, i) => {
        const duplicateId = m.id.trim() !== "" && ids.some((id, j) => j !== i && id === m.id.trim());
        const invalidLimit = !isValidModelLimit(m.contextWindow) || !isValidModelLimit(m.maxTokens);
        const open = expanded === i;
        return (
         <div key={i} className="border-t border-border-soft py-3 first:border-t-0">
          <div className="flex flex-wrap items-center gap-2">
           <input
            value={m.id}
            onChange={(e) => setModel(i, { id: e.target.value })}
            placeholder="model-id"
            aria-label={t.customModelId}
            aria-invalid={duplicateId || m.id.trim() === ""}
            className="min-h-9 min-w-0 flex-1 basis-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-[13px] focus:border-accent aria-invalid:border-danger sm:basis-auto"
           />
           <button
            onClick={() => setExpanded(open ? null : i)}
            aria-expanded={open}
            className="shrink-0 cursor-pointer rounded-md border border-border px-2.5 py-1 text-[13px] transition-colors duration-100 hover:bg-hover"
           >
            {open ? t.customModelsCollapse : t.customModelsEdit}
           </button>
           <button
            onClick={() => {
             setModels(models.filter((_, j) => j !== i));
             setExpanded(null);
            }}
            aria-label={t.customModelRemove}
            title={t.customModelRemove}
            className="flex shrink-0 cursor-pointer items-center rounded-md border border-border p-1.5 text-muted transition-colors duration-100 hover:bg-hover hover:text-danger"
           >
            <Trash2 size={12} aria-hidden />
           </button>
          </div>
            {(duplicateId || m.id.trim() === "" || invalidLimit) && (
             <p className="mt-1.5 text-xs text-danger">
              {duplicateId ? t.customModelDuplicate : m.id.trim() === "" ? t.customFormRequired : t.customModelLimitInvalid}
             </p>
            )}

          {open && (
           <div className="mt-2 rounded-md bg-background p-3 sm:p-4">
            <label className="flex min-w-0 flex-col gap-1.5 text-[12px]">
             <span className="text-muted">{t.customModelName}</span>
             <input
              value={m.name}
              onChange={(e) => setModel(i, { name: e.target.value })}
              placeholder={m.id}
              className="min-h-9 w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] focus:border-accent"
             />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-3 text-[12px]">
             <label className="flex items-center gap-1.5">
              <span className="text-muted">{t.customModelContext}</span>
              <input
               value={m.contextWindow}
               onChange={(e) => setModel(i, { contextWindow: e.target.value })}
               inputMode="numeric"
               placeholder="128000"
               aria-label={t.customModelContext}
               className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-right font-mono focus:border-accent"
              />
             </label>
             <label className="flex items-center gap-1.5">
              <span className="text-muted">{t.customModelMaxTokens}</span>
              <input
               value={m.maxTokens}
               onChange={(e) => setModel(i, { maxTokens: e.target.value })}
               inputMode="numeric"
               placeholder="8192"
               aria-label={t.customModelMaxTokens}
               className="w-24 rounded-md border border-border bg-surface px-2 py-1.5 text-right font-mono focus:border-accent"
              />
             </label>
             <label className="flex items-center gap-1.5">
              <span className="text-muted">{t.customModelReasoning}</span>
              <Switch on={m.reasoning} disabled={saving} label={t.customModelReasoning} onToggle={() => setModel(i, { reasoning: !m.reasoning })} />
             </label>
             <div className="flex items-center gap-1.5">
              <span className="text-muted">{t.customModelInput}</span>
              {(["text", "image"] as const).map((mode) => {
               const on = m.input.includes(mode);
               return (
                <button
                 key={mode}
                 onClick={() =>
                  setModel(i, {
                   input: on ? m.input.filter((x) => x !== mode) : [...m.input, mode],
                  })
                 }
                 aria-pressed={on}
                 disabled={on && m.input.length === 1}
                 className={`cursor-pointer rounded border px-1.5 py-0.5 transition-colors duration-100 hover:bg-hover disabled:opacity-50 ${on ? "border-accent/60 text-accent" : "border-border text-muted"
                  }`}
                >
                 {mode === "text" ? t.customModelText : t.customModelImage}
                </button>
               );
              })}
             </div>
            </div>
            <p className="mt-2 text-[11px] text-faint">{t.customModelMetaHint}</p>
           </div>
          )}
         </div>
        );
       })}
      </div>
     )}

     <button
      onClick={() => {
       setModels([...models, emptyModelForm()]);
       setExpanded(models.length);
      }}
      className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] text-accent transition-colors duration-100 hover:bg-hover"
     >
      <Plus size={11} aria-hidden />
      {t.customModelAdd}
     </button>

     {saveError && (
      <p role="alert" className="mt-3 font-mono text-xs whitespace-pre-wrap break-all text-danger">
       {saveError}
      </p>
     )}

     <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border-soft pt-4">
      <button
       onClick={() => void save()}
       disabled={saving || !ready || readOnly}
       className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md bg-active px-4 py-2 text-[13px] font-medium text-accent transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {saving && <Loader size={12} className="animate-spin" aria-hidden />}
       {t.customSave}
      </button>
      <button
       onClick={onClose}
       disabled={saving}
       className="min-h-9 cursor-pointer rounded-md px-3 py-2 text-[13px] text-muted transition-colors duration-100 hover:bg-hover disabled:opacity-50"
      >
       {t.cancel}
      </button>
      <span className="basis-full text-[11px] leading-relaxed text-faint">
       {models.length === 0 ? t.customModelsEmptySaveHint : t.customModelsSaveHint}
      </span>
     </div>
    </>
   )}
  </DialogShell>
 );
}
