import { useApp } from "../stores/app";

export function SettingsPage() {
  const { health, set } = useApp();
  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 py-8">
      <h1 className="text-xl font-semibold">设置</h1>
      <p className="text-sm text-muted">
        V1 暂不在此提供设置。Provider Key、模型目录等请用 omp CLI 或 OmpConfig 管理。
      </p>
      <div className="rounded border border-border bg-surface p-3">
        <div className="text-xs text-muted">config path（只读）</div>
        <div className="font-mono text-xs break-all">{health?.omp.agentDir ?? "未知"}</div>
      </div>
      <div>
        <button
          onClick={() => set({ settingsOpen: false })}
          className="cursor-pointer rounded border border-border px-4 py-2 text-sm transition-colors duration-200 hover:bg-background"
        >
          返回
        </button>
      </div>
    </div>
  );
}
