import { useState } from "react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { ModelPicker } from "../pickers/ModelPicker";
import { ThinkingPicker } from "../pickers/ThinkingPicker";
import { PermissionBadge } from "../pickers/PermissionBadge";
import { UpdateBell } from "../update/UpdateDialog";

export function TopBar() {
  const { activeSessionId, sessions, set } = useApp();
  const cur = sessions.find((s) => s.id === activeSessionId);
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(cur?.note ?? "");

  return (
    <header className="flex h-12 shrink-0 items-center gap-1 border-b border-border bg-surface px-3">
      {editing && cur ? (
        <input
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => setEditing(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && cur) {
              void api.renameSessionNote(cur.id, note).then(() =>
                api.listSessions().then((all) => set({ sessions: all })),
              );
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
          aria-label={cur ? `会话标题 ${cur.title}，点击改备注名` : "未命名会话"}
          title={cur ? "点击改备注名（不改 omp 原标题）" : ""}
        >
          {cur?.title ?? "未命名会话"}
        </button>
      )}
      <div className="ml-auto flex items-center">
        <UpdateBell />
        <ModelPicker />
        <ThinkingPicker />
        <PermissionBadge />
      </div>
    </header>
  );
}
