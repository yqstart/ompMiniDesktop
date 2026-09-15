import { FolderSearch, RefreshCw, TriangleAlert } from "lucide-react";
import { useApp } from "../stores/app";
import { pickOmpExecutable, refreshOmpHealth } from "../lib/ompDiag";

export function HealthBanner() {
  const { health } = useApp();
  if (!health || health.ok) return null;
  // 标题按真实原因分：omp 找到了但模型目录拉不到，不该说"未找到可用的 omp"
  const missingOmp = !health.omp.ompPath;
  return (
    <div
      role="alert"
      className="mx-3 mt-2 flex shrink-0 flex-wrap items-start gap-2 rounded-xl border border-warn/40 bg-surface px-3.5 py-2.5 text-sm"
    >
      <TriangleAlert size={15} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{missingOmp ? "未找到可用的 omp" : "omp 模型目录加载失败"}</div>
        <div className="text-muted">
          {(health.omp.errors[0] ?? "请安装 oh-my-pi 后重试，或检查 PATH。") +
            (health.modelsError ? `（${health.modelsError}）` : "")}
        </div>
      </div>
      {/* 引导横幅必须能修：GUI 的 PATH 常不含 homebrew 目录，只报错等于让用户去猜 */}
      <div className="flex shrink-0 items-center gap-1.5">
        <button
          onClick={() => void refreshOmpHealth()}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background"
          aria-label="重新检测 omp"
        >
          <RefreshCw size={12} aria-hidden />
          重新检测
        </button>
        <button
          onClick={() => void pickOmpExecutable()}
          className="flex cursor-pointer items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs transition-colors duration-150 hover:bg-background"
          aria-label="手动指定 omp 路径"
        >
          <FolderSearch size={12} aria-hidden />
          指定路径
        </button>
      </div>
    </div>
  );
}
