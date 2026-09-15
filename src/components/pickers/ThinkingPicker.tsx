import { useCallback } from "react";
import { ChevronDown } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import { THINKING_LEVELS } from "@shared/types";

export function ThinkingPicker({ compact = false }: { compact?: boolean }) {
  const { models, activeSessionId, composerMenu } = useApp();
  const open = composerMenu === "thinking";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "thinking" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const selector = useApp.getState().currentModel as string | undefined;
  const current = models?.models.find((m) => m.selector === selector);
  const allowed = new Set(current?.thinking ?? ["off"]);
  const value = (useApp.getState().currentThinking as string | undefined) ?? "off";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex cursor-pointer items-center gap-1 rounded-full px-2.5 py-1 transition-colors duration-150 hover:bg-background ${
          compact ? "text-xs text-muted hover:text-foreground" : "text-sm"
        }`}
        aria-label="选择思考等级"
        aria-expanded={open}
      >
        <span>{value}</span>
        <ChevronDown size={13} aria-hidden className="opacity-60" />
      </button>
      {open && (
        <div className="absolute bottom-9 left-0 z-10 w-48 rounded-xl border border-border bg-surface p-1 shadow-xl">
          {THINKING_LEVELS.map((lv) => {
            const ok = allowed.has(lv);
            return (
              <button
                key={lv}
                disabled={!ok}
                title={ok ? "" : `当前模型不支持 ${lv}（可用：${[...allowed].join("/")}）`}
                onClick={() => {
                  useApp.setState({ currentThinking: lv } as never);
                  setOpen(false);
                  if (activeSessionId) void api.setThinking(activeSessionId, lv).catch(() => undefined);
                }}
                className="block w-full cursor-pointer rounded px-2 py-1.5 text-left text-sm transition-colors duration-200 hover:bg-background disabled:cursor-not-allowed disabled:opacity-40"
                aria-label={`思考等级 ${lv}${ok ? "" : "（不支持）"}`}
              >
                {lv}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
