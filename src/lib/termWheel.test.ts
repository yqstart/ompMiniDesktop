// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { foldWheelScroll, installShiftWheelScroll } from "./termWheel";
import type { ShiftWheelTerm } from "./termWheel";

/**
 * shift+滚轮回看（壳侧接管）的折算与接线。
 *
 * 护栏的是两片在真机才暴露、删掉后全绿的事：
 * 1. **折算**：像素模式按行高折行、余量跨事件累计（触控板一次几个像素，不累计永远滚不动），
 *    行 / 页模式直接换算；取整朝零，余量恒在 (-1, 1)。
 * 2. **接线**：shift+滚轮必须被接管（preventDefault + stopPropagation + scrollLines），
 *    普通滚轮与备用屏一律不碰——omp 开着「鼠标支持」时普通滚轮要留给它自己。
 */

const BASE = { cellHeight: 16, rows: 24, sensitivity: 1, partial: 0 };

describe("滚轮折算 foldWheelScroll", () => {
 it("像素模式按行高折行（上滚为负）", () => {
  expect(foldWheelScroll(-48, 0, BASE)).toEqual({ lines: -3, partial: 0 });
  expect(foldWheelScroll(48, 0, BASE)).toEqual({ lines: 3, partial: 0 });
 });

 it("触控板的小增量跨事件累计（不丢余量）", () => {
  // 8px / 16px = 半行：两次才凑一行
  const first = foldWheelScroll(-8, 0, BASE);
  expect(first.lines).toBe(0);
  const second = foldWheelScroll(-8, 0, { ...BASE, partial: first.partial });
  expect(second.lines).toBe(-1);
  expect(second.partial).toBe(0);
  // 累计多出的一行要给出去，不能反复吞
  const third = foldWheelScroll(-40, 0, { ...BASE, partial: second.partial });
  expect(third).toEqual({ lines: -2, partial: -0.5 });
 });

 it("行 / 页模式直接换算，不看行高", () => {
  expect(foldWheelScroll(-3, 1, BASE)).toEqual({ lines: -3, partial: 0 });
  expect(foldWheelScroll(-1, 2, BASE)).toEqual({ lines: -24, partial: 0 });
 });

 it("灵敏度乘进折算；非法值退化成 1", () => {
  expect(foldWheelScroll(-32, 0, { ...BASE, sensitivity: 2 })).toEqual({ lines: -4, partial: 0 });
  expect(foldWheelScroll(-32, 0, { ...BASE, sensitivity: 0 })).toEqual({ lines: -2, partial: 0 });
 });

 it("量不到行高（0）不产生 NaN / Infinity，按 1px 处理", () => {
  const r = foldWheelScroll(-5, 0, { ...BASE, cellHeight: 0 });
  expect(r).toEqual({ lines: -5, partial: 0 });
  expect(Number.isFinite(r.partial)).toBe(true);
 });

 it("多次折算的位移守恒：|累计行数| × 行高 ≈ |累计像素|（误差 < 一行）", () => {
  let partial = 0;
  let lines = 0;
  for (const d of [-7, -13, -40, -2, -97, -31]) {
   const r = foldWheelScroll(d, 0, { ...BASE, partial });
   partial = r.partial;
   lines += r.lines;
  }
  const px = lines * BASE.cellHeight;
  expect(Math.abs(-190 - px)).toBeLessThan(BASE.cellHeight);
 });
});

describe("接线 installShiftWheelScroll", () => {
 let host: HTMLDivElement;
 let scrollLines: Mock;
 let term: ShiftWheelTerm;
 let bufferType: "normal" | "alternate";

 const wheel = (init: WheelEventInit) => {
  const e = new WheelEvent("wheel", { deltaY: -48, cancelable: true, bubbles: true, ...init });
  host.dispatchEvent(e);
  return e;
 };

 beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement("div");
  document.body.append(host);
  // jsdom 不做布局：clientHeight 恒 0 → 直接钉成 384px（24 行 → 16px 一行）
  Object.defineProperty(host, "clientHeight", { value: 384, configurable: true });
  bufferType = "normal";
  scrollLines = vi.fn();
  term = {
   buffer: {
    get active() {
     return { type: bufferType } as never;
    },
   } as never,
   rows: 24,
   options: { scrollSensitivity: 1 } as never,
   scrollLines: scrollLines as never,
  };
 });

 it("shift+滚轮被接管：吞掉事件、按行高滚动（上滚为负）", () => {
  installShiftWheelScroll(term, host);
  const e = wheel({ shiftKey: true, deltaY: -48 });
  expect(e.defaultPrevented).toBe(true);
  expect(scrollLines).toHaveBeenCalledWith(-3);
 });

 it("滚不满一行的增量只累计、不强滚", () => {
  installShiftWheelScroll(term, host);
  wheel({ shiftKey: true, deltaY: -8 });
  expect(scrollLines).not.toHaveBeenCalled();
  wheel({ shiftKey: true, deltaY: -8 });
  expect(scrollLines).toHaveBeenCalledWith(-1);
 });

 it("普通滚轮一律不碰（留给 omp / xterm 自己的处理）", () => {
  installShiftWheelScroll(term, host);
  const e = wheel({ shiftKey: false, deltaY: -48 });
  expect(e.defaultPrevented).toBe(false);
  expect(scrollLines).not.toHaveBeenCalled();
 });

 it("备用屏（alt buffer）不接管：没有回看历史，交回 xterm 转方向键", () => {
  installShiftWheelScroll(term, host);
  bufferType = "alternate";
  const e = wheel({ shiftKey: true, deltaY: -48 });
  expect(e.defaultPrevented).toBe(false);
  expect(scrollLines).not.toHaveBeenCalled();
 });

 it("deltaY === 0（横向滚轮）不接管", () => {
  installShiftWheelScroll(term, host);
  const e = wheel({ shiftKey: true, deltaY: 0, deltaX: 30 });
  expect(e.defaultPrevented).toBe(false);
  expect(scrollLines).not.toHaveBeenCalled();
 });

 it("卸载后不再接管", () => {
  const dispose = installShiftWheelScroll(term, host);
  dispose();
  const e = wheel({ shiftKey: true, deltaY: -48 });
  expect(e.defaultPrevented).toBe(false);
  expect(scrollLines).not.toHaveBeenCalled();
 });
});
