// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { Terminal } from "@xterm/xterm";
import { installWkInputFallback, isDroppedInput } from "./termInput";
import type { DroppedInputCandidate, XtermDedupState } from "./termInput";

type TermParam = Pick<Terminal, "textarea" | "input" | "options"> & {
 _core?: XtermDedupState | null;
};

/** 真实 Terminal 上的私有成员（xterm 6.0.0 运行时实测存在，公开类型里没有）。 */
interface TerminalInternals {
 _core: XtermDedupState & { _inputEvent(ev: Event): boolean };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
 for (const fn of cleanups.splice(0)) fn();
});

/** navigator.platform 桩（jsdom 默认值不一定是 macOS，逐个用例显式声明）。 */
function stubPlatform(value: string) {
 const hadOwn = Object.prototype.hasOwnProperty.call(window.navigator, "platform");
 const prev = window.navigator.platform;
 cleanups.push(() => {
  if (hadOwn) {
   Object.defineProperty(window.navigator, "platform", { value: prev, configurable: true });
  } else {
   delete (window.navigator as unknown as Record<string, unknown>).platform;
  }
 });
 Object.defineProperty(window.navigator, "platform", { value, configurable: true });
}

function fakeTerm(init?: { core?: XtermDedupState | null; screenReader?: boolean }) {
 stubPlatform("MacIntel");
 const textarea = document.createElement("textarea");
 document.body.appendChild(textarea);
 cleanups.push(() => textarea.remove());
 const onInput = vi.fn();
 const term = {
  textarea,
  input: onInput,
  options: { screenReaderMode: init?.screenReader ?? false },
  ...(init && "core" in init ? { _core: init.core } : { _core: { _keyDownSeen: true, _keyPressHandled: false } }),
 } as unknown as TermParam;
 return { textarea, term, onInput };
}

/** 一次落字的判定形状；默认值 = WKWebView 漏键场景（Shift 按住时的 composed insertText）。 */
function candidate(over?: Partial<DroppedInputCandidate>): DroppedInputCandidate {
 return { defaultPrevented: false, isComposing: false, inputType: "insertText", data: "?", composed: true, ...over };
}

/** jsdom 的 InputEvent 构造未必支持 data/inputType/composed：用基础 Event 补属性。 */
function inputEvent(c: DroppedInputCandidate): Event {
 const ev = new Event("input", { bubbles: true, cancelable: true });
 Object.defineProperties(ev, {
  data: { value: c.data },
  inputType: { value: c.inputType },
  isComposing: { value: c.isComposing },
  composed: { value: c.composed },
 });
 return ev;
}

/** 走浏览器原生顺序：文本先落进 textarea，再派发 input（可选模拟 xterm 捕获阶段先跑）。 */
function fireInput(textarea: HTMLTextAreaElement, c: DroppedInputCandidate, xtermHandled = false): Event {
 const release = xtermHandled
  ? (() => {
   const handler = (e: Event) => e.preventDefault();
   textarea.addEventListener("input", handler, true);
   return () => textarea.removeEventListener("input", handler, true);
  })()
  : () => { };
 if (c.data) textarea.value += c.data;
 const ev = inputEvent(c);
 textarea.dispatchEvent(ev);
 release();
 return ev;
}

/**
 * 真实 xterm 的 `_inputEvent` 判决（`src/browser/CoreBrowserTerminal.ts` 逐字镜像）：
 * true = xterm 自己触发了 data（补发即重复），false = xterm 拒绝（fallback 才该补）。
 * 与 `isDroppedInput` 对拍：`dropped === !accepted` 必须恒成立（互补，无重叠无漏网）。
 */
function xtermAccepts(c: DroppedInputCandidate, core: XtermDedupState, screenReaderMode: boolean): boolean {
 if (c.defaultPrevented || c.isComposing) return false;
 if (
  c.data &&
  c.inputType === "insertText" &&
  (!c.composed || !core._keyDownSeen) &&
  !screenReaderMode
 ) {
  return core._keyPressHandled !== true;
 }
 return false;
}

describe("终端 WKWebView 漏键补丁", () => {
 it("xterm 真正漏掉时补发一次、标记事件已消费、不动 textarea（首击不再被吞）", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  const ev = fireInput(textarea, candidate());
  expect(onInput).toHaveBeenCalledTimes(1);
  expect(onInput).toHaveBeenCalledWith("?");
  expect(textarea.value).toBe("?");
  expect(ev.defaultPrevented).toBe(true);
 });
 it("补发的事件不再冒泡（上层监听收不到）", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  const seen: Event[] = [];
  const listener = (e: Event) => seen.push(e);
  document.addEventListener("input", listener);
  cleanups.push(() => document.removeEventListener("input", listener));
  fireInput(textarea, candidate());
  expect(onInput).toHaveBeenCalledTimes(1);
  expect(seen).toEqual([]);
 });
 it("keypress 已发的字符不补（空格/大写不再打出两个）", () => {
  const { textarea, term, onInput } = fakeTerm({ core: { _keyDownSeen: true, _keyPressHandled: true } });
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ data: " " }));
  fireInput(textarea, candidate({ data: "A" }));
  expect(onInput).not.toHaveBeenCalled();
  expect(textarea.value).toBe(" A");
 });
 it("xterm 自己会消费的输入不补（keyDownSeen 已清）", () => {
  const { textarea, term, onInput } = fakeTerm({ core: { _keyDownSeen: false, _keyPressHandled: false } });
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ data: "," }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("非 composed 的输入不补（xterm 自己会发）", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ composed: false }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("xterm 已消费的输入（defaultPrevented）不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ data: "@" }), true);
  expect(onInput).not.toHaveBeenCalled();
 });
 it("IME 组字中（isComposing）的输入不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ isComposing: true }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("删除等非文本输入不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ inputType: "deleteContentBackward" }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("空 data 不动", () => {
  const { textarea, term, onInput } = fakeTerm();
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ data: "" }));
  fireInput(textarea, candidate({ data: null }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("读屏模式不动（textarea 是读屏器信源）", () => {
  const { textarea, term, onInput } = fakeTerm({ screenReader: true });
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate());
  expect(onInput).not.toHaveBeenCalled();
  expect(textarea.value).toBe("?");
 });
 it("读不到内部状态时宁可不补（不双发）", () => {
  const { textarea, term, onInput } = fakeTerm({ core: null });
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate());
  expect(onInput).not.toHaveBeenCalled();
 });
 it("清理后不再干预", () => {
  const { textarea, term, onInput } = fakeTerm();
  const release = installWkInputFallback(term);
  release();
  fireInput(textarea, candidate({ data: "@" }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("非 macOS 不挂监听（保持上游行为）", () => {
  stubPlatform("Win32");
  const textarea = document.createElement("textarea");
  document.body.appendChild(textarea);
  cleanups.push(() => textarea.remove());
  const onInput = vi.fn();
  const term = {
   textarea,
   input: onInput,
   options: { screenReaderMode: false },
   _core: { _keyDownSeen: true, _keyPressHandled: false },
  } as unknown as TermParam;
  cleanups.push(installWkInputFallback(term));
  fireInput(textarea, candidate({ data: "@" }));
  expect(onInput).not.toHaveBeenCalled();
 });
 it("没有 textarea 时返回空清理、不抛错", () => {
  stubPlatform("MacIntel");
  const term = { textarea: undefined, input: vi.fn() } as unknown as TermParam;
  expect(() => installWkInputFallback(term)()).not.toThrow();
 });
});

describe("补发谓词与 xterm 判决对拍（一次且仅一次）", () => {
 it("穷举输入形状 × 去重状态 × 读屏：xterm 会发的绝不补，xterm 会丢的必须补", () => {
  for (const data of ["?", " ", "A", ",", '"', "\u{1F600}"]) {
   for (const inputType of ["insertText", "deleteContentBackward", "insertFromPaste"]) {
    for (const composed of [true, false]) {
     for (const keyDownSeen of [true, false]) {
      for (const keyPressHandled of [true, false]) {
       for (const screenReaderMode of [true, false]) {
        for (const flag of ["ok", "composing", "prevented"] as const) {
         const c = candidate({
          defaultPrevented: flag === "prevented",
          isComposing: flag === "composing",
          data,
          inputType,
          composed,
         });
         const core: XtermDedupState = { _keyDownSeen: keyDownSeen, _keyPressHandled: keyPressHandled };
         // 只有「xterm 会丢、且别的路径也没发」才补：xterm 接受（自己会发）、keypress 已发、
         // 读屏接管、IME 组字、浏览器已受理（prevented）、非文本插入，一律不补。
         const sentElsewhere =
          xtermAccepts(c, core, screenReaderMode) ||
          c.defaultPrevented ||
          c.isComposing ||
          screenReaderMode ||
          c.inputType !== "insertText" ||
          !c.data ||
          keyPressHandled;
         expect(isDroppedInput(c, core, screenReaderMode)).toBe(!sentElsewhere);
        }
       }
      }
     }
    }
   }
  }
 });
 it("真实 xterm 6.0.0：去重字段是布尔量，接受 / 拒绝与谓词一致且各发一次", () => {
  const term = new Terminal({ cols: 80, rows: 24 });
  cleanups.push(() => term.dispose());
  const internals = term as unknown as TerminalInternals; // xterm 不公开私有字段类型（运行时实测存在）
  const core = internals._core;
  const emitted: string[] = [];
  term.onData((d) => emitted.push(d));
  expect(typeof core._keyDownSeen).toBe("boolean");
  expect(typeof core._keyPressHandled).toBe("boolean");
  // 无 keydown 挂起（seen=false）：xterm 自己发，谓词必须判「没漏」——补发即双发
  const accepted = candidate({ data: ",", composed: false });
  expect(core._inputEvent(inputEvent(accepted))).toBe(true);
  expect(isDroppedInput(accepted, core, false)).toBe(false);
  expect(emitted).toEqual([","]);
  // Shift 按住（seen=true）+ composed：xterm 拒绝，谓词必须判「漏了」——补发正好一次
  const raw = core as unknown as Record<string, unknown>; // 直接置位模拟 Shift 的 keydown（无 open 时拿不到 textarea 事件）
  raw._keyDownSeen = true;
  const dropped = candidate({ data: "?" });
  expect(core._inputEvent(inputEvent(dropped))).toBe(false);
  expect(isDroppedInput(dropped, core, false)).toBe(true);
  term.input("?"); // fallback 的唯一动作：公开 input() 补发一次
  expect(emitted).toEqual([",", "?"]);
 });
});
