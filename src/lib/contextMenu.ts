/**
 * 右键菜单的壳侧逻辑（2026-10-10，用户口径：「左栏操作按钮太多，期望右键操作；app 内全局
 * 禁用默认右键事件」）。
 *
 * 三块内容：
 * - `placeContextMenu`：菜单摆放纯函数——按指针位置向右下展开，右 / 下溢出翻到另一侧，
 *   最后夹进视口（不与边缘贴死）。组件（`components/ContextMenu.tsx`）量出真实尺寸后调它；
 * - React context（`ContextMenuContext` / `useContextMenu`）：行组件把菜单项交给顶层
 *   单实例的 `ContextMenuProvider`。没有 Provider 时（组件单测等）退化成「只吞原生菜单」；
 * - `installNativeContextMenuOff`：**全 app 禁用系统默认右键菜单**（WebView 的重新载入 /
 *   检查元素 / 复制 / 拼写建议…）。组件自己的右键动作走 React 的 `onContextMenu`（合成事件
 *   挂在应用根容器上，先于这里挂到 `document` 的原生监听执行），不受影响。
 */
import { createContext, useContext } from "react";
import type { IconComponent } from "reicon-react";

/** 菜单与窗口边缘的最小距离（px）。 */
const VIEWPORT_MARGIN = 8;

/**
 * 摆放右键菜单：锚点 = 指针位置。
 * 右 / 下溢出 → 向左 / 上展开（菜单落在指针的左上）；仍放不下 → 夹进视口（margin 内）。
 */
export function placeContextMenu(
 anchorX: number,
 anchorY: number,
 width: number,
 height: number,
 viewportWidth: number,
 viewportHeight: number,
 margin = VIEWPORT_MARGIN,
): { x: number; y: number } {
 let x = anchorX;
 let y = anchorY;
 if (x + width + margin > viewportWidth) x = anchorX - width;
 if (y + height + margin > viewportHeight) y = anchorY - height;
 const maxX = Math.max(margin, viewportWidth - width - margin);
 const maxY = Math.max(margin, viewportHeight - height - margin);
 return { x: Math.min(Math.max(x, margin), maxX), y: Math.min(Math.max(y, margin), maxY) };
}

/** 菜单项图标：reicon 图标组件（传组件而不是元素，尺寸由菜单统一给）。 */
export type ContextMenuIcon = IconComponent;

export type ContextMenuItem = {
 label: string;
 icon?: ContextMenuIcon;
 /** 危险操作（删除 / 移除）：danger 配色。 */
 danger?: boolean;
 disabled?: boolean;
 /** 禁用 / 补充说明的悬停提示。 */
 title?: string;
 onSelect: () => void;
};

/** 分隔线（同组菜单项之间）。 */
export type ContextMenuSeparator = { separator: true };

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

export function isMenuItem(entry: ContextMenuEntry): entry is ContextMenuItem {
 return !("separator" in entry);
}

/** `open` 只需要事件的这几个成员：既收 React 合成事件，也能被单测构造。 */
export type ContextMenuOpenEvent = {
 clientX: number;
 clientY: number;
 preventDefault: () => void;
 stopPropagation: () => void;
};

export type OpenContextMenu = (event: ContextMenuOpenEvent, items: readonly ContextMenuEntry[]) => void;

/** 行组件拿到的菜单接口：`const menu = useContextMenu(); menu.open(e, items)`。 */
export type ContextMenuApi = { open: OpenContextMenu };

/** 没有 Provider（组件单测直接渲染行组件）时的退路：只吞原生菜单，不弹自定义菜单。 */
const fallbackApi: ContextMenuApi = {
 open: (event) => {
  event.preventDefault();
  event.stopPropagation();
 },
};

export const ContextMenuContext = createContext<ContextMenuApi>(fallbackApi);

/** 在行的 `onContextMenu` 里调用：`useContextMenu().open(e, items)`（内部已吞原生菜单）。 */
export function useContextMenu(): ContextMenuApi {
 return useContext(ContextMenuContext);
}

let installed = false;

/** 幂等安装：全 app 只挂一次（`main.tsx` 启动时调用）；已装则 no-op。 */
export function installNativeContextMenuOff(): void {
 if (installed) return;
 installed = true;
 document.addEventListener("contextmenu", (event) => event.preventDefault());
}
