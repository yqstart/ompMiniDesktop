import type { TerminalView } from "@shared/types";

/**
 * 右侧终端视图（标签栏 / 面板 / `⌘1..9`）的**范围**：左栏选中哪个工作区，右侧就只列
 * 那个目录的终端（`cwd` 精确匹配）——别的分支的终端照常跑，只是不在这个视图里。
 *
 * 「终端还活着」的可见性由左栏工作区行上的终端徽章负责提示（`countTerminalsIn`），
 * `⌘K` 快速切换仍能全局跳过去（跳过去会连着把左栏选中切到那个工作区）。
 *
 * `activeWorkspacePath == null`（一个可用工作区都没有）时**不过滤**：那种局面下把终端
 * 藏起来只会让人以为终端丢了——直接给全量视图，终端照常可用。
 */
export function terminalsInWorkspace(
 terminals: readonly TerminalView[],
 activeWorkspacePath: string | null,
): readonly TerminalView[] {
 if (activeWorkspacePath === null) return terminals;
 return terminals.filter((term) => term.cwd === activeWorkspacePath);
}

/** 工作区行徽章：该目录下的终端数。 */
export function countTerminalsIn(terminals: readonly TerminalView[], path: string): number {
 let n = 0;
 for (const term of terminals) if (term.cwd === path) n += 1;
 return n;
}

/** 工作区行徽章：该目录下**进程还活着**的终端数（徽章据此上强调色）。 */
export function countRunningTerminalsIn(terminals: readonly TerminalView[], path: string): number {
 let n = 0;
 for (const term of terminals) {
  if (term.cwd === path && term.status === "running") n += 1;
 }
 return n;
}
