import { useCallback, useEffect } from "react";
import { Check, ChevronDown, GitBranch, RefreshCw } from "lucide-react";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import type { GitInfo } from "@shared/types";

/**
 * 输入框上方的 git 分支指示器（截图右侧那个）：**只读**。
 *
 * - 收起态：分支名（detached HEAD 显示短 sha + 「游离」角标）；有未提交改动时带一个
 *   warn 圆点，切分支前能一眼看到。
 * - 展开态：本地分支清单（当前分支置顶并打勾）+ 手动刷新——切分支请回终端，
 *   这里不做任何 git 写操作（checkout 会带着脏工作区走，不该由聊天窗口代劳）。
 */
export function BranchPicker({
  git,
  loading,
  onReload,
}: {
  git: GitInfo;
  loading: boolean;
  onReload: () => void;
}) {
  const { composerMenu } = useApp();
  const open = composerMenu === "branch";
  const setOpen = useCallback(
    (v: boolean) => useApp.setState({ composerMenu: v ? "branch" : null }),
    [],
  );
  const ref = useDropdown(open, () => setOpen(false));
  const label = git.branch ?? (git.detached ? "游离 HEAD" : "未知分支");

  // 打开即取最新：用户多半刚在终端里切完分支
  useEffect(() => {
    if (open) onReload();
  }, [open, onReload]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-full px-2 py-1 whitespace-nowrap text-muted transition-colors duration-150 hover:bg-surface hover:text-foreground"
        aria-label={`当前 git 分支：${label}（只读）`}
        aria-expanded={open}
        title={`${label}${git.dirty ? " · 有未提交改动" : ""}`}
      >
        <GitBranch size={13} aria-hidden className="shrink-0 opacity-70" />
        <span className="whitespace-nowrap font-mono">{label}</span>
        {git.detached && (
          <span className="shrink-0 rounded bg-warn/15 px-1 text-[10px] text-warn">游离</span>
        )}
        {git.dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden />}
        <ChevronDown size={14} aria-hidden className="shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-10 mb-1 max-h-72 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border border-border bg-surface p-2 shadow-xl">
          <div className="flex items-center gap-2 px-1 pb-1.5">
            <span className="flex-1 text-[11px] text-muted">本地分支（只读）</span>
            <button
              onClick={onReload}
              disabled={loading}
              className="cursor-pointer rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-50"
              aria-label="刷新 git 状态"
              title="刷新 git 状态"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} aria-hidden />
            </button>
          </div>
          {git.dirty && (
            <div className="mb-1 rounded bg-warn/10 px-2 py-1 text-[11px] text-warn">
              有未提交改动，切分支请回终端
            </div>
          )}
          {git.branches.map((b) => {
            const current = b === git.branch;
            return (
              <div
                key={b}
                className={`flex items-center gap-2 rounded px-2 py-1 ${current ? "text-foreground" : "text-muted"}`}
                aria-current={current ? "true" : undefined}
              >
                <Check size={12} aria-hidden className={`shrink-0 ${current ? "opacity-100" : "opacity-0"}`} />
                <span className="truncate font-mono text-xs">{b}</span>
              </div>
            );
          })}
          {git.branches.length === 0 && (
            <div className="px-2 py-1 text-xs text-muted">暂无本地分支</div>
          )}
          <div className="px-1 pt-1.5 text-[11px] text-muted/70">只读展示 · 切分支请在终端操作</div>
        </div>
      )}
    </div>
  );
}
