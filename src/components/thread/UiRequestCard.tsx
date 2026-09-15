import { useEffect, useRef, useState } from "react";
import { MessageSquareQuote } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import type { ViewMsg } from "@shared/types";

/**
 * 通用 UI 请求卡（非审批）：omp 的 `confirm` / `input` / `editor` / 非审批 `select`。
 *
 * 与 `ApprovalCard` 的分工：审批 = `select(options 含 Approve)`，回包是 `{value:"Approve"}` /
 * `{cancelled:true}`，且「总是允许」要写会话级 yolo 意向；本卡回包按方法走
 * `respond_ui`（`confirm` → `{confirmed}`，`input`/`editor`/`select` → `{value}`，取消 → `{cancelled}`）。
 * 两者都是「agent 在等你」，出现即滚入视野、等待期间 composer 锁定。
 */
export function UiRequestCard({ m, sessionId }: { m: Extract<ViewMsg, { kind: "ui" }>; sessionId: string }) {
  const { statusBySession } = useApp();
  const [text, setText] = useState(m.prefill ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // 与审批卡同规矩：请求出现时必须带进视野（长会话里可能落在视口之外）
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const waiting = statusBySession[sessionId]?.state !== "awaiting-approval";

  const reply = async (
    kind: "value" | "confirm" | "cancel",
    opts?: { value?: string; confirmed?: boolean },
  ) => {
    setBusy(true);
    setError(null);
    try {
      await api.respondUi(sessionId, m.uiId, kind, opts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "回包失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const submitValue = () => {
    if (m.method !== "confirm") void reply("value", { value: text });
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      void reply("cancel");
      return;
    }
    // input：Enter 直接提交；editor：Cmd/Ctrl+Enter 提交，单独 Enter 留给换行
    const plainEnter = e.key === "Enter" && !e.shiftKey && (m.method === "input" || e.metaKey || e.ctrlKey);
    if (plainEnter) {
      e.preventDefault();
      submitValue();
    }
  };

  const btn = "cursor-pointer rounded-lg px-3.5 py-1.5 text-sm transition-colors duration-150 disabled:opacity-50";
  const primary = `${btn} bg-accent text-white hover:opacity-90`;
  const ghost = `${btn} border border-border hover:bg-background`;

  return (
    <div
      ref={ref}
      role="group"
      aria-label={m.title || "需要你的输入"}
      className="rounded-xl border border-accent/40 bg-surface p-3.5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <MessageSquareQuote size={15} className="text-accent" aria-hidden />
        <span className="text-sm font-medium">{m.title || "需要你的输入"}</span>
      </div>
      {m.message && (
        <div className="mt-1.5 rounded-lg bg-code px-2.5 py-2 text-xs whitespace-pre-wrap">{m.message}</div>
      )}
      {m.method === "input" && (
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={m.placeholder ?? ""}
          aria-label={m.title || "输入"}
          autoFocus
          disabled={busy}
          className="mt-2 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm outline-none focus:border-accent/60"
        />
      )}
      {m.method === "editor" && (
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          rows={5}
          aria-label={m.title || "编辑"}
          autoFocus
          disabled={busy}
          className="mt-2 w-full resize-y rounded-lg border border-border bg-background px-2.5 py-1.5 font-mono text-xs leading-5 outline-none focus:border-accent/60"
        />
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-2">
        {m.method === "confirm" && (
          <>
            <button
              className={primary}
              autoFocus
              disabled={busy}
              onClick={() => void reply("confirm", { confirmed: true })}
            >
              确认
            </button>
            <button className={ghost} disabled={busy} onClick={() => void reply("confirm", { confirmed: false })}>
              取消
            </button>
          </>
        )}
        {(m.method === "input" || m.method === "editor") && (
          <>
            <button className={primary} disabled={busy} onClick={submitValue}>
              {busy ? "发送中…" : "提交"}
            </button>
            <button className={ghost} disabled={busy} onClick={() => void reply("cancel")}>
              跳过
            </button>
          </>
        )}
        {m.method === "select" &&
          (m.options ?? []).map((opt) => (
            <button key={opt} className={ghost} disabled={busy} onClick={() => void reply("value", { value: opt })}>
              {opt}
            </button>
          ))}
        {m.method === "select" && (
          <button className={ghost} disabled={busy} onClick={() => void reply("cancel")}>
            取消
          </button>
        )}
        {m.method === "editor" && <span className="text-xs text-muted">⌘/Ctrl + Enter 提交</span>}
      </div>
      {error && <div className="mt-1.5 text-xs text-danger">{error}</div>}
      {waiting && !error && <div className="mt-1.5 text-xs text-muted">等待你的输入…</div>}
    </div>
  );
}
