import { TriangleAlert } from "lucide-react";
import { useApp } from "../stores/app";

export function HealthBanner() {
  const { health } = useApp();
  if (!health || health.ok) return null;
  return (
    <div
      role="alert"
      className="flex shrink-0 items-start gap-2 border-b border-warn bg-surface px-4 py-2 text-sm"
    >
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <div>
        <div className="font-medium">未找到可用的 omp</div>
        <div className="text-muted">
          {(health.omp.errors[0] ?? "请安装 oh-my-pi 后重试，或检查 PATH。") +
            (health.modelsError ? `（${health.modelsError}）` : "")}
        </div>
      </div>
    </div>
  );
}
