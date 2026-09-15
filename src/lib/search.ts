/**
 * 搜索片段高亮（V2 M7b）：把后端给的命中片段按查询词切成若干段，
 * 命中段交给 `<mark>` 渲染。大小写不敏感，且**标出所有命中**（不只第一个）。
 */

export type HighlightPart = { text: string; hit: boolean };

export function highlightParts(text: string, query: string): HighlightPart[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const lower = text.toLowerCase();
  const out: HighlightPart[] = [];
  let i = 0;
  for (;;) {
    const at = lower.indexOf(q, i);
    if (at < 0) break;
    if (at > i) out.push({ text: text.slice(i, at), hit: false });
    out.push({ text: text.slice(at, at + q.length), hit: true });
    i = at + q.length;
  }
  if (i < text.length) out.push({ text: text.slice(i), hit: false });
  return out.length > 0 ? out : [{ text, hit: false }];
}
