import type { TerminalView } from "@shared/types";

/**
 * 右侧终端视图（标签栏 / 面板 / `⌘1..9`）的**范围**：左栏选中什么，右侧就只列它覆盖的终端。
 *
 * 范围来自 `lib/workspaceGroups.ts` 的 `selectionScopePaths`（V21）：
 * 工作区视图 = 组内全部项目的全部目录；目录视图 = 该目录。`scope === null` 时**不过滤**
 * ——那种局面（一个可用目录都没有）下把终端藏起来只会让人以为终端丢了。
 *
 * 「终端还活着」的可见性由左栏目录行上的终端徽章负责提示（`countTerminalsIn`），
 * `⌘⇧K` 快速切换仍能全局跳过去（跳过去会连着把左栏选中切到那个目录）。
 */
export function terminalsInScope(
 terminals: readonly TerminalView[],
 scope: ReadonlySet<string> | null,
): readonly TerminalView[] {
 if (scope === null) return terminals;
 return terminals.filter((term) => scope.has(term.cwd));
}

/** 目录行徽章：该目录下的终端数。 */
export function countTerminalsIn(terminals: readonly TerminalView[], path: string): number {
 let n = 0;
 for (const term of terminals) if (term.cwd === path) n += 1;
 return n;
}

/** 目录行徽章：该目录下**进程还活着**的终端数（徽章据此上强调色）。 */
export function countRunningTerminalsIn(terminals: readonly TerminalView[], path: string): number {
 let n = 0;
 for (const term of terminals) {
  if (term.cwd === path && term.status === "running") n += 1;
 }
 return n;
}
