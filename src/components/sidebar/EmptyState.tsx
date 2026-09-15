import { useApp } from "../../stores/app";

export function EmptyState({ kind }: { kind: "no-project" | "no-session" | "archived" }) {
  const { set } = useApp();
  if (kind === "no-project") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border)]" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-muted">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="text-[17px] font-semibold tracking-tight">先添加一个项目</h1>
        <p className="max-w-xs text-[13px] leading-6 text-muted">
          选择一个本地目录作为项目，会话会绑定到它启动
        </p>
        <button className="mt-1 cursor-pointer rounded-full bg-accent px-5 py-2 text-[13px] font-medium text-white transition-opacity duration-150 hover:opacity-90">
          选择目录
        </button>
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
    <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface shadow-[inset_0_0_0_1px_var(--color-border)]" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="text-muted">
          <path d="M12 5v14m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="text-[17px] font-semibold tracking-tight">开始一个新会话</h1>
      <p className="max-w-xs font-mono text-xs leading-6 text-muted">
        Enter 发送 · Shift+Enter 换行 · Esc 停止
      </p>
      <button
        onClick={() => set({ sidebarOpen: false })}
        className="mt-1 cursor-pointer rounded-full border border-border px-5 py-2 text-[13px] text-foreground transition-colors duration-150 hover:bg-surface"
      >
        新建会话
      </button>
    </div>
  );
}
