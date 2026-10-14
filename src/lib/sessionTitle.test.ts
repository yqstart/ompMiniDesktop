import { describe, expect, it } from "vitest";
import { sessionTitleForDisplay } from "./sessionTitle";

/** U+F084D（Nerd Fonts 的 `md-arrow_decision`）：用户标题前缀里实测用到的那一个。 */
const ICON = "\u{F084D}";
/** U+E0B0（Powerline）——同一段私有区里的另一个码位，用来验证不止一个图标能去。 */
const ICON2 = "\u{E0B0}";

describe("会话标题显示口径", () => {
 it("去掉开头的图标与紧随其后的空白", () => {
  expect(sessionTitleForDisplay(`${ICON} HGT: 修复输入框高度过高`)).toBe("HGT: 修复输入框高度过高");
 });

 it("图标后没有空白也照去", () => {
  expect(sessionTitleForDisplay(`${ICON}HGT: 修复输入框高度过高`)).toBe("HGT: 修复输入框高度过高");
 });

 it("连着几个图标一并去掉（含变体选择符与全角空格）", () => {
  expect(sessionTitleForDisplay(`${ICON}${ICON2}\uFE0F\u3000修复输入框高度过高`)).toBe("修复输入框高度过高");
 });

 it("中段的图标不动（它属于标题内容）", () => {
  expect(sessionTitleForDisplay(`修复输入框高度过高 ${ICON} 收尾`)).toBe(`修复输入框高度过高 ${ICON} 收尾`);
  expect(sessionTitleForDisplay(`HGT: ${ICON} 修复输入框高度过高`)).toBe(`HGT: ${ICON} 修复输入框高度过高`);
 });

 it("整条标题只有图标时返回原文（不留在空白行）", () => {
  expect(sessionTitleForDisplay(`${ICON} `)).toBe(`${ICON} `);
 });

 it("普通标题（中文 / 英文 / emoji）原样返回", () => {
  expect(sessionTitleForDisplay("HGT: 修复输入框高度过高")).toBe("HGT: 修复输入框高度过高");
  expect(sessionTitleForDisplay("Fix composer height")).toBe("Fix composer height");
  expect(sessionTitleForDisplay("✅ 修复完成")).toBe("✅ 修复完成");
 });
});
