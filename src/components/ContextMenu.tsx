import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ContextMenuContext, isMenuItem, placeContextMenu } from "../lib/contextMenu";
import type { ContextMenuEntry, OpenContextMenu } from "../lib/contextMenu";

/**
 * 右键菜单宿主（2026-10-10）：`App` 顶层挂一份，任何位置都能 `useContextMenu().open(...)`。
 *
 * - **单实例**：一个 Provider 管理一份「当前菜单」（锚点 + 条目），行组件只把菜单项交进来；
 * - 挂在 `document.body`（portal，`z-10` 与下拉同层）、指针位置右下方展开，越界自动翻转
 *   （`placeContextMenu`：先按真实尺寸量、再在布局阶段摆正，不产生可见抖动）；
 * - 关闭时机：点外部 / Esc / Tab / 滚动（含内层容器捕获）/ 窗口 resize / 窗口失焦；
 * - 键盘：打开聚焦首个可用项，↑↓ 循环、Home / End 跳首尾；关闭后焦点还给触发前的元素
 *   （菜单项触发的动作若另开弹窗，弹窗稍后自行接管焦点）。
 */
export function ContextMenuProvider({ children }: { children: ReactNode }) {
 const [menu, setMenu] = useState<{ x: number; y: number; items: readonly ContextMenuEntry[] } | null>(null);
 /** 量出尺寸后的最终位置（null = 还没量，首次渲染先用锚点占位）。 */
 const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
 const rootRef = useRef<HTMLDivElement | null>(null);
 const restoreRef = useRef<HTMLElement | null>(null);

 const close = useCallback(() => setMenu(null), []);

 const open = useCallback<OpenContextMenu>((event, items) => {
  // 原生菜单由这里统一吞掉：全局安装器兜底（`main.tsx`），这里保证「行之间」也不互相触发
  event.preventDefault();
  event.stopPropagation();
  if (items.length === 0) return;
  const active = document.activeElement;
  restoreRef.current = active instanceof HTMLElement && active !== document.body ? active : null;
  setPos(null);
  setMenu({ x: event.clientX, y: event.clientY, items });
 }, []);
 const api = useMemo(() => ({ open }), [open]);

 // 摆放：先量真实尺寸再夹进视口（布局阶段同步修正，不闪）
 useLayoutEffect(() => {
  const el = rootRef.current;
  if (menu === null || pos !== null || el === null) return;
  const rect = el.getBoundingClientRect();
  setPos(placeContextMenu(menu.x, menu.y, rect.width, rect.height, window.innerWidth, window.innerHeight));
 }, [menu, pos]);

 // 打开期间：初始聚焦 + 关闭监听；卸载时把焦点还给触发前的元素
 useEffect(() => {
  if (menu === null) return;
  const el = rootRef.current;
  (el?.querySelector<HTMLElement>("button:not([disabled])") ?? el)?.focus({ preventScroll: true });

  const onPointerDown = (event: PointerEvent) => {
   if (el !== null && event.target instanceof Node && el.contains(event.target)) return;
   close();
  };
  const onKey = (event: KeyboardEvent) => {
   if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
   event.preventDefault();
   event.stopImmediatePropagation();
   close();
  };
  const dismiss = () => close();
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("resize", dismiss);
  // 滚动不冒泡但能捕获：侧栏等内层容器一滚，菜单（fixed 不跟手）直接收起
  window.addEventListener("scroll", dismiss, true);
  window.addEventListener("blur", dismiss);
  return () => {
   document.removeEventListener("pointerdown", onPointerDown, true);
   document.removeEventListener("keydown", onKey);
   window.removeEventListener("resize", dismiss);
   window.removeEventListener("scroll", dismiss, true);
   window.removeEventListener("blur", dismiss);
   const restore = restoreRef.current;
   restoreRef.current = null;
   const active = document.activeElement;
   // 只在焦点仍在菜单里（或已落回 body）时恢复：被别的浮层接走就不抢
   const owned = active === null || active === document.body || (el !== null && el.contains(active));
   if (restore !== null && owned && restore.isConnected && !restore.matches(":disabled") && restore !== active) {
    restore.focus({ preventScroll: true });
   }
  };
 }, [menu, close]);

 const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
  if (event.key === "Tab") {
   close();
   return;
  }
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
  const jump = event.key === "Home" ? "first" : event.key === "End" ? "last" : null;
  if (step === 0 && jump === null) return;
  event.preventDefault();
  const buttons = [...(rootRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])];
  if (buttons.length === 0) return;
  const current = buttons.indexOf(document.activeElement as HTMLElement);
  const next = jump === "first"
   ? 0
   : jump === "last"
    ? buttons.length - 1
    : current < 0
     ? step > 0 ? 0 : buttons.length - 1
     : (current + step + buttons.length) % buttons.length;
  buttons[next]?.focus({ preventScroll: true });
 };

 return (
  <ContextMenuContext.Provider value={api}>
   {children}
   {menu !== null && createPortal(
    <div
     ref={rootRef}
     role="menu"
     tabIndex={-1}
     aria-orientation="vertical"
     onKeyDown={onMenuKeyDown}
     style={{ left: pos?.x ?? menu.x, top: pos?.y ?? menu.y }}
     className="fixed z-10 min-w-44 max-w-72 rounded-lg border border-border bg-elevated py-1 shadow-pop"
    >
     {menu.items.map((entry, index) => isMenuItem(entry) ? (
      <button
       key={index}
       type="button"
       role="menuitem"
       disabled={entry.disabled}
       title={entry.title}
       onClick={() => {
        close();
        entry.onSelect();
       }}
       className={`flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-[13px] transition-colors duration-100 disabled:cursor-not-allowed ${entry.danger
        ? "text-danger hover:bg-danger/10 disabled:text-danger/45"
        : "text-foreground hover:bg-hover disabled:text-faint"}`}
      >
       <span className="flex size-4 shrink-0 items-center justify-center opacity-85">
        {entry.icon ? <entry.icon size={13} aria-hidden /> : null}
       </span>
       <span className="min-w-0 flex-1 truncate">{entry.label}</span>
      </button>
     ) : (
      <div key={index} role="separator" className="my-1 h-px bg-border-soft" />
     ))}
    </div>,
    document.body,
   )}
  </ContextMenuContext.Provider>
 );
}
