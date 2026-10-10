// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { placeContextMenu } from "./contextMenu";

describe("placeContextMenu（右键菜单摆放）", () => {
 it("放得下：菜单落在指针右下方（原样）", () => {
  expect(placeContextMenu(100, 80, 200, 120, 1200, 800)).toEqual({ x: 100, y: 80 });
 });

 it("右溢出：翻到指针左侧", () => {
  expect(placeContextMenu(1100, 80, 200, 120, 1200, 800)).toEqual({ x: 900, y: 80 });
 });

 it("下溢出：翻到指针上方", () => {
  expect(placeContextMenu(100, 760, 200, 120, 1200, 800)).toEqual({ x: 100, y: 640 });
 });

 it("双溢出：翻到指针左上方", () => {
  expect(placeContextMenu(1150, 780, 200, 120, 1200, 800)).toEqual({ x: 950, y: 660 });
 });

 it("视口装不下整个菜单：夹进边缘 margin 内（不与窗口贴死）", () => {
  expect(placeContextMenu(600, 400, 900, 700, 800, 600)).toEqual({ x: 8, y: 8 });
 });
});

describe("installNativeContextMenuOff（全 app 禁用原生右键菜单）", () => {
 it("幂等安装一次监听；安装后 document 上的右键事件被吞掉", async () => {
  // 动态 import：要先 `vi.resetModules()` 拿到「没安装过」的新模块实例——静态 import 拿到的是
  // 已缓存的同一实例（它的 `installed` 可能已被本文件其他用例置位），测不出刚安装那一刻。
  vi.resetModules();
  const mod = await import("./contextMenu");
  const spy = vi.spyOn(document, "addEventListener");
  mod.installNativeContextMenuOff();
  mod.installNativeContextMenuOff();
  const attached = spy.mock.calls.filter((call) => call[0] === "contextmenu");
  expect(attached).toHaveLength(1);
  spy.mockRestore();

  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  document.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
 });
});
