import type { AvailableCommand } from "@shared/types";

/**
 * `/` 命令面（omp `available_commands_update` 透传）的取词与过滤（纯函数，便于单测）。
 *
 * 上游形状（实测 omp 18.2.1）：`{name, description, aliases?, input?: {hint?}, subcommands?}`。
 * `input.hint` 是**参数提示**（如 `/compact` → `[soft|remote|snapcompact] [focus]`），
 * 对"这个命令要带什么参数"最关键，这里抬平成顶层 `hint` 给补全行直接用。
 *
 * 这里只做形状归一与取词，不发命令、不改写草稿——展开与执行都是 omp 的事。
 */

/** 上游单条命令 → `AvailableCommand`；没有 `name` 的条目丢弃（不该出现，但不能让它炸渲染）。 */
export function normalizeCommands(raw: unknown): AvailableCommand[] {
 if (!Array.isArray(raw)) return [];
 const out: AvailableCommand[] = [];
 for (const c of raw) {
  if (!c || typeof c !== "object") continue;
  const o = c as Record<string, unknown>;
  if (typeof o.name !== "string" || o.name === "") continue;
  const input = o.input as Record<string, unknown> | undefined;
  const hint = typeof o.hint === "string" ? o.hint : typeof input?.hint === "string" ? input.hint : undefined;
  out.push({
   name: o.name,
   description: typeof o.description === "string" ? o.description : undefined,
   aliases: Array.isArray(o.aliases) ? (o.aliases.filter((a) => typeof a === "string") as string[]) : undefined,
   hint,
  });
 }
 return out;
}

/** 命令是否匹配前缀 `token`（含别名；空 token 全命中）。`token` 不带前导斜杠。 */
export function matchesToken(c: AvailableCommand, token: string): boolean {
 if (!token) return true;
 if (c.name.startsWith(token)) return true;
 return (c.aliases ?? []).some((a) => a.startsWith(token));
}

/**
 * 按前缀过滤候选，保持 omp 给的顺序（它是按内置/自定义排的，不重排），
 * 最多 `limit` 条——一次列 48 条会把输入框顶上去，列表自身可滚。
 */
export function filterCommands(commands: AvailableCommand[], token: string, limit: number): AvailableCommand[] {
 return commands.filter((c) => matchesToken(c, token)).slice(0, limit);
}

/**
 * `token` 是否已经是一条完整命令（名字或别名精确命中）。
 * 决定回车语义：「打全了就直接发，没打全先替用户补全」——
 * `/compact` + Enter 是运行命令，`/comp` + Enter 是补成 `/compact `。
 */
export function isExactCommand(commands: AvailableCommand[], token: string | null): boolean {
 if (token == null || token === "") return false;
 return commands.some((c) => c.name === token || (c.aliases ?? []).includes(token));
}

/**
 * 把草稿里光标前正在输入的命令词换成选中的命令（`/` 起算，规则与补全一致）：
 * 行首或换行后、`/` + 连续非空白字符，且**光标就在这个词里**（已打空格就不再算补全态）。
 * 命令名后补一个空格好接着打参数；若原文该处已有空格则不重复补。
 * 没有可替换处（光标后不是命令词）原样返回。
 */
export function applyCommand(draft: string, caret: number, name: string): string {
 const before = draft.slice(0, caret);
 const after = draft.slice(caret);
 const m = /(?:^|\n)\/(\S*)$/.exec(before);
 if (!m) return draft;
 const head = before.slice(0, before.length - m[1].length - 1);
 const rest = after.startsWith(" ") ? after.slice(1) : after;
 return `${head}/${name} ${rest}`;
}
