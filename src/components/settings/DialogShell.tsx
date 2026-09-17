import { useEffect, useRef } from "react";
import { X } from "reicon-react";
import { useText } from "../../lib/useText";

/**
 * 设置页的模态壳（「添加供应商」与「挑选模型」用）：fixed 全屏遮罩 + 居中卡片 + 内容区滚动。
 *
 * 为什么是 fixed 弹窗、而不是行内展开：设置页的 tab 内容区是 `overflow-y-auto` 的滚动容器，
 * 行内展开的长列表（73 个提供商、几十个模型）会把区块撑成一长条；fixed 定位不受滚动容器裁剪，
 * 配过滤框用才顺手。Esc / 点遮罩 / 右上角按钮都关闭（调用方在 `onClose` 里收尾）。
 */
export function DialogShell({
 title,
 onClose,
 children,
 width = "max-w-xl",
}: {
 title: string;
 onClose: () => void;
 children: React.ReactNode;
 /** 卡片最大宽度（默认 `max-w-xl`；表单类给 `max-w-2xl`）。 */
 width?: string;
}) {
 const t = useText();
 const cardRef = useRef<HTMLDivElement>(null);
 /** 最新 `onClose` 的引用：调用方传的都是内联箭头函数，若把它放进下面 effect 的依赖，
  *  父级每次重渲染都会重跑 effect —— `cardRef` 的 `focus()` 会把输入框的焦点抢回卡片
  *  （实测：自定义供应商表单每敲一个字就失焦）。effect 只在挂载时跑一次，回调经 ref 取最新值。 */
 const closeRef = useRef(onClose);
 useEffect(() => {
  closeRef.current = onClose;
 });

 useEffect(() => {
  cardRef.current?.focus();
  const onKey = (e: KeyboardEvent) => {
   if (e.key === "Escape") closeRef.current();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
 }, []);

 return (
  <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-3 sm:p-6" onClick={onClose}>
   <div
    ref={cardRef}
    tabIndex={-1}
    role="dialog"
    aria-modal="true"
    aria-label={title}
    className={`flex max-h-[85dvh] min-w-0 w-full ${width} flex-col overflow-hidden rounded-xl border border-border bg-elevated shadow-dialog outline-none`}
    onClick={(e) => e.stopPropagation()}
   >
    <div className="flex shrink-0 items-center gap-3 border-b border-border-soft px-4 py-3 sm:px-5">
     <div className="min-w-0 text-sm font-semibold break-words">{title}</div>
     <button
      onClick={onClose}
      aria-label={t.close}
      title={t.close}
      className="ml-auto flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
     >
      <X size={12} aria-hidden />
     </button>
    </div>
    <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-4 [overflow-wrap:anywhere] [scrollbar-gutter:stable] sm:p-5">{children}</div>
   </div>
  </div>
 );
}
