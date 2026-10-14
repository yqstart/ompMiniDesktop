/**
 * 会话标题的显示口径：去掉**开头**的私有区（PUA）图标。
 *
 * 背景（2026-10-14，用户报「会话前的标识符太丑」）：用户的标题约定会在标题前挂一个 Nerd
 * Fonts 图标码位（实测 `󰡍 HGT: 修复输入框高度过高`，U+F084D 来自 omp 侧写入的 jsonl 标题）。
 * 壳里（WebView）没有覆盖私有区的字体，WebKit 回退到 Apple Symbols 的杂物字形——同一码位
 * 在别的字体下画出来的东西完全不同（U+F084D 实测是 6 根横条）。显示层一律去掉这段前缀，
 * 标题里剩下的文本照旧。
 *
 * 边界：
 * - **只去开头**：PUA 出现在标题中段属于标题内容，不搬运、不删（同一条消息里的图标不是「前缀」）。
 * - **数据不动**：只作用于显示（侧栏行 / 顶栏 / 命令面 / 归档 / 通知 / aria）；改名回显、导出、
 *   `list_sessions` 的原始标题都保持带图标的样子，谁也不许把显示口径写回数据。
 * - 整条标题只有图标（去掉后为空）时返回原文：行变空白比留个符号更难认。
 */
const LEADING_ICON = /^[\p{Co}\uFE0E\uFE0F]+[\s\u00A0]*/u;

/** 标题的显示文本：去掉开头的 PUA 图标（及其后的空白）。 */
export function sessionTitleForDisplay(title: string): string {
 const stripped = title.replace(LEADING_ICON, "");
 return stripped.trim() === "" ? title : stripped;
}
