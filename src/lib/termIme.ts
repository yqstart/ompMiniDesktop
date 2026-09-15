import type { Terminal } from "@xterm/xterm";

/** 只需要 xterm 的根元素与 textarea（与 `lib/termInput.ts` 同款的最小接口）。 */
type ImeTerm = Pick<Terminal, "element" | "textarea">;

/**
 * 行尾中文预编辑（IME 合成）不再把工作区推偏：给合成视图套上「悬挂缩进 + 整宽换行」。
 *
 * **上游机制**（`@xterm/xterm` 6 的 `CompositionHelper.updateCompositionElements`）：
 * 合成视图（`.composition-view`）按「光标列 × cell 宽」绝对定位、`white-space: nowrap`，
 * 再把**隐藏的 textarea** 同步成同一尺寸——行尾打拼音时两者一起伸出终端右缘。此后浏览器为了
 * 把输入法光标拉回可视区，会沿着祖先链把每一个可滚动容器的 `scrollLeft` 推着走：
 * `.xterm` 上的 `overflow: hidden` 挡不住（`hidden` 仍是可滚动容器），实测终端网格被整体左推
 * 234 → 313px（真 Chromium + CDP `Input.imeSetComposition`）。
 *
 * **本模块做的事**：合成期给 `.xterm` 挂 `ime-composing`，把 xterm 写在合成视图上的 inline 几何
 * （光标列 / 行高 / 字体 / 字号）搬成四个 CSS 变量（`src/index.css` 的 `.xterm.ime-composing …`
 * 规则消费），于是：
 * - 合成视图与 textarea 都被钉在整行宽度里 `pre-wrap` 换行（首行用 `text-indent` 缩到光标列、
 *   续行回到第 0 列，与真实终端的换行一致）→ 内容再长也不越过终端右缘；
 * - 预编辑文字包一层 `<span>`，由 `box-decoration-break: clone` 给**每个换行片段**各画一块底色
 *   （提示行与已输入的文字不被遮住）——`padding: 2px 0` 只撑底色不撑行高，不影响换行点。
 *
 * 另有一处必须代偿的 xterm 行为：`updateCompositionElements` 把 textarea 的 `line-height`
 * 写成合成视图的**总高**，多行合成时会让 textarea 自己内部滚动（实测 `scrollHeight 74 /
 * clientHeight 37`、`scrollTop 25`）→ 镜像成 `--ime-line-height` 钉回 cell 高。
 *
 * 为什么不在冒泡阶段抢在 xterm 之前改：xterm 的 `compositionupdate` 处理（同为目标节点，
 * 监听按注册序执行）会先写 `textContent` 与 inline `left`；本模块的监听注册在它之后，
 * 正好读到最新值，再把 `left` 交给 CSS 变量（`left: 0 !important` 由样式表压制 inline 值）。
 * 合成视图的尺寸仍由 xterm 自己量（`getBoundingClientRect`），所以 IME 候选窗跟着换行后的光标走。
 *
 * 不改变非合成期的任何行为：所有规则都挂在 `.ime-composing` 下，类只在合成期间存在
 * （`compositionend` / `blur` 都会摘）。xterm 内部拿不到时返回空清理，保持上游行为。
 */
export function installImeCompositionWrap(term: ImeTerm): () => void {
 const root = term.element;
 const textarea = term.textarea;
 const view = root?.querySelector<HTMLElement>(".composition-view") ?? null;
 if (!root || !textarea || !view) return () => { };

 /** 把 xterm 刚写的 inline 几何与文本同步成 CSS 变量 + 带底色的 span。 */
 const sync = () => {
  // 光标列 / 行高 / 字体都由 xterm 写在合成视图的 inline 样式上（`updateCompositionElements`）：
  // 样式表靠这四个变量把 textarea 拉成与合成视图**同一个盒子**（换行点一致 → 输入法候选窗
  // 落在看得见的那一行）；字体尤其要注意——xterm 从不给 textarea 设字体，它会退回 body 的
  // 无衬线栈，与等宽栈的换行点不一致。
  const metrics: [string, string][] = [
   ["--ime-indent", view.style.left],
   ["--ime-line-height", view.style.lineHeight],
   ["--ime-font", view.style.fontFamily],
   ["--ime-font-size", view.style.fontSize],
  ];
  for (const [name, value] of metrics) {
   if (value) root.style.setProperty(name, value);
  }
  // 空的预编辑文字（compositionstart 刚清空）不包 span：那一步 xterm 也不量尺寸
  const text = view.textContent ?? "";
  if (text && !view.firstElementChild) {
   const span = document.createElement("span");
   span.textContent = text;
   view.replaceChildren(span);
  }
 };

 const start = () => root.classList.add("ime-composing");
 const update = () => {
  root.classList.add("ime-composing");
  sync();
 };
 const end = () => root.classList.remove("ime-composing");

 textarea.addEventListener("compositionstart", start);
 textarea.addEventListener("compositionupdate", update);
 textarea.addEventListener("compositionend", end);
 // 组字中途失焦（点走 / 切标签）不保证有 compositionend：别把类留成常驻
 textarea.addEventListener("blur", end);
 return () => {
  textarea.removeEventListener("compositionstart", start);
  textarea.removeEventListener("compositionupdate", update);
  textarea.removeEventListener("compositionend", end);
  textarea.removeEventListener("blur", end);
  root.classList.remove("ime-composing");
 };
}
