import { useCallback, useEffect, useState } from "react";
import { Shield } from "reicon-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useDropdown } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";

export function PermissionBadge({ compact = false, align = "right" }: { compact?: boolean; align?: "left" | "right" }) {
  const { activeSessionId, composerMenu } = useApp();
  const t = useText();
  const LABEL: Record<string, string> = {
    "always-ask": t.permAlwaysAsk,
    write: t.permWrite,
    yolo: t.permYolo,
  };
  const open = composerMenu === "permission";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "permission" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const [global, setGlobal] = useState("write");
  // 会话覆盖直接订阅 store（启动时已由 App 经 get_overlay 水合），不再用本地 state 拷贝：
  // 拷贝会与真实覆盖漂移（重启后徽标显示全局档）
  const session = useApp((s) => (activeSessionId ? (s.sessionApprovals[activeSessionId] ?? null) : null));

  useEffect(() => {
    api.getGlobalApproval().then(setGlobal).catch(() => undefined);
  }, []);

  const shown = session ?? global;
  const danger = shown === "yolo";

  const pick = async (mode: string, scope: "global" | "session") => {
    try {
      if (scope === "global") {
        await api.setGlobalApproval(mode);
        setGlobal(mode);
      } else if (activeSessionId) {
        await api.setSessionApproval(activeSessionId, mode);
        const prev = useApp.getState().sessionApprovals ?? {};
        useApp.setState({ sessionApprovals: { ...prev, [activeSessionId]: mode } });
      }
    } catch {
      // 失败保持原档位（内联错误条由设置页诊断区承担）
    } finally {
      setOpen(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-colors duration-100 hover:bg-hover ${compact ? "text-[13px]" : "text-[13px]"} ${danger ? "text-danger" : "text-muted hover:text-foreground"}`}
        aria-label={fmt(t.permAria, LABEL[shown] ?? shown)}
        aria-expanded={open}
      >
        <Shield size={13} aria-hidden />
        <span>{LABEL[shown] ?? shown}</span>
      </button>
      {open && (
        <div className={`absolute bottom-8 z-10 w-56 rounded-lg border border-border bg-elevated p-1 shadow-pop ${align === "left" ? "left-0" : "right-0"}`}>
          <div className="px-2 py-1 text-[13px] text-muted">{t.permGlobal}</div>
          {Object.keys(LABEL).map((m) => (
            <button
              key={m}
              onClick={() => void pick(m, "global")}
              className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100 hover:bg-hover"
            >
              {LABEL[m]}
              {m === "yolo" && <span className="text-danger">{t.permYoloNote}</span>}
            </button>
          ))}
          <div className="border-t border-border px-2 py-1 text-[13px] text-muted">{t.permSession}</div>
          {Object.keys(LABEL).map((m) => (
            <button
              key={m}
              onClick={() => void pick(m, "session")}
              disabled={!activeSessionId}
              className="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
            >
              {LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
