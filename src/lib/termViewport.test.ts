import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * 终端裁剪的护栏（IME 修复）：xterm 的合成视图（`.composition-view`）按「光标列 × cell 宽」
 * 绝对定位且 nowrap，在行尾打中文（未确认的预编辑）时会伸出终端盒子，撑大面板与文档的滚动区
 * ——表现是整个工作区被横向推偏（实测 main.scrollWidth 898 → 1378，WKWebView 与 Chromium 同）。
 * 修法只有一条 CSS：`.xterm { overflow: hidden }`（见 src/index.css）。
 *
 * 这条规则没有运行时入口，删掉它单测全绿、界面也只在真实输入法下才复现，所以在这里钉住
 * 「样式表里确实存在这条裁剪」——本文件只读源码文本，不渲染。
 */
describe("终端裁剪（IME 合成视图不越界）", () => {
 const css = readFileSync(new URL("../index.css", import.meta.url), "utf8");

 it("index.css 给 .xterm 根元素上了 overflow: hidden", () => {
  // xterm 自带样式里也有 `.xterm { … }` 块，所以扫全部同名块，要求其中一块带裁剪
  const blocks = [...css.matchAll(/\.xterm\s*\{[^}]*\}/g)].map((m) => m[0]);
  expect(blocks.length, "index.css 里找不到 `.xterm { … }` 规则").toBeGreaterThan(0);
  expect(blocks.some((b) => /overflow\s*:\s*hidden/.test(b))).toBe(true);
 });
});
