import { useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import { Check, ChevronRight, Loader2, X } from "lucide-react";
import type { ViewMsg } from "@shared/types";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";

export function ToolCard({ m, cwd }: { m: Extract<ViewMsg, { kind: "tool" }>; cwd?: string }) {
  const t = useText();
  const [open, setOpen] = useState(m.state === "error");
  const [showFull, setShowFull] = useState(false);
  const stateText =
    m.state === "ok"
      ? t.toolStateOk
      : m.state === "error"
        ? t.toolStateError
        : m.state === "running"
          ? t.toolStateRunning
          : t.toolStateStreaming;
  // 数据层不再内嵌占位文案：`argsSummary` 可能为空，展示时按状态兜底
  const summary = m.argsSummary || (m.state === "streaming" ? t.toolStreaming : t.toolNoArgs);
  const dot =
    m.state === "ok" ? "bg-ok" : m.state === "error" ? "bg-danger" : "bg-accent animate-pulse";
  return (
    <div
      className={`rounded-xl border bg-surface/70 transition-colors duration-150 ${m.state === "error" ? "border-danger/60" : "border-border/70"}`}
      role="group"
      aria-label={fmt(t.toolAria, m.name, stateText)}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors duration-150 hover:bg-background/50"
        aria-expanded={open}
      >
        {m.state === "ok" ? (
          <Check size={14} className="shrink-0 text-ok" aria-hidden />
        ) : m.state === "error" ? (
          <X size={14} className="shrink-0 text-danger" aria-hidden />
        ) : (
          <Loader2 size={14} className="shrink-0 animate-spin text-accent" aria-hidden />
        )}
        <span className="font-mono text-sm font-medium">{m.name}</span>
        {m.intent && <span className="truncate text-sm text-muted">· {m.intent}</span>}
        <ChevronRight
          size={14}
          aria-hidden
          className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} title={stateText} aria-hidden />
        <span className="sr-only">{stateText}</span>
      </button>
      {open && (
        <div className="border-t border-border/70 px-3 py-2">
          <button
            className="block w-full cursor-pointer truncate text-left font-mono text-xs text-muted hover:text-foreground"
            title={fmt(t.toolOpenTitle, summary)}
            onClick={() => {
              const mth = m.argsSummary.match(/([~/][^\s:"']+|[A-Za-z]:\\[^\s"']+|[\w\-./]+\.[A-Za-z0-9]{1,5})/);
              const p = mth?.[1];
              if (!p) return;
              const full = p.startsWith("/") || /^[A-Za-z]:/.test(p) ? p : cwd ? `${cwd}/${p}` : p;
              void openPath(full).catch(() => undefined);
            }}
          >
            {summary}
          </button>
          {m.output && (
            <div className="mt-1.5">
              <pre className="max-h-60 overflow-auto rounded-lg bg-code p-2.5 font-mono text-xs leading-5 whitespace-pre-wrap">
                {showFull && m.outputFull ? m.outputFull : m.output}
              </pre>
              {m.outputFull && (
                <button
                  onClick={() => setShowFull((v) => !v)}
                  className="mt-1 cursor-pointer text-xs text-accent transition-opacity duration-150 hover:opacity-80"
                >
                  {showFull ? t.collapse : t.expand}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
