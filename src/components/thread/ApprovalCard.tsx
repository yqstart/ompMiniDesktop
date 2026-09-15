import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import type { ViewMsg } from "@shared/types";

export function ApprovalCard({ m, sessionId }: { m: Extract<ViewMsg, { kind: "approval" }>; sessionId: string }) {
  const { set, statusBySession } = useApp();
  const [busy, setBusy] = useState<"once" | "always" | "deny" | null>(null);
  const locked = statusBySession[sessionId]?.state !== "awaiting-approval";
  const decide = async (d: "once" | "always" | "deny") => {
    setBusy(d);
    try {
      await api.approve(sessionId, m.uiId, d);
    } catch {
      // 内联错误在 M3 补，此处解锁按钮
    } finally {
      setBusy(null);
      void set;
    }
  };
  return (
    <div
      role="alertdialog"
      aria-label="需要你的确认"
      className="rounded-xl border border-warn/50 bg-surface p-3.5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <ShieldAlert size={15} className="text-warn" aria-hidden />
        <span className="text-[13px] font-medium">需要你的确认</span>
      </div>
      <div className="mt-1.5 rounded-lg bg-code px-2.5 py-2 font-mono text-xs whitespace-pre-wrap">{m.title}</div>
      <div className="mt-2.5 flex flex-wrap gap-2">
        <button
          onClick={() => decide("once")}
          disabled={busy !== null}
          autoFocus
          className="cursor-pointer rounded-lg bg-accent px-3.5 py-1.5 text-[13px] text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
        >
          {busy === "once" ? "处理中…" : "允许一次"}
        </button>
        <button
          onClick={() => decide("always")}
          disabled={busy !== null}
          className="cursor-pointer rounded-lg border border-border px-3.5 py-1.5 text-[13px] transition-colors duration-150 hover:bg-background disabled:opacity-50"
        >
          {busy === "always" ? "处理中…" : "总是允许（本会话）"}
        </button>
        <button
          onClick={() => decide("deny")}
          disabled={busy !== null}
          className="cursor-pointer rounded-lg border border-danger/50 px-3.5 py-1.5 text-[13px] text-danger transition-colors duration-150 hover:bg-danger hover:text-white disabled:opacity-50"
        >
          {busy === "deny" ? "处理中…" : "拒绝"}
        </button>
      </div>
      {locked && <div className="mt-1.5 text-xs text-muted">等待审批结果…</div>}
    </div>
  );
}
