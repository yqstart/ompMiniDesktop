import { FileText, FileWarning } from "lucide-react";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import type { ViewMsg } from "@shared/types";

/**
 * `@文件` 芯片排（V2 M6b）：显示 omp 因为 `@路径` 实际读进上下文的文件。
 *
 * 与 `UserBubble` 里的原文并存：气泡是用户原话，这里是**上游真的读了哪些文件**的回执——
 * 跳过的文件（`skippedReason`：binary / tooLarge）用 warn 色标出来，避免"以为读进去了"。
 */
export function MentionChips({ m, cwd }: { m: Extract<ViewMsg, { kind: "files" }>; cwd?: string }) {
  const t = useText();
  return (
    <div className="flex flex-wrap items-center gap-1.5" aria-label={t.filesAria}>
      {m.files.map((f) => {
        const skipped = !!f.skippedReason;
        const meta = skipped
          ? fmt(t.fileSkipped, f.skippedReason ?? "")
          : [f.lineCount != null ? fmt(t.fileLines, f.lineCount) : null, f.byteSize != null ? `${Math.max(1, Math.round(f.byteSize / 1024))}KB` : null]
              .filter(Boolean)
              .join(" · ");
        return (
          <button
            key={f.path}
            onClick={() => {
              const full = f.path.startsWith("/") ? f.path : cwd ? `${cwd}/${f.path}` : f.path;
              void import("@tauri-apps/plugin-opener").then((mod) => mod.openPath(full).catch(() => undefined));
            }}
            title={skipped ? meta : `${f.path}${meta ? ` · ${meta}` : ""}`}
            className={`inline-flex max-w-full cursor-pointer items-center gap-1.5 rounded-lg border px-2 py-1 font-mono text-xs ${
              skipped ? "border-warn/50 text-warn" : "border-border/70 bg-surface/60 text-muted"
            }`}
          >
            {skipped ? <FileWarning size={12} aria-hidden /> : <FileText size={12} aria-hidden />}
            <span className="truncate">{f.path}</span>
            {meta && <span className="shrink-0 opacity-70">{meta}</span>}
          </button>
        );
      })}
    </div>
  );
}
