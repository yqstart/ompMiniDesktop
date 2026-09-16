import { ShieldAlert, ShieldCheck, ShieldX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import type { ViewMsg } from "@shared/types";

type Decision = "once" | "always" | "deny";
const DECIDED_TEXT: Record<Decision, string> = {
  once: "已允许执行",
  always: "已设为本会话自动允许",
  deny: "已拒绝执行",
};

export function ApprovalCard({ m, sessionId }: { m: Extract<ViewMsg, { kind: "approval" }>; sessionId: string }) {
  const { set, statusBySession } = useApp();
  const [busy, setBusy] = useState<Decision | null>(null);
  const [decided, setDecided] = useState<Decision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // 审批是"最高优先级"的中断：出现时必须把卡带进视野（长会话里它可能落在视口之外）
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "nearest" });
  }, []);
  const locked = statusBySession[sessionId]?.state !== "awaiting-approval";
  // 回执后进入终态：按钮收起、卡片展示结论，不许重复点第二次。
  const finished = decided !== null;
  const decide = async (d: Decision) => {
    if (busy !== null || decided !== null) return;
    setBusy(d);
    setError(null);
    try {
      await api.approve(sessionId, m.uiId, d);
      setDecided(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "审批回执失败，请重试");
    } finally {
      setBusy(null);
      void set;
    }
  };
  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-label={finished ? DECIDED_TEXT[decided as Decision] : "需要你的确认"}
      className={`rounded-xl border p-3.5 shadow-sm ${finished ? "border-border/60 bg-surface/60" : "border-warn/50 bg-surface"}`}
    >
      <div className="flex items-center gap-2">
        {finished ? (
          decided === "deny" ? (
            <ShieldX size={15} className="text-danger" aria-hidden />
          ) : (
            <ShieldCheck size={15} className="text-ok" aria-hidden />
          )
        ) : (
          <ShieldAlert size={15} className="text-warn" aria-hidden />
        )}
        <span className="text-sm font-medium">{finished ? DECIDED_TEXT[decided as Decision] : "需要你的确认"}</span>
      </div>
      <div className="mt-1.5 rounded-lg bg-code px-2.5 py-2 font-mono text-xs whitespace-pre-wrap">{m.title}</div>
      {!finished && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            onClick={() => void decide("once")}
            disabled={busy !== null}
            autoFocus
            className="cursor-pointer rounded-lg bg-accent px-3.5 py-1.5 text-sm text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-50"
          >
            {busy === "once" ? "处理中…" : "允许一次"}
          </button>
          <button
            onClick={() => void decide("always")}
            disabled={busy !== null}
            className="cursor-pointer rounded-lg border border-border px-3.5 py-1.5 text-sm transition-colors duration-150 hover:bg-background disabled:opacity-50"
          >
            {busy === "always" ? "处理中…" : "总是允许（本会话）"}
          </button>
          <button
            onClick={() => void decide("deny")}
            disabled={busy !== null}
            className="cursor-pointer rounded-lg border border-danger/50 px-3.5 py-1.5 text-sm text-danger transition-colors duration-150 hover:bg-danger hover:text-white disabled:opacity-50"
          >
            {busy === "deny" ? "处理中…" : "拒绝"}
          </button>
        </div>
      )}
      {error && (
        <div role="alert" className="mt-1.5 text-xs text-danger">
          {error}
        </div>
      )}
      {!finished && locked && !error && <div className="mt-1.5 text-xs text-muted">等待审批结果…</div>}
    </div>
  );
}
