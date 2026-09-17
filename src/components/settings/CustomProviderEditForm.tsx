import { useState } from "react";
import { ChevronDown, Loader, Plus, Trash2 } from "reicon-react";
import { useText } from "../../lib/useText";
import {
 apiOptionsFor,
 isDuplicateProviderId,
 isValidProviderId,
 providerFormComplete,
 type CustomModelForm,
 type CustomProviderForm,
} from "../../lib/customModels";
import { Switch } from "./Switch";

/**
 * 自定义供应商的编辑表单（`models.yml` 的新建 / 编辑共用）——「添加供应商」弹窗里选「自定义」
 * 后的内容（V12c 起是弹窗，标题由弹窗给，这里不再自带标题）。
 *
 * 表单只改本地态，保存时交给 `lib/customModels.ts` 的保真编辑（注释与界面之外的字段原样保留），
 * 再由后端预校验 / 备份 / 原子写。
 *
 * 口径：**名称可改**（`form.originalId` 记录原键名，保存时就地改名）；**接口类型两档**
 * （openai-completions / anthropic-messages，既有文件里的其它值原样列出）；**认证只有 API Key**
 * 一种（Key 常驻输入框；留空 = 该端点无需鉴权，落盘为 `auth: none`）。
 */
export function CustomProviderEditForm({
 form,
 busy,
 error,
 existingIds,
 onChange,
 onCancel,
 onSave,
}: {
 form: CustomProviderForm;
 busy: boolean;
 error: string | null;
 existingIds: string[];
 onChange: (form: CustomProviderForm) => void;
 onCancel: () => void;
 onSave: () => void;
}) {
 const t = useText();
 const [apiOpen, setApiOpen] = useState(false);
 const idTrim = form.id.trim();
 /** 名称格式错（空串 = 还没填，归入「必填项没填完」）：给专门提示，不然用户只看到笼统的「没填完」。 */
 const invalidId = idTrim !== "" && !isValidProviderId(idTrim);
 const dupId = isDuplicateProviderId(form, existingIds);
 const complete = providerFormComplete(form) && !dupId;
 const hint = invalidId ? t.customFormIdInvalid : dupId ? t.customFormDupId : t.customFormIncomplete;

 const setModel = (i: number, next: Partial<CustomModelForm>) => {
  const models = form.models.map((m, j) => (j === i ? { ...m, ...next } : m));
  onChange({ ...form, models });
 };

 const inputCls =
  "min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none transition-colors duration-100 focus:border-accent/70";

 return (
  <>
   <div className="flex flex-wrap items-center gap-2">
    <label className="flex w-52 items-center gap-1.5 text-[13px]">
     <span className="shrink-0 text-muted">{t.customFormName}</span>
     <input
      value={form.id}
      onChange={(e) => onChange({ ...form, id: e.target.value })}
      placeholder="my-gateway"
      title={t.customFormNameHint}
      aria-invalid={invalidId}
      className={`${inputCls} font-mono`}
     />
    </label>
    <label className="flex min-w-64 flex-1 items-center gap-1.5 text-[13px]">
     <span className="shrink-0 text-muted">{t.customFormBaseUrl}</span>
     <input
      value={form.baseUrl}
      onChange={(e) => onChange({ ...form, baseUrl: e.target.value })}
      placeholder="https://gw.example.com/v1"
      className={`${inputCls} font-mono`}
     />
    </label>
   </div>

   <div className="mt-2 flex flex-wrap items-center gap-2">
    <div className="flex items-center gap-1.5 text-[13px]">
     <span className="text-muted">{t.customFormApi}</span>
     <button
      onClick={() => setApiOpen((v) => !v)}
      aria-expanded={apiOpen}
      className="flex cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2 py-1 font-mono text-[12px] transition-colors duration-100 hover:bg-hover"
     >
      {form.api}
      <ChevronDown size={11} aria-hidden />
     </button>
    </div>

    <label className="flex min-w-52 flex-1 items-center gap-1.5 text-[13px]">
     <span className="shrink-0 text-muted">{t.customFormAuthKey}</span>
     <input
      value={form.apiKey}
      onChange={(e) => onChange({ ...form, apiKey: e.target.value })}
      placeholder="MY_GW_KEY"
      title={t.customFormApiKeyHint}
      className={`${inputCls} font-mono`}
     />
    </label>
   </div>

   {apiOpen && (
    <div className="mt-1.5 space-y-0.5 rounded-md border border-border bg-background p-1">
     {apiOptionsFor(form.api).map((opt) => (
      <button
       key={opt}
       onClick={() => {
        setApiOpen(false);
        onChange({ ...form, api: opt });
       }}
       aria-current={opt === form.api}
       className={`block w-full cursor-pointer truncate rounded px-2 py-1 text-left font-mono text-[12px] transition-colors duration-100 hover:bg-hover ${opt === form.api ? "text-accent" : ""
        }`}
      >
       {opt}
      </button>
     ))}
    </div>
   )}

   <div className="mt-2.5">
    <div className="text-[13px] text-muted">{t.customFormModels}</div>
    {form.models.map((m, i) => (
     <div key={i} className="mt-1.5 rounded border border-border bg-background p-2">
      <div className="flex items-center gap-2">
       <input
        value={m.id}
        onChange={(e) => setModel(i, { id: e.target.value })}
        placeholder="model-id"
        aria-label={t.customModelId}
        className={`${inputCls} font-mono`}
       />
       <input
        value={m.name}
        onChange={(e) => setModel(i, { name: e.target.value })}
        placeholder={t.customModelName}
        aria-label={t.customModelName}
        className={inputCls}
       />
       <button
        onClick={() => onChange({ ...form, models: form.models.filter((_, j) => j !== i) })}
        disabled={form.models.length <= 1}
        aria-label={t.customModelRemove}
        title={t.customModelRemove}
        className="flex shrink-0 cursor-pointer items-center rounded border border-border p-1 text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-30"
       >
        <Trash2 size={11} aria-hidden />
       </button>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[12px]">
       <label className="flex items-center gap-1.5">
        <span className="text-muted">{t.customModelContext}</span>
        <input
         value={m.contextWindow}
         onChange={(e) => setModel(i, { contextWindow: e.target.value })}
         inputMode="numeric"
         placeholder="128000"
         aria-label={t.customModelContext}
         className="no-focus-ring w-20 rounded border border-border bg-surface px-1.5 py-0.5 text-right font-mono outline-none focus:border-accent/70"
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
         className="no-focus-ring w-20 rounded border border-border bg-surface px-1.5 py-0.5 text-right font-mono outline-none focus:border-accent/70"
        />
       </label>
       <label className="flex items-center gap-1.5">
        <span className="text-muted">{t.customModelReasoning}</span>
        <Switch on={m.reasoning} disabled={false} label={t.customModelReasoning} onToggle={() => setModel(i, { reasoning: !m.reasoning })} />
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
           className={`cursor-pointer rounded border px-1.5 py-0.5 transition-colors duration-100 hover:bg-hover ${on ? "border-accent/60 text-accent" : "border-border text-muted"
            }`}
          >
           {mode === "text" ? t.customModelText : t.customModelImage}
          </button>
         );
        })}
       </div>
      </div>
     </div>
    ))}
    <button
     onClick={() =>
      onChange({
       ...form,
       models: [...form.models, { id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, input: ["text"] }],
      })
     }
     className="mt-1.5 flex cursor-pointer items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[12px] transition-colors duration-100 hover:bg-hover"
    >
     <Plus size={11} aria-hidden />
     {t.customModelAdd}
    </button>
   </div>

   {error && (
    <p role="alert" className="mt-2 font-mono text-xs whitespace-pre-wrap text-danger">
     {error}
    </p>
   )}

   <div className="mt-2.5 flex items-center gap-2">
    <button
     onClick={onSave}
     disabled={busy || !complete}
     className="flex cursor-pointer items-center gap-1 rounded-md border border-accent/60 bg-accent/15 px-3 py-1 text-[13px] transition-colors duration-100 hover:bg-accent/25 disabled:opacity-50"
    >
     {busy && <Loader size={12} className="animate-spin" aria-hidden />}
     {t.customSave}
    </button>
    <button
     onClick={onCancel}
     disabled={busy}
     className="cursor-pointer rounded-md border border-border px-3 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover disabled:opacity-50"
    >
     {t.cancel}
    </button>
    {!complete && <span className="text-[11px] text-warn">{hint}</span>}
    <span className="text-[11px] text-faint">{t.customSaveHint}</span>
   </div>
  </>
 );
}
