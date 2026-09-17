// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DialogShell } from "./DialogShell";

/**
 * DialogShell 的焦点契约（用户实测 bug 的回归测试）：「输入一下输入框就失焦，焦点跑到整个弹窗上」。
 *
 * 根因是依赖不稳的挂载 effect：调用方给的都是内联 `onClose`（每次渲染都是新函数），
 * 一旦把它放进 effect 依赖，输入框每敲一个字 → 父级 state 更新 → 新 `onClose` → effect 重跑 →
 * `cardRef.focus()` 把焦点从输入框抢回卡片。
 */

/** React 19 的 `act` 要求显式声明测试环境，否则每次调用都打警告。 */
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

/** 真实用法形态：弹窗里有个输入框，`onClose` 由调用方内联给出（每次渲染新函数）。 */
function dialog(onClose: () => void) {
 return (
  <DialogShell title="标题" onClose={onClose} width="max-w-2xl">
   <input aria-label="field" />
  </DialogShell>
 );
}

describe("DialogShell 焦点", () => {
 it("挂载时焦点落在卡片上", () => {
  act(() => {
   root.render(dialog(() => { }));
  });
  expect(document.activeElement?.getAttribute("role")).toBe("dialog");
 });

 it("重渲染（调用方换新的 onClose）不抢走输入框焦点", () => {
  act(() => {
   root.render(dialog(() => { }));
  });
  const field = container.querySelector("input");
  if (!field) throw new Error("输入框没渲染出来");
  act(() => field.focus());
  expect(document.activeElement).toBe(field);

  // 模拟「敲一个字符 → 父级 state 更新 → 传给弹窗的 onClose 是新函数」
  act(() => {
   root.render(dialog(() => { }));
  });
  expect(document.activeElement).toBe(field);
 });

 it("Esc 触发重渲染后的最新 onClose", () => {
  const first = vi.fn();
  const second = vi.fn();
  act(() => {
   root.render(dialog(first));
  });
  act(() => {
   root.render(dialog(second));
  });
  act(() => {
   document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).not.toHaveBeenCalled();
 });
});
