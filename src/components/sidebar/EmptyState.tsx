import { useState } from "react";
import { useApp } from "../../stores/app";
import { pickAndAddProject } from "../../lib/projects";
import { createSessionIn } from "../../lib/sessionOpen";

/** 空态示例问题：点一下即新建会话并把问题填进草稿，省掉"第一句说什么"。 */
const EXAMPLES = ["这个项目是做什么的？", "帮我找出最近的报错", "跑一遍测试并总结失败原因"];

export function EmptyState({ kind }: { kind: "no-project" | "no-session" | "archived" }) {
  const { activeProjectId, projects, setDraft } = useApp();
  const [error, setError] = useState<string | null>(null);
  const currentProject = projects.find((p) => p.id === activeProjectId) ?? null;
  /** 新建会话并把示例问题填进草稿。 */
  const startWith = async (text: string) => {
    const res = await createSessionIn(activeProjectId, { projectName: currentProject?.name });
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setError(null);
    setDraft(res.id, text);
  };
  if (kind === "no-project") {
    return (
      <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border)]" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-muted">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-[17px] font-semibold tracking-tight">先添加一个项目</h1>
        <p className="max-w-xs text-sm leading-6 text-muted">
          选择一个本地目录作为项目，会话会绑定到它启动
        </p>
        {/* 与左上角主入口同一份逻辑（pickAndAddProject），空态即入口，不用回头找按钮。 */}
        <button
          onClick={async () => {
            const res = await pickAndAddProject();
            setError(res && !res.ok ? res.message : null);
          }}
          className="mt-1 cursor-pointer rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90"
        >
          选择目录
        </button>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }
  if (kind === "archived") {
    return (
      <div className="border-b border-border bg-surface px-4 py-2 text-center text-sm text-muted">
        已归档，只读——取消归档后可继续对话
      </div>
    );
  }
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border)]" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-muted">
          <path d="M12 5v14m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="text-[17px] font-semibold tracking-tight">开始一个新会话</h1>
      {/* 空态必须说清"消息会发到哪个目录"：否则用户不知道新会话落在哪 */}
      <p className="max-w-xs text-sm leading-6 text-muted">
        {currentProject ? (
          <>
            会话会在 <span className="font-mono text-foreground">{currentProject.name}</span> 下新建
          </>
        ) : (
          "先在左栏选择一个项目"
        )}
      </p>
      <p className="max-w-xs font-mono text-xs leading-6 text-muted/70">
        Enter 发送 · Shift+Enter 换行 · Esc 停止
      </p>
      <button
        onClick={async () => {
          const res = await createSessionIn(activeProjectId, { projectName: currentProject?.name });
          setError(res.ok ? null : res.message);
        }}
        className="mt-1 cursor-pointer rounded-full border border-border px-5 py-2 text-sm text-foreground transition-colors duration-150 hover:bg-surface"
      >
        新建会话
      </button>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="mt-2 flex flex-col items-center gap-1.5">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => void startWith(q)}
            className="cursor-pointer rounded-full border border-border/60 px-3 py-1 text-xs text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}
