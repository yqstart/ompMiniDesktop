/**
 * 命令中心（⌘K，V41；对齐 zcode 的 command center）的纯逻辑：动作清单、条目构造、过滤打分。
 *
 * 动作本身**不带执行函数**（纯数据、可单测）；执行映射在 `components/CommandPalette.tsx`，
 * 会话条目由组件在打开时拉 `list_sessions` 组装。
 */
export type PaletteActionId =
 | "new-chat"
 | "find"
 | "status"
 | "btw"
 | "fork"
 | "archive"
 | "compact"
 | "approval"
 | "settings"
 | "usage";

export type PaletteAction = {
 id: PaletteActionId;
 /** 标题的字典键（中英在 `locale.ts`，组件处 `(t as Record<string,string>)[key]` 取）。 */
 titleKey: string;
 /** 英文关键词（过滤加分面；中文标题也能被子串命中）。 */
 keywords: string;
};

/** 动作清单（顺序即默认展示序）。 */
export const PALETTE_ACTIONS: PaletteAction[] = [
 { id: "new-chat", titleKey: "palNewChat", keywords: "new chat create session 新建 会话" },
 { id: "find", titleKey: "palFind", keywords: "find search conversation 查找 搜索" },
 { id: "status", titleKey: "palStatus", keywords: "status stats tokens cost 统计 用量" },
 { id: "btw", titleKey: "palBtw", keywords: "btw side question aside 旁问 辅助" },
 { id: "fork", titleKey: "palFork", keywords: "fork duplicate copy 分叉 复制" },
 { id: "compact", titleKey: "palCompact", keywords: "compact context 压缩 上下文" },
 { id: "approval", titleKey: "palApproval", keywords: "approval permission mode 执行模式 权限" },
 { id: "archive", titleKey: "palArchive", keywords: "archive 归档" },
 { id: "settings", titleKey: "palSettings", keywords: "settings config 设置 配置" },
 { id: "usage", titleKey: "palUsage", keywords: "usage provider quota 用量 配额" },
];

/** 命令中心的一个条目（动作或会话）。 */
export type PaletteEntry =
 | { kind: "action"; id: PaletteActionId; title: string; hint?: string }
 | { kind: "session"; sid: string; title: string; hint?: string; running: boolean };

/**
 * 过滤 + 排序：标题（title/hint）前缀 0 → 标题子串 1 → 关键词子串 2，未命中剔除。
 * 空查询保持原序（动作在前、会话在后——由调用方组装顺序决定）。
 */
export function filterPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
 const q = query.trim().toLowerCase();
 if (!q) return entries;
 const rank = (e: PaletteEntry): number | null => {
  const title = e.title.toLowerCase();
  const hint = (e.hint ?? "").toLowerCase();
  if (title.startsWith(q) || hint.startsWith(q)) return 0;
  if (title.includes(q) || hint.includes(q)) return 1;
  if (e.kind === "action") {
   const a = PALETTE_ACTIONS.find((x) => x.id === e.id);
   if (a && a.keywords.toLowerCase().includes(q)) return 2;
  }
  return null;
 };
 const scored: { e: PaletteEntry; r: number; i: number }[] = [];
 entries.forEach((e, i) => {
  const r = rank(e);
  if (r !== null) scored.push({ e, r, i });
 });
 scored.sort((a, b) => a.r - b.r || a.i - b.i);
 return scored.map((s) => s.e);
}
