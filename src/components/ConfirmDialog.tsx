import { useEffect, useRef } from "react";
import { useText } from "../lib/useText";

/**
 * 通用二次确认浮层（MASTER §8 的 `ConfirmDialog`）。
 *
 * - 受控组件：`open` 与 `onConfirm` / `onCancel` 由调用方持有，方便在异步操作里复用。
 * - Esc / 点遮罩 = 取消；焦点默认落在「取消」上——危险操作不该被一个回车误确认。
 * - `danger` 只影响确认按钮配色，文案由调用方给（说清「删什么、能不能恢复」）。
 * - z-index 30（MASTER §4：对话框 30，下拉 10，审批 20，toast 50）。
 */
export function ConfirmDialog({
 open,
 title,
 detail,
 confirmLabel,
 cancelLabel,
 danger = false,
 onConfirm,
 onCancel,
}: {
 open: boolean;
 title: string;
 detail?: string;
 confirmLabel?: string;
 cancelLabel?: string;
 danger?: boolean;
 onConfirm: () => void;
 onCancel: () => void;
}) {
 const cancelRef = useRef<HTMLButtonElement>(null);
 const t = useText();
 /** 最新 `onCancel` 的引用：调用方传的都是内联箭头函数，若放进下面 effect 的依赖，
  *  打开期间的每次重渲染都会重跑 `focus()`，把焦点抢回「取消」按钮（与 DialogShell 同款坑）。 */
 const onCancelRef = useRef(onCancel);
 useEffect(() => {
  onCancelRef.current = onCancel;
 });

 useEffect(() => {
  if (!open) return;
  cancelRef.current?.focus();
  const onKey = (e: KeyboardEvent) => {
   if (e.key === "Escape") onCancelRef.current();
  };
  document.addEventListener("keydown", onKey);
  return () => document.removeEventListener("keydown", onKey);
 }, [open]);

 if (!open) return null;
 return (
  <div
   className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
   onClick={onCancel}
  >
   <div
    role="dialog"
    aria-modal="true"
    aria-label={title}
    className="w-full max-w-sm rounded-xl border border-border bg-elevated p-6 shadow-dialog"
    onClick={(e) => e.stopPropagation()}
   >
    <div className="text-[17px] font-semibold tracking-tight">{title}</div>
    {detail && <div className="mt-3 text-[13px] leading-6 text-muted">{detail}</div>}
    <div className="mt-6 flex justify-end gap-2 border-t border-border-soft pt-4">
     <button
      ref={cancelRef}
      onClick={onCancel}
      className="cursor-pointer rounded-md border border-border px-3.5 py-1.5 text-[13px] transition-colors duration-100 hover:bg-hover"
     >
      {cancelLabel ?? t.cancel}
     </button>
     <button
      onClick={onConfirm}
      className={`cursor-pointer rounded-md border px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-100 ${danger ? "border-danger/25 bg-danger/10 text-danger hover:bg-danger/15" : "border-transparent bg-accent text-accent-foreground hover:opacity-90"
       }`}
     >
      {confirmLabel ?? t.confirm}
     </button>
    </div>
   </div>
  </div>
 );
}
