import type { Terminal } from "@xterm/xterm";

/**
 * shift+滚轮 = 回看滚动缓冲（壳侧代偿，2026-10-09）。
 *
 * 背景（上游实测见 `docs/v25-schedule.md` 补记）：
 * - omp 开着「鼠标支持」（`tui.mouse`，本机用户就是开的）时会打开鼠标上报
 *   （`?1000h ?1003h ?1006h`）。xterm 6 随即把滚轮**交给应用**：自绘滚动器的滚轮处理停用
 *   （`handleMouseWheel = !(protocol & WHEEL)`），滚轮被转成 SGR 上报
 *   （实测 `\x1b[<64;…M`）发给 omp——普通滚轮归应用是对的（omp 自己的列表 / 弹窗要用它）。
 * - 于是**回看终端滚动缓冲**只剩 shift+滚轮这一条路——omp 自己也是这么写的：
 *   `tui.mouse` 的设置说明就是「…wheel scroll becomes shift+wheel while on」。
 * - 但 xterm 6.0.0 只实现了半截：`CoreMouseService.consumeWheelEvent` 见到 `shiftKey`
 *   就返回 0（= 不发上报，本该把事件让给「原生滚动」），外层 handler 却照样
 *   `preventDefault + stopPropagation` → **shift+滚轮被整个吞掉**（实测：视口不动、
 *   `onData` 一个字都没有）。omp 的主视图对滚轮上报本来就没反应（实测：连喂 4 个
 *   wheel 上报，PTY 输出 0 字节），于是用户看到的就是「终端里根本没法向上滚」。
 *
 * 本模块做的事：在宿主元素上以**捕获相位**接管 shift+滚轮（早于 xterm 挂在 `.xterm` /
 * `.xterm-scrollable-element` 上的所有监听），自己把滚轮折算成行数喂 `term.scrollLines()`。
 * 普通滚轮、备用屏（alt buffer，没有回看历史，交回 xterm 转方向键）一律不动。
 *
 * 折算口径：像素模式按行高折行、余量累计（触控板一次只有几个像素，不累计永远凑不满一行）；
 * 行 / 页模式直接换算。与 xterm 自己的滚轮折算同构（`consumeWheelEvent`），只是不做它那套
 * 「小增量 ×0.3」的触控板阻尼——shift+滚轮要的是一段可预期的回看位移。
 */

/** `WheelEvent.deltaMode`：1 = 行，2 = 页，其余（0 / 未知）按像素处理。 */
const DELTA_LINE = 1;
const DELTA_PAGE = 2;

export interface WheelFoldContext {
 /** 一行的高度（CSS 像素）——调用方从 DOM 量（`.xterm-rows` 的行高），量不到用宿主高度 / 行数。 */
 cellHeight: number;
 /** 终端行数（`term.rows`），页模式用。 */
 rows: number;
 /** 灵敏度（`term.options.scrollSensitivity`，默认 1）。 */
 sensitivity: number;
 /** 上一轮没凑满一行的余量（上一次的 `WheelFoldResult.partial` 回喂）。 */
 partial: number;
}

export interface WheelFoldResult {
 /** 本次应滚的行数（负 = 向上回看；已取整，可能为 0 = 只更新了余量）。 */
 lines: number;
 /** 折算后不足一行的余量，回喂下一次。 */
 partial: number;
}

/**
 * 把一次滚轮折算成「滚几行 + 新余量」。取整用 `Math.trunc`（朝零），
 * 于是余量恒在 (-1, 1) 内、符号与滚动方向一致。
 */
export function foldWheelScroll(
 deltaY: number,
 deltaMode: number,
 ctx: WheelFoldContext,
): WheelFoldResult {
 const cell = ctx.cellHeight > 0 ? ctx.cellHeight : 1;
 const rows = Math.max(1, ctx.rows);
 const sens = ctx.sensitivity > 0 ? ctx.sensitivity : 1;
 let want: number;
 if (deltaMode === DELTA_LINE) want = deltaY * sens;
 else if (deltaMode === DELTA_PAGE) want = deltaY * rows * sens;
 else want = (deltaY / cell) * sens;
 const acc = ctx.partial + want;
 // `Math.trunc(-0.5)` 是 `-0`：化掉它，免得调用方在 `-0` 上做相等判断踩坑
 const lines = Math.trunc(acc) || 0;
 return { lines, partial: acc - lines };
}

/** 挂监听与折算只需要这几个公开口（与 `lib/termIme.ts` 同款的最小接口）。 */
export type ShiftWheelTerm = Pick<Terminal, "buffer" | "rows" | "options" | "scrollLines">;

/** 一行的高度：优先量 DOM 渲染器写的行元素，量不到退回「宿主高度 / 行数」（再不行给 1px 兜底）。 */
function measureCellHeight(term: ShiftWheelTerm, host: HTMLElement): number {
 const row = host.querySelector(".xterm-rows > div");
 const h = row ? row.getBoundingClientRect().height : 0;
 if (h > 0) return h;
 const fallback = host.clientHeight / Math.max(1, term.rows);
 return fallback > 0 ? fallback : 1;
}

/**
 * 在 `host`（终端面板容器）上安装 shift+滚轮的接管，返回卸载函数。
 * 捕获相位 + `passive: false`：既先于 xterm 的所有监听跑，也能 `preventDefault`。
 */
export function installShiftWheelScroll(term: ShiftWheelTerm, host: HTMLElement): () => void {
 let partial = 0;
 const onWheel = (e: WheelEvent) => {
  if (!e.shiftKey || e.deltaY === 0) return;
  // 备用屏没有回看历史：交回 xterm 自己的处理（它会转成方向键）
  if (term.buffer.active.type !== "normal") return;
  e.preventDefault();
  e.stopPropagation();
  const fold = foldWheelScroll(e.deltaY, e.deltaMode, {
   cellHeight: measureCellHeight(term, host),
   rows: term.rows,
   sensitivity: term.options.scrollSensitivity ?? 1,
   partial,
  });
  partial = fold.partial;
  if (fold.lines !== 0) term.scrollLines(fold.lines);
 };
 host.addEventListener("wheel", onWheel, { passive: false, capture: true });
 return () => host.removeEventListener("wheel", onWheel, true);
}
