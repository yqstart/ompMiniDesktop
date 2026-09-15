import { useCallback, useState } from "react";
import { ChevronDown, RefreshCw } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import { highestThinking } from "../../lib/thinking";
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
  const { models, set, composerMenu, activeSessionId, currentModel } = useApp();
  const open = composerMenu === "model";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "model" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const current: ModelInfo | null =
    (models?.models.find((m) => m.selector === currentModel) as ModelInfo | undefined) ??
    models?.models[0] ??
    null;

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
        className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 whitespace-nowrap transition-colors duration-150 hover:bg-background ${
          compact ? "text-xs text-muted hover:text-foreground" : "text-sm"
        }`}
        aria-label="选择模型"
        aria-expanded={open}
      >
        <span className="whitespace-nowrap">{current ? shortName(current) : "模型"}</span>
        <ChevronDown size={13} aria-hidden className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-9 z-10 max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">
          <div className="flex items-center gap-2">
            <label htmlFor="model-search" className="sr-only">搜索模型</label>
            <input
              id="model-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="搜索模型…"
              className="flex-1 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
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
                  onClick={() => void pick(m)}
                  className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 hover:bg-background"
                  aria-label={`使用模型 ${m.name}`}
                >
                  <span className="truncate">{m.name}</span>
                  <span className="ml-auto flex shrink-0 gap-1 font-mono text-xs text-muted">
                    {m.contextWindow ? <span>{fmtCtx(m.contextWindow)}</span> : null}
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
