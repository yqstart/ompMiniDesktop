import { useState } from "react";
import { Check, Copy, Menu } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { loadSessions } from "../../lib/sessionList";
import { sessionToMarkdown } from "../../lib/exportMd";
import { UpdateBell } from "../update/UpdateDialog";

export function TopBar() {
  const { activeSessionId, sessions, eventsBySession, set } = useApp();
  const cur = sessions.find((s) => s.id === activeSessionId);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(cur?.note ?? "");
  const [copyState, setCopyState] = useState<"idle" | "ok" | "error">("idle");
  const title = cur?.title?.trim() || "未命名会话";

  /** 复制本会话为 Markdown：复用界面上已渲染的 ViewMsg，不额外读盘、不落盘。 */
  const copyMarkdown = async () => {
    if (!activeSessionId) return;
    const md = sessionToMarkdown(cur?.note?.trim() || title, eventsBySession[activeSessionId] ?? []);
    try {
      await navigator.clipboard.writeText(md);
      setCopyState("ok");
    } catch {
      setCopyState("error");
    }
    setTimeout(() => setCopyState("idle"), 1500);
  };

  return (
    // Overlay 标题栏：左侧留 72px 给 macOS 红绿灯，标题缺省取当前任务标题
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-1 border-b border-border/70 bg-background pr-3 pl-[72px]"
    >
      {/* 窄窗（<768px）左栏收起为抽屉：这里必须有打开入口，否则项目列表与设置不可达 */}
      <button
        onClick={() => set({ sidebarOpen: true })}
        className="mr-0.5 flex cursor-pointer items-center justify-center rounded p-1.5 text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground md:hidden"
        aria-label="打开侧栏"
        title="打开侧栏"
      >
        <Menu size={16} aria-hidden />
      </button>
      {editing && cur ? (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && cur) {
              void api
                .renameSessionNote(cur.id, note)
                .then(() => loadSessions())
                .catch(() => undefined);
              setEditing(false);
            }
            if (e.key === "Escape") setEditing(false);
          }}
          aria-label="重命名会话备注"
          className="w-44 rounded border border-border bg-background px-2 py-1 text-sm outline-none"
        />
      ) : (
        <button
          onClick={() => {
            setNote(cur?.note ?? "");
            setEditing(true);
          }}
          disabled={!cur}
          className="max-w-44 cursor-pointer truncate rounded px-1 text-[15px] font-semibold transition-colors duration-200 hover:bg-background disabled:cursor-default"
          aria-label={cur ? `会话标题 ${title}，点击改备注名` : "未命名会话"}
          title={cur ? "点击改备注名（不改 omp 原标题）" : ""}
        >
          {title}
        </button>
      )}
      <div className="ml-auto flex items-center">
        {/* 复制会话为 Markdown（V2 M9）：纯前端剪贴板，导出的就是界面上看到的内容 */}
        <button
          onClick={() => void copyMarkdown()}
          disabled={!activeSessionId || (eventsBySession[activeSessionId]?.length ?? 0) === 0}
          className="mr-1 cursor-pointer rounded p-1.5 text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground disabled:cursor-default disabled:opacity-40"
          aria-label="复制会话为 Markdown"
          title="复制本会话为 Markdown"
        >
          {copyState === "ok" ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
        </button>
        <UpdateBell />
      </div>
    </header>
  );
}
