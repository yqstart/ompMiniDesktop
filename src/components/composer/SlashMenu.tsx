import { Fragment, useEffect, useRef } from "react";
import { CircleInfo } from "reicon-react";
import { SKILL_PREFIX, type SlashCandidate } from "../../lib/slashCommands";
import { useText } from "../../lib/useText";

/**
 * 输入框 `/` 命令补全浮层：命令组（无标题）+ 技能组（带标题）+ 底部操作提示行。
 *
 * 与 `MentionList`（`@` 路径补全）同一套浮层语言：卡片内、输入框上方、`max-h` 限高内部滚动——
 * **不挤压输入框**是硬要求，上一版命令列表被撤掉正是因为它把输入框顶出了屏幕。
 *
 * 行的措辞与 omp 的输入语法一致：前缀弱化、名字用正文色。技能行的 `skill:` 前缀必须留着
 * （补全后写进输入框的是 `/skill:<名>`），弱化它是为了让人看清技能名，不是为了把它藏掉。
 */
export function SlashMenu({
 cands,
 active,
 query,
 onPick,
 onHover,
}: {
 cands: SlashCandidate[];
 /** 高亮下标（`-1` = 无高亮）。 */
 active: number;
 /** 已输入的命令前缀（决定底部提示说什么）。 */
 query: string;
 onPick: (c: SlashCandidate) => void;
 onHover: (index: number) => void;
}) {
 const t = useText();
 const boxRef = useRef<HTMLDivElement>(null);
 // 上下键移动高亮时把选中项滚进视野（命令面 50+ 条，超出可视区必须跟着走）
 useEffect(() => {
  boxRef.current?.querySelector('[role="option"][aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
 }, [active]);

 return (
  <div className="mx-3 mb-1 overflow-hidden rounded-md border border-border bg-elevated shadow-pop">
   {/* role="listbox" 只包候选行：提示行不是可选项，不该出现在选项列表里 */}
   <div ref={boxRef} role="listbox" aria-label={t.slashListAria} className="max-h-56 overflow-y-auto overscroll-contain py-1">
    {cands.length === 0 && (
     <div className="px-2.5 py-2 text-[13px] text-muted">{t.slashListEmpty}</div>
    )}
    {cands.map((c, i) => (
     <Fragment key={c.name}>
      {/* 组标题只在组的第一条前出现；命令组无标题（对齐参考图的分组观感） */}
      {c.group === "skill" && (i === 0 || cands[i - 1].group !== "skill") && (
       <div role="presentation" className="px-2.5 pt-2 pb-1 text-[11px] font-medium text-faint">
        {t.slashSkillGroup}
       </div>
      )}
      <button
       type="button"
       role="option"
       aria-selected={i === active}
       onClick={() => onPick(c)}
       onMouseEnter={() => onHover(i)}
       className={`flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left ${i === active ? "bg-hover" : ""}`}
      >
       <span className="shrink-0 font-mono text-[13px]">
        <span className="text-faint">{c.group === "skill" ? `/${SKILL_PREFIX}` : "/"}</span>
        <span className="text-foreground">{c.display}</span>
       </span>
       {c.description && <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{c.description}</span>}
       {/* 参数提示是决策信息（这条命令要不要带参数），不能被描述挤掉，所以放右侧且限宽截断 */}
       {c.hint && (
        <span className="max-w-[45%] shrink-0 truncate font-mono text-[11px] text-faint" title={c.hint}>
         {c.hint}
        </span>
       )}
      </button>
     </Fragment>
    ))}
   </div>
   <div className="flex items-center gap-1.5 border-t border-border-soft px-2.5 py-1.5 text-[11px] text-faint">
    <CircleInfo size={12} aria-hidden />
    {query.trim() ? t.slashListHint : t.slashListSearch}
   </div>
  </div>
 );
}
