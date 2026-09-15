import { useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import { thinkingLevelsOf } from "../../lib/thinking";

/**
 * 思考档选择器：**只列当前模型真正支持的档位**（off 恒可用）。
 * 可用集优先取 omp 真值 `currentEfforts`（切模型/外部改档都会回读），模型目录兜底。
 */
export function ThinkingPicker({ compact = false }: { compact?: boolean }) {
  const { models, activeSessionId, composerMenu, currentModel, currentThinking, currentEfforts } = useApp();
  const open = composerMenu === "thinking";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "thinking" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const current = models?.models.find((m) => m.selector === currentModel);
  const levels = thinkingLevelsOf(currentEfforts ?? current?.thinking ?? null);
  // 真值非法/缺失时显示层归一到支持档的第一项（下发纠正由 runtime 与真值回读负责）
  const value = currentThinking && levels.includes(currentThinking) ? currentThinking : (levels[0] ?? "off");
  const noThinking = levels.length <= 1 && !!activeSessionId;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 whitespace-nowrap transition-colors duration-150 hover:bg-background ${
          compact ? "text-xs text-muted hover:text-foreground" : "text-sm"
        }`}
        aria-label="选择思考等级"
        aria-expanded={open}
        title={noThinking ? "当前模型不支持思考等级" : `可用档位：${levels.join(" / ")}`}
      >
        <span>{value}</span>
        <ChevronDown size={13} aria-hidden className="opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-9 z-10 w-48 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-surface p-1 shadow-xl">
          {levels.map((lv) => (
            <button
              key={lv}
              onClick={() => {
                useApp.setState({ currentThinking: lv });
                setOpen(false);
                if (activeSessionId) void api.setThinking(activeSessionId, lv).catch(() => undefined);
              }}
              className={`block w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 hover:bg-background ${
                lv === value ? "text-foreground" : "text-muted"
              }`}
              aria-label={`思考等级 ${lv}`}
            >
              {lv}
            </button>
          ))}
          {noThinking && <div className="px-2 py-1.5 text-xs text-muted">当前模型不支持思考</div>}
        </div>
      )}
    </div>
  );
}
