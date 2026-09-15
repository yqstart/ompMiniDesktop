import type { Text } from "./locale";

/**
 * 壳侧本地命令（V40）：`/` 开头、命中即由壳自己处理，**不发去 omp**。
 *
 * 与 omp 命令面的分界：omp 的 `/xxx` 经 `run_slash` 直发（它自己认的命令才有效）；
 * 这里这批发给 omp 只会变成一段普通提示词（`/goal` 这类在 RPC 里没有 handle），
 * 所以由壳拦截（Composer 的 `send` 先查这里，未命中才走 `run_slash`）。
 * 补全列表里以「壳命令」组置顶展示（`slashCommands.ts` 的 `local` 组）。
 */
export type LocalCommand = {
 name: string;
 /** 描述文案的字典键（中英文在 `locale.ts`；组件处 `(t as Record<string,string>)[descKey]` 取）。 */
 descKey: string;
 /** 参数提示（补全行内展示）。 */
 hint?: string;
};

export const LOCAL_COMMANDS: LocalCommand[] = [
 { name: "goal", descKey: "lcGoal", hint: "[<目标> | pause | resume | drop]" },
 { name: "status", descKey: "lcStatus" },
 { name: "btw", descKey: "lcBtw", hint: "<问题>" },
 { name: "side", descKey: "lcBtw", hint: "<问题>" },
 { name: "fork", descKey: "lcFork" },
 { name: "find", descKey: "lcFind" },
 // V41：fast / slow 模式与导出（模型不支持 fast/slow 时命令返回错误文本，原样上屏）
 { name: "fast", descKey: "lcFast", hint: "[on | off]" },
 { name: "slow", descKey: "lcSlow", hint: "[on | off]" },
 { name: "export", descKey: "lcExport" },
];

/** 本地命令的补全描述：按当前语言取（composer 构造补全候选时用）。 */
export function localCommandDescription(c: LocalCommand, t: Text): string {
 return (t as unknown as Record<string, string>)[c.descKey] ?? c.name;
}

/**
 * 草稿 → 本地命令匹配（`/name` 或 `/name 参数`；未命中返回 null）。
 * 大小写不敏感；命令名允许字母与连字符（与 omp 命令面同形）。
 */
export function matchLocalCommand(draft: string): { cmd: LocalCommand; arg: string } | null {
 const m = /^\/([a-zA-Z][a-zA-Z-]*)(?:\s+([\s\S]*))?$/.exec(draft.trim());
 if (!m) return null;
 const name = m[1].toLowerCase();
 const cmd = LOCAL_COMMANDS.find((c) => c.name === name);
 if (!cmd) return null;
 return { cmd, arg: (m[2] ?? "").trim() };
}
