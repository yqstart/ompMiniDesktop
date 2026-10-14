import { Check, Loader } from "reicon-react";
import { useApp } from "../../stores/app";
import { isCommitTaskRunning, openCommitPanel } from "../../lib/commitTasks";
import { useText } from "../../lib/useText";

/**
 * 输入卡顶行「提交」入口（分支指示器之后）：点开提交 / 推送浮层（`CommitTaskPanel`）。
 *
 * 与右栏「变更」区块的提交键同一条链路、同一套状态口径：运行中转圈、失败红点
 * （`commitTasks[cwd]` 是唯一真值）；这里只是把入口带到「刚看完分支名」的手边。
 */
export function CommitButton({ cwd }: { cwd: string }) {
 const t = useText();
 const task = useApp((s) => s.commitTasks[cwd] ?? null);
 const running = task ? isCommitTaskRunning(task.phase) : false;
 const failed = task?.phase === "failed";
 return (
  <button
   onClick={() => openCommitPanel(cwd)}
   className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md px-2 py-1 whitespace-nowrap text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
  >
   {running ? (
    <Loader size={12} aria-hidden className="animate-spin" />
   ) : failed ? (
    <span className="size-1.5 shrink-0 rounded-full bg-danger" aria-hidden />
   ) : (
    <Check size={12} aria-hidden className="shrink-0 opacity-70" />
   )}
   {t.gitCommitTitle}
  </button>
 );
}
