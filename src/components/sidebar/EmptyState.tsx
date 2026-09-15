import { useApp } from "../../stores/app";

export function EmptyState({ kind }: { kind: "no-project" | "no-session" | "archived" }) {
  const { set } = useApp();
  if (kind === "no-project") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <h1 className="text-xl font-semibold">先添加一个项目</h1>
        <p className="max-w-md text-sm text-muted">
          选择一个本地目录作为项目，会话会绑定到它启动
        </p>
        <button className="cursor-pointer rounded bg-accent px-4 py-2 text-sm text-white transition-opacity duration-200 hover:opacity-90">
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
      <h1 className="text-xl font-semibold">开始一个新会话</h1>
      <p className="max-w-md text-sm text-muted">
        Enter 发送 · Shift+Enter 换行 · Esc 停止
      </p>
      <button
        onClick={() => set({ sidebarOpen: false })}
        className="cursor-pointer rounded border border-accent px-4 py-2 text-sm text-accent transition-colors duration-200 hover:bg-accent hover:text-white"
      >
        新建会话
      </button>
    </div>
  );
}
