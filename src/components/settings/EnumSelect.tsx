import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Loader } from "reicon-react";
import { useDropdown } from "../../lib/useDropdown";

/** 下拉里的一项（`label` 已经是界面文本——取值表与 label 解析在 `lib/ompSettings.ts`）。 */
export type EnumChoice = { value: string; label: string };

/** 列表与视口边缘的间距 / 触发按钮与列表的间距 / 列表高度上限 / 压缩后的最小高度。 */
const MARGIN = 8;
const GAP = 4;
const MAX_HEIGHT = 280;
const MIN_HEIGHT = 96;

/**
 * 枚举设置的浮层下拉（`GeneralSettingsPanel` 用）。
 *
 * 为什么不做行内展开：设置页的内容区是唯一滚动容器（`SettingsPage`），行内展开会把后面
 * 几十行设置整体推走，也把「这块区域」变成页面里的一块常驻内容。所以列表 `portal` 到
 * `body`、用 `fixed` 定位贴着触发按钮（`fixed` 不受滚动容器裁剪）：滚动 / 改窗时重算，
 * 下方放不下且上方更宽裕时向上弹，量到位置前先 `visibility: hidden`（不闪左上一帧）。
 *
 * 位置直接写 `style`（effect 的职责就是同步 DOM，不为此 setState）：列表只在打开时由
 * React 渲染，`top` / `right` / `maxHeight` 不参与 React 的 style diff，后续重渲染不会
 * 把量好的位置刷掉。
 *
 * 关掉与聚焦交给 `useDropdown`：传 `ignore` 让触发按钮吃自己的点击——同一次点击若在
 * `pointerdown` 关、又在 `click` 开，按钮就永远关不上。
 */
export function EnumSelect({
 label,
 value,
 choices,
 busy = false,
 disabled = false,
 onPick,
}: {
 /** 行 label（下拉的无障碍名）。 */
 label: string;
 /** 当前值；不是字符串（上游没这个键 / 类型漂移）时显示占位符。 */
 value: string | undefined;
 choices: readonly EnumChoice[];
 busy?: boolean;
 disabled?: boolean;
 onPick: (value: string) => void;
}) {
 const [open, setOpen] = useState(false);
 const triggerRef = useRef<HTMLButtonElement>(null);
 const close = useCallback(() => setOpen(false), []);
 const listRef = useDropdown(open, close, triggerRef);

 useLayoutEffect(() => {
  const trigger = triggerRef.current;
  const list = listRef.current;
  if (!open || !trigger || !list) return;
  const place = () => {
   const rect = trigger.getBoundingClientRect();
   // scrollHeight 是内容高度（不受上一轮 maxHeight 影响）；量不到布局时退回上限值
   const height = Math.min(list.scrollHeight || MAX_HEIGHT, MAX_HEIGHT);
   const below = window.innerHeight - rect.bottom - GAP - MARGIN;
   const above = rect.top - GAP - MARGIN;
   const up = height > below && above > below;
   const room = Math.max(MIN_HEIGHT, up ? above : below);
   list.style.top = `${up ? Math.max(MARGIN, rect.top - GAP - Math.min(height, room)) : rect.bottom + GAP}px`;
   list.style.right = `${Math.max(MARGIN, window.innerWidth - rect.right)}px`;
   list.style.minWidth = `${Math.round(rect.width)}px`;
   list.style.maxHeight = `${Math.min(height, room)}px`;
   list.style.visibility = "visible";
  };
  place();
  // 设置面板滚动 / 窗口缩放都要跟着走（捕获阶段拿所有滚动容器的事件）
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
  return () => {
   window.removeEventListener("scroll", place, true);
   window.removeEventListener("resize", place);
  };
 }, [open, listRef]);

 return (
  <>
   <button
    ref={triggerRef}
    onClick={() => setOpen((v) => !v)}
    disabled={busy || disabled}
    aria-expanded={open}
    className="flex min-h-8 max-w-full cursor-pointer items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[12px] transition-colors duration-100 hover:bg-hover disabled:opacity-40"
   >
    {busy ? <Loader size={11} className="animate-spin" aria-hidden /> : null}
    {typeof value === "string" ? value : "—"}
    <ChevronDown size={11} aria-hidden />
   </button>
   {open && createPortal(
    <div
     ref={listRef}
     aria-label={label}
     style={{ visibility: "hidden" }}
     className="fixed z-10 max-w-[16rem] overflow-y-auto rounded-md border border-border bg-elevated p-1 shadow-pop"
    >
     {choices.map((choice) => (
      <button
       key={choice.value}
       onClick={() => {
        close();
        if (choice.value !== value) onPick(choice.value);
       }}
       aria-current={choice.value === value}
       title={choice.label}
       className={`block w-full cursor-pointer truncate rounded px-2 py-1 text-left text-[13px] transition-colors duration-100 hover:bg-hover ${choice.value === value ? "text-accent" : ""
        }`}
      >
       {choice.label}
      </button>
     ))}
    </div>,
    document.body,
   )}
  </>
 );
}
