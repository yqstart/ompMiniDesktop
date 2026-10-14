import { useCallback } from "react";
import { Files, ImagePlus, Plus } from "reicon-react";
import { useApp } from "../../stores/app";
import { useDropdown } from "../../lib/useDropdown";
import { useText } from "../../lib/useText";

/**
 * 输入卡「+」菜单（v2 §3 卡底工具行左端）：添加上下文的两条入口——
 * 图片附件（读成 base64 随消息发给 omp）与引用工作区文件（注入 `@路径` 草稿）。
 * 与项目 / 分支 / 模型等选择器共用 `composerMenu` 互斥槽：同一时刻只开一个浮层。
 *
 * 行 = 「图标 + 标题 + 说明」两行式（与执行模式菜单同款）：说明**不能**塞进标题——
 * 长句当标签会把 28px 高的行撑破（2026-10-14 修的那个「样式错乱」就是这个）。
 */
export function PlusMenu({
 onPickImages,
 onPickRef,
 disabled,
}: {
 onPickImages: () => void;
 /** 引用**其他**工作区成员项目的文件（⌘⇧P 同一入口）；本项目文件直接在输入框用 `@` 补全。 */
 onPickRef: () => void;
 disabled?: boolean;
}) {
 const t = useText();
 const open = useApp((s) => s.composerMenu === "plus");
 const setOpen = useCallback((v: boolean) => useApp.setState({ composerMenu: v ? "plus" : null }), []);
 const ref = useDropdown(open, () => setOpen(false));

 const item = (icon: React.ReactNode, label: string, hint: string, onClick: () => void) => (
  <button
   onClick={() => {
    setOpen(false);
    onClick();
   }}
   className="flex w-full cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-100 hover:bg-hover"
  >
   <span className="mt-0.5 shrink-0 text-muted">{icon}</span>
   <span className="min-w-0 flex-1">
    <span className="block text-[13px] text-muted">{label}</span>
    <span className="block text-[11px] leading-4 text-faint">{hint}</span>
   </span>
  </button>
 );

 return (
  <div className="relative" ref={ref}>
   <button
    onClick={() => setOpen(!open)}
    disabled={disabled}
    className={`flex cursor-pointer items-center justify-center rounded-md p-1.5 transition-colors duration-100 hover:bg-hover disabled:cursor-default disabled:opacity-40 ${open ? "bg-active text-foreground" : "text-muted hover:text-foreground"}`}
    aria-label={t.plusMenuAria}
    aria-expanded={open}
    title={t.plusMenuAria}
   >
    <Plus size={16} aria-hidden />
   </button>
   {open && (
    <div className="absolute bottom-8 left-0 z-10 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-elevated p-1 pb-1.5 shadow-pop">
     {item(<ImagePlus size={13} aria-hidden />, t.attachAddAria, t.plusAddImageHint, onPickImages)}
     {item(<Files size={13} aria-hidden />, t.refPickTitle, t.plusAddRefHint, onPickRef)}
    </div>
   )}
  </div>
 );
}
