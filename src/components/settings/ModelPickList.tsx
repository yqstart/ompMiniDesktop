import { useRef, useState, type Ref } from "react";
import type { ModelInfo } from "@shared/types";
import { fmt } from "../../lib/locale";
import { fmtContextWindow, shortModelName } from "../../lib/modelNames";
import { useText } from "../../lib/useText";
import { DialogShell } from "./DialogShell";

/**
 * 模型选择列表（搜索框 + 按供应商分组平铺 + 点选）——由 `ModelPickerDialog` 装进弹窗，
 * 调用方不该直接渲染它（行内展开会把设置页撑成一条、点开时页面跳动）。
 */
export function ModelPickList({
 models,
 selected,
 onPick,
 inputRef,
}: {
 models: ModelInfo[];
 selected?: string;
 onPick: (m: ModelInfo) => void;
 /** 弹窗把搜索框当初始焦点用（打开即可输入）。 */
 inputRef?: Ref<HTMLInputElement>;
}) {
 const t = useText();
 const [q, setQ] = useState("");
 const query = q.trim().toLowerCase();
 const list = query
  ? models.filter((m) => `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(query))
  : models;
 const groups = new Map<string, ModelInfo[]>();
 for (const m of list) {
  const g = groups.get(m.provider) ?? [];
  g.push(m);
  groups.set(m.provider, g);
 }

 return (
  <>
   <input
    ref={inputRef}
    value={q}
    onChange={(e) => setQ(e.target.value)}
    placeholder={t.roleSearchPlaceholder}
    aria-label={t.roleSearchPlaceholder}
    className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px]"
   />
   <div className="mt-2 max-h-[min(50dvh,24rem)] overflow-y-auto">
    {[...groups].map(([provider, ms]) => (
     <div key={provider}>
      <div className="px-2 pt-3 pb-1 font-mono text-[11px] break-all text-faint">{provider}</div>
      {ms.map((m) => (
       <button
        key={m.selector}
        onClick={() => onPick(m)}
        aria-pressed={selected === m.selector}
        title={m.selector}
        className={`flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] transition-colors duration-100 hover:bg-hover ${selected === m.selector ? "bg-active" : ""}`}
        aria-label={fmt(t.useModelAria, m.name)}
       >
        <span className="min-w-0 flex-1">
         <span className="block truncate">{shortModelName(m)}</span>
         <span className="block truncate font-mono text-[11px] text-faint">{m.id}</span>
        </span>
        <span className="ml-auto flex shrink-0 gap-1 font-mono text-xs text-muted">
         {m.contextWindow ? <span>{fmtContextWindow(m.contextWindow)}</span> : null}
        </span>
       </button>
      ))}
     </div>
    ))}
    {list.length === 0 && <div className="p-2 text-[13px] text-muted">{t.noModelMatch}</div>}
   </div>
  </>
 );
}

/**
 * 模型选择弹窗（`DialogShell` 壳 + 上面的列表）：模型角色行、失败转移链的模型对象与转移目标
 * **三处共用**——行内展开会把下方区块整体推下去（点开 / 关上时页面跳动），弹窗不参与文档流。
 *
 * 打开即聚焦搜索框；点选即 `onPick`（调用方负责收起弹窗并落库），Esc / 遮罩 / X 关闭 = 取消。
 */
export function ModelPickerDialog({
 title,
 models,
 selected,
 onPick,
 onClose,
}: {
 title: string;
 models: ModelInfo[];
 selected?: string;
 onPick: (m: ModelInfo) => void;
 onClose: () => void;
}) {
 const inputRef = useRef<HTMLInputElement>(null);
 return (
  <DialogShell title={title} onClose={onClose} initialFocusRef={inputRef}>
   <ModelPickList models={models} selected={selected} onPick={onPick} inputRef={inputRef} />
  </DialogShell>
 );
}
