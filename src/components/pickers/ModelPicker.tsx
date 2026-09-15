import { useCallback, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
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
  const { models, set, composerMenu } = useApp();
  const open = composerMenu === "model";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "model" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const current: ModelInfo | null =
    (models?.models.find((m) => m.selector === useApp.getState().currentModel) as ModelInfo | undefined) ??
    models?.models[0] ??
    null;

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

  const list = (models?.models ?? []).filter((m) =>
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
        className={`flex cursor-pointer items-center gap-1 truncate rounded-full px-2.5 py-1 transition-colors duration-150 hover:bg-background ${
          compact ? "max-w-32 text-xs text-muted hover:text-foreground" : "max-w-44 text-[13px]"
        }`}
        aria-label="选择模型"
        aria-expanded={open}
      >
        <span className="truncate">{current ? shortName(current) : "模型"}</span>
        <ChevronDown size={13} aria-hidden className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-10 max-h-80 w-80 overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">
          <div className="flex items-center gap-2">
            <label htmlFor="model-search" className="sr-only">搜索模型</label>
            <input
              id="model-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索模型…"
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-[13px] outline-none"
            />
            <button
              onClick={() => void load(true)}
              disabled={loading}
              className="cursor-pointer rounded p-1.5 transition-colors duration-200 hover:bg-background disabled:opacity-50"
              aria-label="刷新模型列表"
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} aria-hidden />
            </button>
          </div>
          {[...groups].map(([provider, ms]) => (
            <div key={provider}>
              <div className="px-1 pt-2 pb-0.5 font-mono text-xs text-muted">{provider}</div>
              {ms.map((m) => (
                <button
                  key={m.selector}
                  onClick={() => {
                    set({ currentModel: m.selector } as never);
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-[13px] transition-colors duration-200 hover:bg-background"
                  aria-label={`使用模型 ${m.name}`}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto flex shrink-0 gap-1 font-mono text-xs text-muted">
                    {m.contextWindow ? <span>{fmtCtx(m.contextWindow)}</span> : null}
                    {m.thinking ? <span>思{m.thinking.length}</span> : null}
                    {m.input?.includes("image") ? <span>图</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ))}
          {list.length === 0 && <div className="p-2 text-sm text-muted">无匹配模型</div>}
        </div>
      )}
    </div>
  );
}
