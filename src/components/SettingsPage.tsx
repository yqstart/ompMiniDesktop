import { Loader2, RefreshCw, FolderSearch, Copy, Check } from "lucide-react";
import { useApp } from "../stores/app";
import { checkForUpdate, getAppVersion, openUpdateDialog } from "../lib/appUpdate";
import { pickOmpExecutable, refreshOmpHealth } from "../lib/ompDiag";
import { useEffect, useState } from "react";

export function SettingsPage() {
  const { health, set, update } = useApp();
  const [version, setVersion] = useState("…");
  const [diagError, setDiagError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void getAppVersion().then(setVersion);
  }, []);

  const runDiag = async (fn: () => Promise<{ ok: boolean; message?: string } | null>) => {
    const res = await fn();
    setDiagError(res && !res.ok ? (res.message ?? "操作失败") : null);
  };

  const copyAgentDir = async () => {
    const p = health?.omp.agentDir;
    if (!p) return;
    try {
      await navigator.clipboard.writeText(p);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setDiagError("复制失败，请手动选中文本复制");
    }
  };

  const checking = update.status === "checking";
  const updateHint =
    update.status === "latest"
      ? `已是最新（${update.current}）`
      : update.status === "available"
        ? `发现新版本 ${update.version}`
        : update.status === "downloading"
          ? "正在下载更新…"
          : update.status === "ready"
            ? `新版本 ${update.version} 已就绪，重启生效`
            : update.status === "error"
              ? `检查失败：${update.message}`
              : null;

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto px-4 py-8">
      <h1 className="text-xl font-semibold">设置</h1>
      <p className="text-sm text-muted">
        V1 暂不在此提供设置。Provider Key、模型目录等请用 omp CLI 管理。
      </p>
      <section aria-label="omp 诊断" className="rounded border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">omp 诊断</h2>
          <span className={`font-mono text-xs ${health?.ok ? "text-ok" : "text-warn"}`}>
            {health?.ok ? "正常" : "不可用"}
          </span>
          <button
            onClick={() => void runDiag(refreshOmpHealth)}
            className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background"
            aria-label="重新检测 omp"
          >
            <RefreshCw size={12} aria-hidden />
            重新检测
          </button>
          <button
            onClick={() => void runDiag(pickOmpExecutable)}
            className="flex cursor-pointer items-center gap-1 rounded border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background"
            aria-label="手动指定 omp 路径"
            title="指定 omp 可执行文件（GUI 启动的 PATH 常不含 homebrew 目录）"
          >
            <FolderSearch size={12} aria-hidden />
            指定路径
          </button>
        </div>
        <dl className="mt-2 space-y-1 text-xs">
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted">omp 路径</dt>
            <dd className="min-w-0 flex-1 font-mono break-all">{health?.omp.ompPath ?? "未找到"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted">版本</dt>
            <dd className="min-w-0 flex-1 font-mono break-all">{health?.omp.ompVersion ?? "未知"}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-20 shrink-0 text-muted">agentDir</dt>
            <dd className="flex min-w-0 flex-1 items-start gap-1.5">
              <span className="min-w-0 flex-1 font-mono break-all">{health?.omp.agentDir ?? "未知"}</span>
              <button
                onClick={() => void copyAgentDir()}
                className="shrink-0 cursor-pointer rounded border border-border p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
                aria-label="复制 agentDir"
                title="复制路径"
              >
                {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
              </button>
            </dd>
          </div>
        </dl>
        {(health?.omp.errors.length ?? 0) > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-warn">
            {health?.omp.errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        {health?.modelsError && <p className="mt-1 text-xs text-warn">{health.modelsError}</p>}
        {diagError && (
          <p role="alert" className="mt-1 text-xs text-danger">
            {diagError}
          </p>
        )}
        <p className="mt-1.5 text-xs text-muted/70">
          指定路径只写入本应用的覆盖层，不改 omp 自己的配置文件。
        </p>
      </section>

      <section aria-label="应用更新" className="rounded border border-border bg-surface p-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium">应用更新</h2>
          <span className="font-mono text-xs text-muted">当前 v{version}</span>
          <button
            onClick={() => void checkForUpdate("manual").then((r) => {
              if (r === "available") openUpdateDialog();
            })}
            disabled={checking}
            className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-border px-3 py-1.5 text-sm transition-colors duration-200 hover:bg-background disabled:opacity-50"
            aria-label="检查更新"
          >
            {checking ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <RefreshCw size={14} aria-hidden />}
            检查更新
          </button>
        </div>
        {updateHint && (
          <div className="mt-2 text-sm text-muted">
            {updateHint}
            {(update.status === "available" || update.status === "ready") && (
              <button onClick={openUpdateDialog} className="ml-2 cursor-pointer text-accent">
                查看详情
              </button>
            )}
          </div>
        )}
        <p className="mt-1 text-xs text-muted">更新包来自 GitHub Release；下载完成后可选择立即重启或稍后重启（下次启动生效）。</p>
      </section>

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
