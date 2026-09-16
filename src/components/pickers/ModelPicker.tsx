import { useCallback, useState } from "react";
import { ChevronDown, Refresh } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { favoriteEntries } from "../../lib/favoriteModels";
import { fmt } from "../../lib/locale";
import { useDropdown } from "../../lib/useDropdown";
import { highestThinking } from "../../lib/thinking";
import { useText } from "../../lib/useText";
import type { ModelInfo } from "@shared/types";

function shortName(m: ModelInfo): string {
 return m.name.replace(/^Claude\s+/i, "").replace(/\s+\d\.\d+$/, "");
}

function fmtCtx(n: number | null): string {
 if (!n) return "";
 if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
 return `${Math.round(n / 1000)}K`;
}

export function ModelPicker({ compact = false }: { compact?: boolean }) {
 const t = useText();
 const { models, set, composerMenu, activeSessionId, currentModel, favoriteModels } = useApp();
 const open = composerMenu === "model";
 const setOpen = useCallback(
  (v: boolean) => useApp.setState({ composerMenu: v ? "model" : null }),
  [],
 );
 const ref = useDropdown(open, () => setOpen(false));
 const [q, setQ] = useState("");
 const [loading, setLoading] = useState(false);
 const catalog = models?.models ?? [];
 const current: ModelInfo | null = catalog.find((m) => m.selector === currentModel) ?? null;

 /**
  * 选模型：乐观更新本地态（omp 真值随后经 `omp-state://` 回读收敛）。
  * 思考档交给后端联动——omp 切模型后不会自动修正档位，由 runtime 自动重设为该模型最高档。
  */
 const pick = async (m: ModelInfo) => {
  setOpen(false);
  const st = useApp.getState();
  const rollback = {
   currentModel: st.currentModel,
   currentThinking: st.currentThinking,
   currentEfforts: st.currentEfforts,
  };
  const efforts = m.thinking ?? null;
  set({ currentModel: m.selector, currentEfforts: efforts, currentThinking: highestThinking(efforts) });
  if (!activeSessionId) return;
  try {
   await api.setModel(activeSessionId, m.provider, m.id);
  } catch {
   set(rollback); // 会话未运行等；omp 侧拒绝会走事件分隔线，真值回读兜底
  }
 };

 const load = async (force: boolean) => {
  setLoading(true);
  try {
   const cat = force ? await api.refreshModels() : await api.getModels();
   set({ models: cat });
  } catch {
   // 内联错误由 M3-1 补，此处静默
  } finally {
   setLoading(false);
  }
 };

 // 常用模型（按挑选顺序解析，目录里已不可用的直接不列）；一个可用项都没有时回退全部可用模型
 const favorites = favoriteEntries(favoriteModels, catalog).flatMap((e) => (e.model ? [e.model] : []));
 const showAllModels = favorites.length === 0;
 const list = (showAllModels ? catalog : favorites).filter((m) =>
  q.trim() ? `${m.provider}/${m.id} ${m.name}`.toLowerCase().includes(q.toLowerCase()) : true,
 );
 const groups = new Map<string, ModelInfo[]>();
 for (const m of list) {
  const g = groups.get(m.provider) ?? [];
  g.push(m);
  groups.set(m.provider, g);
 }

 return (
  <div className="relative" ref={ref}>
   <button
    onClick={() => {
     setOpen(!open);
     if (!models && !open) void load(false);
    }}
    className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 whitespace-nowrap transition-colors duration-100 hover:bg-hover ${compact ? "text-[13px] text-muted hover:text-foreground" : "text-[13px]"
     }`}
    aria-label={t.chooseModel}
    aria-expanded={open}
   >
    <span className="whitespace-nowrap">{current ? shortName(current) : t.modelLabel}</span>
    <ChevronDown size={13} aria-hidden className="shrink-0 opacity-60" />
   </button>
   {open && (
    <div className="absolute right-0 bottom-8 z-10 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-border bg-elevated p-2 shadow-pop">
     <div className="flex items-center gap-2">
      <label htmlFor="model-search" className="sr-only">{t.searchModelLabel}</label>
      <input
       id="model-search"
       value={q}
       onChange={(e) => setQ(e.target.value)}
       placeholder={t.searchModelPlaceholder}
       className="flex-1 rounded-md border border-border bg-background px-2 py-1 text-[13px] outline-none"
      />
      <button
       onClick={() => void load(true)}
       disabled={loading}
       className="cursor-pointer rounded-md p-1.5 transition-colors duration-100 hover:bg-hover disabled:opacity-50"
       aria-label={t.refreshModels}
      >
       <Refresh size={14} className={loading ? "animate-spin" : ""} aria-hidden />
      </button>
     </div>
     {showAllModels && (
      <div className="px-1 pt-1.5 text-xs text-faint">{t.pickerAllModelsHint}</div>
     )}
     {[...groups].map(([provider, ms]) => (
      <div key={provider}>
       <div className="px-1 pt-2 pb-0.5 font-mono text-xs text-muted">{provider}</div>
       {ms.map((m) => (
        <button
         key={m.selector}
         onClick={() => void pick(m)}
         className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100 hover:bg-hover"
         aria-label={fmt(t.useModelAria, m.name)}
        >
         <span className="truncate">{m.name}</span>
         <span className="ml-auto flex shrink-0 gap-1 font-mono text-xs text-muted">
          {m.contextWindow ? <span>{fmtCtx(m.contextWindow)}</span> : null}
          {m.input?.includes("image") ? <span>{t.imageCap}</span> : null}
         </span>
        </button>
       ))}
      </div>
     ))}
     {list.length === 0 && <div className="p-2 text-[13px] text-muted">{t.noModelMatch}</div>}
    </div>
   )}
  </div>
 );
}
