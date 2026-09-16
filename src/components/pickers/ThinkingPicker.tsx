import { useCallback } from "react";
import { ChevronDown } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useDropdown } from "../../lib/useDropdown";
import { thinkingLevelsOf } from "../../lib/thinking";
import { useText } from "../../lib/useText";

/**
 * 思考档选择器：**只列当前模型真正支持的档位**（off 恒可用）。
 * 可用集优先取 omp 真值 `currentEfforts`（切模型/外部改档都会回读），模型目录兜底。
 */
export function ThinkingPicker({ compact = false }: { compact?: boolean }) {
  const t = useText();
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
        className={`flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 whitespace-nowrap transition-colors duration-100 hover:bg-hover ${
          compact ? "text-[13px] text-muted hover:text-foreground" : "text-[13px]"
        }`}
        aria-label={t.chooseThinkingAria}
        aria-expanded={open}
        title={noThinking ? t.thinkingUnavailableTitle : fmt(t.thinkingLevelsTitle, levels.join(" / "))}
      >
        <span>{value}</span>
        <ChevronDown size={13} aria-hidden className="opacity-60" />
      </button>
      {open && (
        <div className="absolute right-0 bottom-8 z-10 w-48 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-elevated p-1 shadow-pop">
          {levels.map((lv) => (
            <button
              key={lv}
              onClick={() => {
                useApp.setState({ currentThinking: lv });
                setOpen(false);
                if (activeSessionId) void api.setThinking(activeSessionId, lv).catch(() => undefined);
              }}
              className={`block w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100 hover:bg-hover ${
                lv === value ? "text-foreground" : "text-muted"
              }`}
              aria-label={fmt(t.thinkingLevelAria, lv)}
            >
              {lv}
            </button>
          ))}
          {noThinking && <div className="px-2 py-1.5 text-[13px] text-muted">{t.thinkingUnsupported}</div>}
        </div>
      )}
    </div>
  );
}
