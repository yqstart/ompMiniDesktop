// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContextMenuProvider } from "./ContextMenu";
import { useContextMenu } from "../lib/contextMenu";
import type { ContextMenuEntry } from "../lib/contextMenu";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

const picked = vi.fn();
const ENTRIES: ContextMenuEntry[] = [
 { label: "编辑工作区…", onSelect: () => picked("edit") },
 { separator: true },
 { label: "删除工作区", danger: true, onSelect: () => picked("delete") },
 { label: "禁用项", disabled: true, onSelect: () => picked("disabled") },
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 vi.clearAllMocks();
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

/** 触发区：可聚焦按钮（验证焦点恢复）+ 挂右键菜单的盒子。 */
function Harness({ entries = ENTRIES }: { entries?: ContextMenuEntry[] }) {
 const menu = useContextMenu();
 return (
  <div>
   <button data-trigger>触发</button>
   <div data-target onContextMenu={(e) => menu.open(e, entries)} style={{ width: 100, height: 100 }} />
  </div>
 );
}

function render(entries?: ContextMenuEntry[]): void {
 act(() => {
  root.render(
   <ContextMenuProvider>
    <Harness entries={entries} />
   </ContextMenuProvider>,
  );
 });
}

function rightClick(event: Partial<MouseEvent> = {}): MouseEvent {
 const target = container.querySelector<HTMLElement>("[data-target]")!;
 const ev = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 30, ...event });
 act(() => target.dispatchEvent(ev));
 return ev;
}

function menuItemLabels(): string[] {
 return [...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent ?? "");
}

describe("ContextMenuProvider（右键菜单）", () => {
 it("右键打开菜单：原生菜单被吞、项与分隔线按序渲染、首个可用项获得焦点", () => {
  render();
  const ev = rightClick();
  expect(ev.defaultPrevented).toBe(true);
  expect(menuItemLabels()).toEqual(["编辑工作区…", "删除工作区", "禁用项"]);
  expect(document.querySelectorAll('[role="separator"]')).toHaveLength(1);
  expect(document.activeElement?.textContent).toBe("编辑工作区…");
 });

 it("点禁用项无效；点可用项：先关菜单再执行", () => {
  render();
  rightClick();
  const [edit, remove, disabled] = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
  expect(disabled.disabled).toBe(true);
  act(() => disabled.click());
  expect(picked).not.toHaveBeenCalledWith("disabled");
  act(() => remove.click());
  expect(picked).toHaveBeenCalledWith("delete");
  expect(document.querySelector('[role="menu"]')).toBeNull();
  act(() => edit.click()); // 菜单已关，点击不应再触发（节点仍在 DOM 里但已卸载）
  expect(picked).not.toHaveBeenCalledWith("edit");
 });

 it("Esc 关闭并把焦点还给触发前的元素", () => {
  render();
  const trigger = container.querySelector<HTMLButtonElement>("[data-trigger]")!;
  act(() => trigger.focus());
  rightClick();
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
 });

 it("↑↓ 循环跳过禁用项", () => {
  render();
  rightClick();
  const send = (key: string) => act(() => {
   document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
  expect(document.activeElement?.textContent).toBe("编辑工作区…");
  send("ArrowDown");
  expect(document.activeElement?.textContent).toBe("删除工作区");
  send("ArrowDown"); // 跳过禁用项，回到第一项
  expect(document.activeElement?.textContent).toBe("编辑工作区…");
  send("ArrowUp");
  expect(document.activeElement?.textContent).toBe("删除工作区");
 });

 it("空菜单项：只吞原生菜单，不渲染菜单", () => {
  render([]);
  const ev = rightClick();
  expect(ev.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="menu"]')).toBeNull();
 });

 it("无 Provider（组件单测直渲）：退化成只吞原生菜单", () => {
  act(() => {
   root.render(<Harness />);
  });
  const ev = rightClick();
  expect(ev.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="menu"]')).toBeNull();
 });
});
