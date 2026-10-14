import type { ViewMsg } from "@shared/types";

/** 右栏「来源」区块的一条：本轮（最后一次用户消息之后）读过 / 引用过的文件。 */
export type SourceFile = {
 /** 绝对路径（工具参数原样，多为绝对路径；相对路径原样保留）。 */
 path: string;
 /** 本轮被读 / 引用的次数（同一文件被多次读时行尾给计数）。 */
 reads: number;
};

/**
 * 从消息流派生「本轮来源」：**最后一次用户消息之后**的工具读取路径
 * （`tool.path`，由 `viewmsg` 的 `primaryPathOf` 归一）与 `@文件` 引用（`files` 消息）。
 *
 * 纯函数（可单测）：保序去重、超过上限保最近的 `max` 条、最近的排在前面——
 * 右栏是「我刚让 agent 碰过哪些文件」的即时清单，不是全量审计。
 * 没有用户消息（打开历史中段）时从流首开始算。
 */
export function recentSourceFiles(events: ViewMsg[], max = 24): SourceFile[] {
 let start = 0;
 for (let i = events.length - 1; i >= 0; i--) {
  if (events[i].kind === "user") {
   start = i + 1;
   break;
  }
 }
 const seen = new Map<string, number>();
 for (let i = start; i < events.length; i++) {
  const m = events[i];
  if (m.kind === "tool") {
   if (m.path) seen.set(m.path, (seen.get(m.path) ?? 0) + 1);
  } else if (m.kind === "files") {
   for (const f of m.files) seen.set(f.path, (seen.get(f.path) ?? 0) + 1);
  }
 }
 const all = [...seen.entries()];
 return all
  .slice(Math.max(0, all.length - max))
  .reverse()
  .map(([path, reads]) => ({ path, reads }));
}

/**
 * 路径 → 列表行展示的两段（基线 + 前缀）：文件基名走正文、前面的目录走淡色。
 * 会话 cwd 前缀（项目内相对路径的常见情形）剥掉，右栏窄，能省一截是一截。
 */
export function splitSourcePath(path: string, cwd: string): { base: string; prefix: string } {
 let p = path;
 if (cwd && p.startsWith(cwd.endsWith("/") ? cwd : `${cwd}/`)) {
  p = p.slice(cwd.endsWith("/") ? cwd.length : cwd.length + 1);
 }
 const idx = p.lastIndexOf("/");
 if (idx < 0) return { base: p, prefix: "" };
 return { base: p.slice(idx + 1), prefix: p.slice(0, idx) };
}
