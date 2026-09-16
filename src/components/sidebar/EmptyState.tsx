import { useState } from "react";
import { ArrowDown, Folder } from "reicon-react";
import { useApp } from "../../stores/app";
import { pickAndAddProject } from "../../lib/projects";
import { createSessionIn } from "../../lib/sessionOpen";
import { useText } from "../../lib/useText";

export function EmptyState({ kind }: { kind: "no-project" | "no-session" | "archived" }) {
  const { activeProjectId, projects } = useApp();
  const t = useText();
  const [error, setError] = useState<string | null>(null);
  const currentProject = projects.find((p) => p.id === activeProjectId) ?? null;
  // 模板里 `{0}` 是项目名（渲染时用 mono 强调）：按它切开再各自填充。
  const [chatInBefore, chatInAfter] = t.emptyNewChatIn.split("{0}");
  if (kind === "no-project") {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface text-muted" aria-hidden>
          <Folder size={20} />
        </div>
        <h1 className="text-base font-semibold tracking-tight">{t.emptyNoProjectTitle}</h1>
        <p className="max-w-xs text-[13px] leading-6 text-muted">{t.emptyNoProjectBody}</p>
        {/* 与左上角主入口同一份逻辑（pickAndAddProject），空态即入口，不用回头找按钮。 */}
        <button
          onClick={async () => {
            const res = await pickAndAddProject();
            setError(res && !res.ok ? res.message : null);
          }}
          className="mt-1 cursor-pointer rounded-md bg-accent px-4 py-1.5 text-[13px] font-medium text-white transition-opacity duration-100 hover:opacity-90"
        >
          {t.emptyPickFolder}
        </button>
        {error && (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  if (kind === "archived") {
    return (
      <div className="border-b border-border bg-surface px-4 py-2 text-center text-sm text-muted">
        {t.emptyArchivedBanner}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border bg-surface text-muted" aria-hidden>
        <ArrowDown size={20} />
      </div>
      <h1 className="text-base font-semibold tracking-tight">{t.emptyNoSessionTitle}</h1>
      {/* 空态必须说清"消息会发到哪个目录"：否则用户不知道新会话落在哪 */}
      <p className="max-w-xs text-[13px] leading-6 text-muted">
        {currentProject ? (
          <>
            {chatInBefore}
            <span className="font-mono text-foreground">{currentProject.name}</span>
            {chatInAfter ?? ""}
          </>
        ) : (
          t.emptyPickProjectFirst
        )}
      </p>
      <p className="max-w-xs font-mono text-xs leading-6 text-faint">{t.emptyShortcuts}</p>
      <button
        onClick={async () => {
          const res = await createSessionIn(activeProjectId, { projectName: currentProject?.name });
          setError(res.ok ? null : res.message);
        }}
        className="mt-1 cursor-pointer rounded-md border border-border px-4 py-1.5 text-[13px] text-foreground transition-colors duration-100 hover:bg-hover"
      >
        {t.newSession}
      </button>
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
