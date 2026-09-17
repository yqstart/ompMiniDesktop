import { useState } from "react";
import type { ModelInfo } from "@shared/types";
import { fmt } from "../../lib/locale";
import { addManyMyModels, removeManyMyModels, toggleMyModel } from "../../lib/myModels";
import { useText } from "../../lib/useText";
import { DialogShell } from "./DialogShell";
import { StarToggle } from "./StarToggle";

/**
 * 某个供应商在 omp 模型目录里的全部模型（星标 = 加入 / 移出「我的模型」）——两处共用：
 * 「挑选模型」弹窗，与添加供应商成功后弹窗里的就地挑选。
 *
 * 数据多（网关 / 订阅计划动辄几十个模型）：顶部搜索按 id 与名称过滤；「全选 / 清空」作用于
 * **当前过滤结果**（先搜到一撮再全选，符合直觉；无过滤时就是全部）；计数 = 已挑 / 全部。
 */
export function ProviderModelsList({
 providerId,
 catalog,
 myModels,
 onChange,
}: {
 providerId: string;
 catalog: ModelInfo[];
 myModels: string[];
 onChange: (next: string[]) => void;
}) {
 const t = useText();
 const [q, setQ] = useState("");
 const models = catalog.filter((m) => m.provider === providerId);
 const query = q.trim().toLowerCase();
 const shown = query ? models.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(query)) : models;
 const shownSelectors = shown.map((m) => m.selector);
 const picked = models.filter((m) => myModels.includes(m.selector)).length;

 return (
  <>
   <input
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder={t.providersPickSearch}
    aria-label={t.providersPickSearch}
    className="w-full rounded-md border border-border bg-surface px-2 py-1 text-[13px] outline-none"
   />
   <div className="mt-1.5 flex items-center gap-2">
    <span className="text-[12px] text-faint">{fmt(t.providersPickCount, String(picked), String(models.length))}</span>
    <button
     onClick={() => onChange(addManyMyModels(myModels, shownSelectors))}
     disabled={shownSelectors.length === 0}
     className="ml-auto cursor-pointer rounded border border-border px-2 py-0.5 text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
    >
     {t.providersPickAll}
    </button>
    <button
     onClick={() => onChange(removeManyMyModels(myModels, shownSelectors))}
     disabled={shownSelectors.length === 0}
     className="cursor-pointer rounded border border-border px-2 py-0.5 text-[12px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:opacity-40"
    >
     {t.providersPickNone}
    </button>
   </div>
   {models.length === 0 ? (
    <p className="mt-3 text-[13px] text-muted">{t.providersPickEmpty}</p>
   ) : shown.length === 0 ? (
    <p className="mt-3 text-[13px] text-muted">{t.noModelMatch}</p>
   ) : (
    <div className="mt-1.5">
     {shown.map((m) => (
      <div
       key={m.selector}
       className="flex items-center gap-2 border-t border-border-soft py-1.5 text-[13px] first:border-t-0"
      >
       <StarToggle on={myModels.includes(m.selector)} name={m.name} onClick={() => onChange(toggleMyModel(myModels, m.selector))} />
       <span className="min-w-0 flex-1 truncate">{m.name}</span>
       <span className="shrink-0 font-mono text-xs text-muted">{m.selector}</span>
      </div>
     ))}
    </div>
   )}
  </>
 );
}

/** 「挑选模型」弹窗（行上按钮打开）：把上面那份列表装进 fixed 弹窗。 */
export function ProviderModelsDialog({
 provider,
 catalog,
 myModels,
 onChange,
 onClose,
}: {
 provider: { id: string; name: string };
 catalog: ModelInfo[];
 myModels: string[];
 onChange: (next: string[]) => void;
 onClose: () => void;
}) {
 const t = useText();
 return (
  <DialogShell title={fmt(t.providersPickTitle, provider.name)} onClose={onClose} width="max-w-2xl">
   <ProviderModelsList providerId={provider.id} catalog={catalog} myModels={myModels} onChange={onChange} />
  </DialogShell>
 );
}
