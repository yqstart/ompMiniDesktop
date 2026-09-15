import { useEffect, useState } from "react";
import { Shield } from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";

const LABEL: Record<string, string> = {
  "always-ask": "每次询问",
  write: "写入询问",
  yolo: "自动通过",
};

export function PermissionBadge({ compact = false, align = "right" }: { compact?: boolean; align?: "left" | "right" }) {
  const { activeSessionId } = useApp();
  const [open, setOpen] = useState(false);
  const [global, setGlobal] = useState("write");
  const [session, setSession] = useState<string | null>(null);

  useEffect(() => {
    api.getGlobalApproval().then(setGlobal).catch(() => undefined);
  }, []);
  useEffect(() => {
    setSession((useApp.getState().sessionApprovals as Record<string, string> | undefined)?.[activeSessionId ?? ""] ?? null);
  }, [activeSessionId]);

  const shown = session ?? global;
  const danger = shown === "yolo";

  const pick = async (mode: string, scope: "global" | "session") => {
    try {
      if (scope === "global") {
        await api.setGlobalApproval(mode);
        setGlobal(mode);
      } else if (activeSessionId) {
        await api.setSessionApproval(activeSessionId, mode);
        const prev = (useApp.getState().sessionApprovals as Record<string, string> | undefined) ?? {};
        useApp.setState({ sessionApprovals: { ...prev, [activeSessionId]: mode } } as never);
        setSession(mode);
      }
    } catch {
      // M3-6 补内联错误
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 transition-colors duration-150 hover:bg-background ${compact ? "text-xs" : "text-[13px]"} ${danger ? "text-danger" : "text-muted hover:text-foreground"}`}
        aria-label={`权限：${LABEL[shown] ?? shown}`}
        aria-expanded={open}
      >
        <Shield size={13} aria-hidden />
        <span>{LABEL[shown] ?? shown}</span>
      </button>
      {open && (
        <div className={`absolute bottom-9 z-10 w-56 rounded-xl border border-border bg-surface p-1 shadow-xl ${align === "left" ? "left-0" : "right-0"}`}>
          <div className="px-2 py-1 text-xs text-muted">全局</div>
          {Object.keys(LABEL).map((m) => (
            <button
              key={m}
              onClick={() => void pick(m, "global")}
              className="block w-full cursor-pointer rounded px-2 py-1.5 text-left text-[13px] transition-colors duration-200 hover:bg-background"
            >
              {LABEL[m]}
              {m === "yolo" && <span className="text-danger"> · 跳过所有确认</span>}
            </button>
          ))}
          <div className="border-t border-border px-2 py-1 text-xs text-muted">本会话覆盖</div>
          {Object.keys(LABEL).map((m) => (
            <button
              key={m}
              onClick={() => void pick(m, "session")}
              disabled={!activeSessionId}
              className="block w-full cursor-pointer rounded px-2 py-1.5 text-left text-[13px] transition-colors duration-200 hover:bg-background disabled:opacity-40"
            >
              {LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
