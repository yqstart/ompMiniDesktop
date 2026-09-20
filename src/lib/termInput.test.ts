// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Terminal } from "@xterm/xterm";
import { installWkInputFallback } from "./termInput";

type TermParam = Pick<Terminal, "textarea" | "input">;

const cleanups: Array<() => void> = [];
afterEach(() => {
 let fn = cleanups.pop();
 while (fn) {
  fn();
  fn = cleanups.pop();
 }
});

/** navigator.platform 桩（jsdom 默认值不一定是 macOS，逐个用例显式声明）。 */
function stubPlatform(value: string) {
 const hadOwn = Object.prototype.hasOwnProperty.call(window.navigator, "platform");
 const prev = window.navigator.platform;
 Object.defineProperty(window.navigator, "platform", { value, configurable: true });
 cleanups.push(() => {
  if (hadOwn) {
   Object.defineProperty(window.navigator, "platform", { value: prev, configurable: true });
  } else {
   delete (window.navigator as unknown as Record<string, unknown>).platform;
  }
 });
}

function fakeTerm() {
 stubPlatform("MacIntel");
 const textarea = document.createElement("textarea");
 document.body.appendChild(textarea);
 cleanups.push(() => textarea.remove());
 const onInput = vi.fn();
 const term = { textarea, input: onInput } as unknown as TermParam;
 return { textarea, term, onInput };
}

/** jsdom 的 InputEvent 构造未必支持 data/inputType，用基础 Event + 补属性模拟。 */
function fireInput(
 textarea: HTMLTextAreaElement,
 init: { data?: string | null; inputType?: string; isComposing?: boolean; xtermHandled?: boolean },
) {
 const { data = null, inputType = "insertText", isComposing = false, xtermHandled = false } = init;
 // xterm 真实行为：消费掉的 input 会 preventDefault（捕获阶段先跑，此处先注册以同序模拟）
 const releaseXterm = xtermHandled
  ? (() => {
   const handler = (e: Event) => e.preventDefault();
   textarea.addEventListener("input", handler, true);
   return () => textarea.removeEventListener("input", handler, true);
  })()
  : () => { };
 // 模拟浏览器原生落字：文本已进 textarea 才触发 input
 if (typeof data === "string" && data) textarea.value += data;
 const ev = new Event("input", { bubbles: true, cancelable: true });
 Object.defineProperties(ev, {
  data: { value: data },
  inputType: { value: inputType },
  isComposing: { value: isComposing },
 });
 textarea.dispatchEvent(ev);
 releaseXterm();
}

describe("终端 WKWebView 漏键补丁", () => {
 it("xterm 漏掉的真实文本补发一次并清空残留（首击不再被吞）", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, { data: "?" });
  expect(onInput).toHaveBeenCalledTimes(1);
  expect(onInput).toHaveBeenCalledWith("?");
  expect(textarea.value).toBe("");
 });
 it("xterm 已消费的输入（defaultPrevented）不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, { data: "@", xtermHandled: true });
  expect(onInput).not.toHaveBeenCalled();
 });
 it("IME 组字中（isComposing）的输入不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, { data: "?", isComposing: true });
  expect(onInput).not.toHaveBeenCalled();
 });
 it("删除等非文本输入不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, { inputType: "deleteContentBackward" });
  expect(onInput).not.toHaveBeenCalled();
 });
 it("空 data 不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, { data: "" });
  fireInput(textarea, { data: null });
  expect(onInput).not.toHaveBeenCalled();
 });
 it("清理后不再干预", () => {
  const { textarea, term, onInput } = fakeTerm();
  const release = installWkInputFallback(term);
  release();
  fireInput(textarea, { data: "@" });
  expect(onInput).not.toHaveBeenCalled();
 });
 it("非 macOS 不挂监听（保持上游行为）", () => {
  stubPlatform("Win32");
  const textarea = document.createElement("textarea");
  document.body.appendChild(textarea);
  cleanups.push(() => textarea.remove());
  const onInput = vi.fn();
  const term = { textarea, input: onInput } as unknown as TermParam;
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, { data: "@" });
  expect(onInput).not.toHaveBeenCalled();
 });
 it("没有 textarea 时返回空清理、不抛错", () => {
  stubPlatform("MacIntel");
  const term = { textarea: undefined, input: vi.fn() } as unknown as TermParam;
  expect(() => installWkInputFallback(term)()).not.toThrow();
 });
});
