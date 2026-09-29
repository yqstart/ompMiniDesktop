// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { installImeCompositionWrap } from "./termIme";

/**
 * 行尾中文预编辑的换行口（V27）。
 *
 * 护栏的是两件在真实输入法下才暴露、单测删掉全绿的事：
 * 1. 合成期给 `.xterm` 挂 `ime-composing`，并把 xterm 写的 inline 几何镜像成 CSS 变量
 *    （`--ime-indent` = 光标列、`--ime-line-height` = cell 高）——样式表靠这两个变量才把
 *    合成视图 / textarea 钉在整行宽度里换行（见 `src/index.css`）。
 * 2. 预编辑文字包一层 `<span>`（每个换行片段各画一块底色）；xterm 每次 `compositionupdate`
 *    都会重写合成视图的 `textContent`，所以必须**每次重包且只包一层**。
 *
 * xterm 的处理顺序在测试里照实复刻：先写文本 / inline 几何，再派发事件（本模块的监听注册在
 * 它之后，正好读到最新值）。
 */
let root: HTMLDivElement;
let textarea: HTMLTextAreaElement;
let view: HTMLDivElement;

beforeEach(() => {
 document.body.replaceChildren();
 root = document.createElement("div");
 root.className = "terminal xterm";
 const helpers = document.createElement("div");
 helpers.className = "xterm-helpers";
 textarea = document.createElement("textarea");
 textarea.className = "xterm-helper-textarea";
 view = document.createElement("div");
 view.className = "composition-view";
 helpers.append(textarea, view);
 root.append(helpers);
 document.body.append(root);
});

/** 复刻 `CompositionHelper.updateCompositionElements` 在 `compositionupdate` 里写的 inline 几何。 */
function xtermCompositionUpdate(text: string, left: number, lineHeight: number) {
 view.textContent = text;
 view.style.left = `${left}px`;
 view.style.top = "0px";
 view.style.height = `${lineHeight}px`;
 view.style.lineHeight = `${lineHeight}px`;
 view.style.fontFamily = "Menlo, monospace";
 view.style.fontSize = "13px";
 textarea.dispatchEvent(new Event("compositionupdate"));
}

const spans = () => [...view.querySelectorAll("span")].map((s) => s.textContent);

describe("IME 预编辑换行（合成视图不越界）", () => {
 it("合成期挂类，并把光标列 / 行高 / 字体镜像成 CSS 变量", () => {
  installImeCompositionWrap({ element: root, textarea });
  textarea.dispatchEvent(new Event("compositionstart"));
  xtermCompositionUpdate("xian", 986, 18);
  expect(root.classList.contains("ime-composing")).toBe(true);
  expect(root.style.getPropertyValue("--ime-indent")).toBe("986px");
  expect(root.style.getPropertyValue("--ime-line-height")).toBe("18px");
  // 字体不同 → textarea 的换行点与合成视图不一致 → 输入法候选窗错行
  expect(root.style.getPropertyValue("--ime-font")).toBe("Menlo, monospace");
  expect(root.style.getPropertyValue("--ime-font-size")).toBe("13px");
 });

 it("预编辑文字包一层 span（底色按换行片段画）；每次更新只留一层", () => {
  installImeCompositionWrap({ element: root, textarea });
  textarea.dispatchEvent(new Event("compositionstart"));
  expect(spans(), "compositionstart 清空文字时不该包 span").toEqual([]);
  xtermCompositionUpdate("xian", 986, 18);
  expect(spans()).toEqual(["xian"]);
  // xterm 重写 textContent（span 被顶掉）→ 必须重新包，且不能包两层
  xtermCompositionUpdate("xian'zai", 986, 18);
  expect(spans()).toEqual(["xian'zai"]);
 });

 it("compositionend 与组字中途失焦都摘类", () => {
  installImeCompositionWrap({ element: root, textarea });
  textarea.dispatchEvent(new Event("compositionstart"));
  xtermCompositionUpdate("xian", 986, 18);
  textarea.dispatchEvent(new Event("compositionend"));
  expect(root.classList.contains("ime-composing")).toBe(false);
  xtermCompositionUpdate("zai", 700, 18);
  textarea.dispatchEvent(new Event("blur"));
  expect(root.classList.contains("ime-composing")).toBe(false);
 });

 it("连着开两次合成：缩进跟着新的光标列走", () => {
  installImeCompositionWrap({ element: root, textarea });
  textarea.dispatchEvent(new Event("compositionstart"));
  xtermCompositionUpdate("xian", 986, 18);
  textarea.dispatchEvent(new Event("compositionend"));
  textarea.dispatchEvent(new Event("compositionstart"));
  xtermCompositionUpdate("zai", 1010, 18);
  expect(root.style.getPropertyValue("--ime-indent")).toBe("1010px");
  expect(spans()).toEqual(["zai"]);
 });

 it("清理后事件不再生效（切 / 关终端不许留残留类）", () => {
  const release = installImeCompositionWrap({ element: root, textarea });
  textarea.dispatchEvent(new Event("compositionstart"));
  release();
  expect(root.classList.contains("ime-composing")).toBe(false);
  xtermCompositionUpdate("xian", 986, 18);
  expect(root.classList.contains("ime-composing")).toBe(false);
 });

 it("xterm 内部拿不到时是空清理，不改上游行为", () => {
  const bare = document.createElement("textarea");
  expect(() => installImeCompositionWrap({ element: undefined, textarea: undefined })).not.toThrow();
  expect(() => installImeCompositionWrap({ element: root, textarea: undefined })).not.toThrow();
  // textarea 在、合成视图不在（xterm 结构变了）→ 不挂监听
  const release = installImeCompositionWrap({ element: bare, textarea: bare });
  bare.dispatchEvent(new Event("compositionstart"));
  expect(bare.classList.contains("ime-composing")).toBe(false);
  release();
 });
});
