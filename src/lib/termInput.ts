import type { Terminal } from "@xterm/xterm";

/** fallback 只需要 textarea（监听漏网输入）与公开的 `input()`（补发一次）。 */
type InputFallbackTerm = Pick<Terminal, "textarea" | "input">;

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
 * 先跑）。xterm 消费掉的输入会 `preventDefault`，IME 组字（`isComposing`）与删除、
 * 换行、粘贴等非 `insertText` 都有各自归宿——这些一律不动；只把 xterm 漏掉的真实文本
 * 经公开 `input()` 补发一次并清空 textarea 残留（否则 229 兜底的延时差值会把同一字符
 * 再发一遍，正好一次、不重复）。非 macOS 不挂载，保持上游行为。
 */
export function isMacKeyboard(): boolean {
 if (typeof navigator === "undefined") return false;
 return /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent);
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
  // xterm 已消费（它会 preventDefault）、IME 组字中、非文本插入：都不是漏网之鱼
  const e = event as InputEvent;
  if (e.defaultPrevented || e.isComposing) return;
  if (e.inputType !== "insertText" || !e.data) return;
  event.preventDefault();
  event.stopPropagation();
  term.input(e.data);
  textarea.value = "";
 };
 textarea.addEventListener("input", onInput);
 return () => {
  textarea.removeEventListener("input", onInput);
 };
}
