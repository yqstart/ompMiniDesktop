import type { ReactNode } from "react";

/**
 * 右栏区块的通用外壳（MASTER §4.3：面板内容以分隔线与行分组组织，**不做嵌套卡片**）。
 * 区块 = 小标题（`text-xs` + muted + 可选行尾动作）+ 内容；区块间一条 `--border-soft` 分隔线。
 */
export function PanelSection({
 title,
 anchor,
 action,
 children,
}: {
 title: string;
 /** 区块锚点 id（右栏区块导航浮层滚动定位用）。 */
 anchor?: string;
 /** 行尾动作（如刷新键）：右对齐、不打断标题。 */
 action?: ReactNode;
 children: ReactNode;
}) {
 return (
  <section id={anchor} className="border-b border-border-soft px-3.5 py-3 last:border-b-0 scroll-mt-2">
   <div className="flex items-center gap-1.5">
    <h2 className="min-w-0 flex-1 truncate text-[11px] font-medium tracking-wide text-muted">{title}</h2>
    {action}
   </div>
   <div className="mt-2">{children}</div>
  </section>
 );
}
