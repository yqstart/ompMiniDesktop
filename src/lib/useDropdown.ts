import { useEffect, useRef, useState, type RefObject } from "react";
function isVisible(element: HTMLElement) {
 if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
 if (getComputedStyle(element).visibility === "hidden") return false;
 for (let node: HTMLElement | null = element; node; node = node.parentElement) {
  if (getComputedStyle(node).display === "none") return false;
 }
 return true;
}

function topDialog() {
 const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
 for (let i = dialogs.length - 1; i >= 0; i--) {
  if (isVisible(dialogs[i])) return dialogs[i];
 }
 return null;
}

/** 是否有可见的模态弹窗（含快速切换与抽屉等对话框）。 */
export function hasOpenDialog(): boolean {
 return topDialog() !== null;
}
export function useDialogFocus(
 dialogRef: RefObject<HTMLDivElement | null>,
 open: boolean,
 onClose: () => void,
 initialFocusRef?: RefObject<HTMLElement | null>,
) {
 const closeRef = useRef(onClose);
 useEffect(() => {
  closeRef.current = onClose;
 });

 useEffect(() => {
  const dialog = dialogRef.current;
  if (!open || !dialog) return;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const previousDialog = previous?.closest<HTMLElement>('[role="dialog"]');
  if (topDialog() === dialog && (initialFocusRef || !dialog.contains(document.activeElement))) {
   (initialFocusRef?.current ?? dialog).focus({ preventScroll: true });
  }

  const onKey = (event: KeyboardEvent) => {
   if (event.defaultPrevented || event.isComposing || (event.key !== "Escape" && event.key !== "Tab")) return;
   if (topDialog() !== dialog) return;
   if (event.key === "Escape") {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeRef.current();
    return;
   }
   const controls = Array.from(dialog.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex], [contenteditable="true"]',
   )).filter((element) => element.tabIndex >= 0 && !element.matches(":disabled") && isVisible(element));
   const first = controls[0];
   const last = controls[controls.length - 1];
   const active = document.activeElement;
   if (!first || !dialog.contains(active) || active === dialog || (event.shiftKey ? active === first : active === last)) {
    event.preventDefault();
    (event.shiftKey ? last ?? dialog : first ?? dialog).focus({ preventScroll: true });
   }
  };
  // 下拉在 document 先处理 Esc，弹窗在 window 再兜底，顺序不依赖挂载先后。
  window.addEventListener("keydown", onKey);
  return () => {
   window.removeEventListener("keydown", onKey);
   // 切去终端或打开另一弹窗后不抢焦点；触发项已删时退回仍可见的父弹窗。
   const active = document.activeElement;
   if (active !== document.body && !dialog.contains(active)) return;
   if (previous && isVisible(previous) && !previous.matches(":disabled")) previous.focus({ preventScroll: true });
   else if (previousDialog && isVisible(previousDialog)) previousDialog.focus({ preventScroll: true });
  };
 }, [dialogRef, initialFocusRef, open]);

}

/**
 * 单开下拉容器：点击外部 / Esc 关闭，打开时聚焦首个可聚焦元素。
 * 解决截图问题 1：模型列表与思考等级弹窗同时开、点外部关不掉。
 *
 * `ignore` 是「由它自己开关」的元素（触发按钮）：pointerdown 落在里面时这里不关——否则
 * 同一次点击先被 pointerdown 关掉、又被随后的 click 打开，按钮就永远关不上（`EnumSelect`
 * 依赖这一条；其它调用方没传 `ignore`，行为与从前一致）。
 */
export function useDropdown(
 open: boolean,
 onClose: () => void,
 ignore?: { readonly current: HTMLElement | null },
) {
 const ref = useRef<HTMLDivElement>(null);
 // 面板挂载时可能已有 autoFocus（输入框）：提交后再读 activeElement 会把输入框误当触发项。
 const focusOnMount = useRef(document.activeElement);
 const closeRef = useRef(onClose);
 useEffect(() => {
  closeRef.current = onClose;
 });

 useEffect(() => {
  const popup = ref.current;
  if (!open || !popup) return;
  const focused = popup.contains(document.activeElement) ? focusOnMount.current : document.activeElement;
  const previous = focused instanceof HTMLElement ? focused : null;
  let restoreFocus = true;
  const active = () => {
   if (!isVisible(popup)) return false;
   const modal = topDialog();
   return !modal || modal.contains(popup);
  };
  const first = Array.from(popup.querySelectorAll<HTMLElement>(
   'input, button, [href], select, textarea, [tabindex]:not([tabindex="-1"])',
  )).find((element) => element.tabIndex >= 0 && !element.matches(":disabled") && isVisible(element));
  if (active()) first?.focus({ preventScroll: true });
  const onDown = (event: PointerEvent) => {
   const target = event.target as Node;
   if (!active() || popup.contains(target) || ignore?.current?.contains(target)) return;
   restoreFocus = false;
   closeRef.current();
  };
  const onKey = (event: KeyboardEvent) => {
   if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || !active()) return;
   if (!popup.contains(document.activeElement)) return;
   event.preventDefault();
   event.stopImmediatePropagation();
   closeRef.current();
  };
  document.addEventListener("pointerdown", onDown);
  document.addEventListener("keydown", onKey);
  return () => {
   document.removeEventListener("pointerdown", onDown);
   document.removeEventListener("keydown", onKey);
   if (!restoreFocus || (document.activeElement !== document.body && !popup.contains(document.activeElement))) return;
   if (previous && isVisible(previous) && !previous.matches(":disabled")) previous.focus({ preventScroll: true });
  };
  // `ignore` 是调用方的 ref（`useRef` 的返回值，引用稳定），进依赖只为让 lint 满意
 }, [ignore, open]);

 return ref;
}

/** 同一工具行内同时只允许一个下拉打开。 */
export function useSingleOpen() {
 const [openId, setOpenId] = useState<string | null>(null);
 const bind = (id: string) => ({
  open: openId === id,
  setOpen: (v: boolean) => setOpenId(v ? id : null),
  close: () => setOpenId((cur) => (cur === id ? null : cur)),
 });
 return { openId, bind };
}
