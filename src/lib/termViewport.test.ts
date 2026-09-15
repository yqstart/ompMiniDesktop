import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 终端 IME 预编辑的样式护栏（V27）。
 *
 * 事实（真 Chromium + CDP `Input.imeSetComposition` 实测，见 `docs/v27-schedule.md`）：
 * xterm 的合成视图（`.composition-view`，未确认的预编辑）按「光标列 × cell 宽」绝对定位又
 * `nowrap`，并把隐藏的 textarea 同步成同一尺寸——行尾打拼音时一起伸出终端右缘；此后浏览器为
 * 了露出输入法光标，会沿祖先链推进每个可滚动容器的 `scrollLeft`。**`.xterm` 上只写
 * `overflow: hidden` 挡不住**（`hidden` 仍是滚动容器，实测 `.xterm.scrollLeft` 234 → 313，
 * 终端网格被整体左推）。修法 = 合成期整行内换行 + 祖先 `overflow: clip`。
 *
 * 这些规则没有运行时入口（删掉单测全绿、界面只在真实输入法下才复现），所以在样式表文本上钉住
 * 关键声明——本文件只读源码，不渲染。挂类与两个 CSS 变量的写入在 `src/lib/termIme.ts`。
 */
const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

/** 取选择器命中的声明块（`exact` = 选择器整体逐字相等，用于 `.xterm` / `#root` 这种会到处出现的名字）。 */
function declarationsOf(selector: string, exact = false): string[] {
 return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter((m) => {
   const sel = m[1].trim().replace(/\s+/g, " ");
   return exact ? sel === selector : sel.includes(selector);
  })
  .map((m) => m[2]);
}

describe("终端 IME 预编辑的样式护栏", () => {
 it("合成期把合成视图与输入框钉在整行宽度里换行（首行缩进走 --ime-indent）", () => {
  const blocks = declarationsOf(".ime-composing .composition-view");
  expect(blocks.length, "index.css 里找不到合成期的 `.composition-view` 规则").toBeGreaterThan(0);
  const rule = blocks.join("\n");
  expect(rule, "nowrap 的合成视图不会换行").toMatch(/white-space\s*:\s*pre-wrap\s*!important/);
  expect(rule, "取不到光标列就没有悬挂缩进").toMatch(/text-indent\s*:\s*var\(--ime-indent/);
  expect(rule, "没有右边界时不会换行").toMatch(/right\s*:\s*0\s*!important/);
  expect(rule, "inline 的单行高会让 textarea 量不到换行后的行数").toMatch(/height\s*:\s*auto\s*!important/);
 });

 it("预编辑文字自己上底，且按换行片段各画一块（不遮提示行）", () => {
  const rule = declarationsOf(".composition-view>span").join("\n");
  expect(rule, "找不到 span 的底色规则").not.toBe("");
  expect(rule).toMatch(/background\s*:\s*var\(--term-background\)/);
  expect(rule, "slice 会画成一整块矩形、盖住提示行与已输入文字").toMatch(/-webkit-box-decoration-break\s*:\s*clone/);
 });

 it("输入框不跟着 xterm 写的总高走，且字体与合成视图一致（否则候选窗错行）", () => {
  const rule = declarationsOf(".ime-composing .xterm-helper-textarea").join("\n");
  expect(rule).toMatch(/line-height\s*:\s*var\(--ime-line-height/);
  expect(rule).toMatch(/font-family\s*:\s*var\(--ime-font/);
 });

 it("辅助层有宽度，合成视图的 right / 百分比才解析得出来", () => {
  const rule = declarationsOf(".xterm .xterm-helpers").join("\n");
  expect(rule, "helpers 是 shrink-to-fit = 0 宽，不钉住就没有右边界").toMatch(/left\s*:\s*0/);
  expect(rule).toMatch(/right\s*:\s*0/);
 });

 it("祖先不可滚动：.xterm 与 #root 都用 overflow: clip", () => {
  for (const [selector, label] of [["#root", "#root"], [".xterm", ".xterm"]] as const) {
   const rule = declarationsOf(selector, true).join("\n");
   expect(rule, `找不到 ${label} 的规则`).not.toBe("");
   expect(rule, `${label} 还是可滚动容器（hidden 下 scrollLeft 会被写进去）`).toMatch(/overflow\s*:\s*clip/);
  }
 });
});
