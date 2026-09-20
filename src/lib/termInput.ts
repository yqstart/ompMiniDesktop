import type { Terminal } from "@xterm/xterm";

/** xterm 内部去重状态（私有字段，运行时存在；读不到时宁可不补，避免双发回归）。 */
export interface XtermDedupState {
 _keyDownSeen?: unknown;
 _keyPressHandled?: unknown;
}

/** fallback 只需要 textarea（监听漏网输入）、公开的 `input()`（补发）与 `options`（读屏门控）。 */
type InputFallbackTerm = Pick<Terminal, "textarea" | "input" | "options"> & {
 _core?: XtermDedupState | null;
};

/** `input` 事件里做决定只需要这五个字段（单测与真实 xterm 对拍都喂这个形状）。 */
export interface DroppedInputCandidate {
 defaultPrevented: boolean;
 isComposing: boolean;
 inputType: string;
 data: string | null;
 composed: boolean;
}

/**
 * macOS WKWebView 漏键补丁（上游 xterm.js #5374 的壳侧代偿，Tauri macOS 跑的正是 WKWebView）。
 *
 * 症状：中文 IME 开启（或按住 Shift/CapsLock）时，`?` `@` `"` 这类 Shift 组合键的首击被吞，
 * 按第二遍才进；连打 `""` 时第二个也只出一个——本质都是第一次输入没了。
 *
 * 机制：WebKit 把字符的 input 排在了字符自身 keydown 之前到达，
 * xterm 此时还记着修饰键的 keydown（内部 `_keyDownSeen=true`），把这段真实输入误判成
 * 「keydown 已发过的重复回声」而丢弃；随后的字符 keydown 以 keyCode 229 进 composition
 * 兜底，但 textarea 差值此时已为空、无事可发——首击就没了，
 * 第一次的 keyup 把标记清零后第二遍才正常。
 *
 * 代偿：在 textarea 上再挂一层冒泡阶段的 `input` 监听（xterm 自己的监听在捕获阶段，
 * 先跑）。只补 xterm 按自身规则会拒绝、且 keypress 也没发的那一次（`isDroppedInput`，
 * `_inputEvent` 接受条件 `(!composed || !keyDownSeen) && !keyPressHandled` 的镜像，
 * 与真实 xterm 对拍保证一次且仅一次）；IME 组字、删除、换行、粘贴等非 `insertText`
 * 与读屏模式一律不动。非 macOS 不挂载，保持上游行为。
 *
 * 0.4.1 的教训：曾用 `defaultPrevented` 判断“xterm 已消费”，但 xterm 默认
 * `cancelEvents=false`，消费成功也不 `preventDefault`——空格、大写字母等正常字符
 * 全被补了第二遍（逗号、引号、空格打出两个）。这次不猜消费与否，只看漏否。
 *
 * 补发只走公开 `input()`，不动 textarea 内容：落字是 xterm 自己逐次清理的
 * （Enter / Ctrl+C / 失焦；上游 xterm.js #6078 的积累问题），壳侧不代清空。
 */
export function isMacKeyboard(): boolean {
 if (typeof navigator === "undefined") return false;
 return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
}

/**
 * xterm 是否会丢掉这次 `input`：true = xterm 自己不会发，fallback 才补；
 * false = xterm 会发（或 keypress/读屏会接管），一律不动。
 * 读不到内部去重状态时按“没漏”处理（保持上游行为，宁可沿用旧漏键也不双发）。
 */
export function isDroppedInput(
 e: DroppedInputCandidate,
 core: XtermDedupState | null | undefined,
 screenReaderMode: boolean | undefined,
): boolean {
 if (e.defaultPrevented || e.isComposing) return false;
 if (e.inputType !== "insertText" || !e.data) return false;
 // 读屏模式 xterm 故意不消费 input（textarea 内容是读屏器的信源）：不动。
 if (screenReaderMode) return false;
 const seen = core?._keyDownSeen;
 const press = core?._keyPressHandled;
 return (
  e.composed === true &&
  typeof seen === "boolean" &&
  typeof press === "boolean" &&
  seen &&
  !press
 );
}

/**
 * 在 `terminal.open()` 之后调用；返回清理函数，xterm dispose 时调用。
 * 非 macOS 或拿不到 textarea 时返回空清理。
 */
export function installWkInputFallback(term: InputFallbackTerm): () => void {
 if (!isMacKeyboard()) return () => { };
 const textarea = term.textarea;
 if (!textarea) return () => { };
 const onInput = (event: Event) => {
  const e = event as InputEvent;
  const data = e.data;
  if (!data) return;
  // 正常字符即使 xterm 已消费也无标记（默认 cancelEvents=false 不 preventDefault）——
  // 漏否只看它自己的接受条件，不猜消费；读不到内部状态就当没漏（不双发）。
  if (!isDroppedInput(e, term._core, term.options?.screenReaderMode)) return;
  event.preventDefault();
  event.stopPropagation();
  term.input(data);
 };
 textarea.addEventListener("input", onInput);
 return () => {
  textarea.removeEventListener("input", onInput);
 };
}
