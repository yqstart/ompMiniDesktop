/**
 * 平台判定（纯逻辑，可单测）：快捷键的修饰键按平台分叉的唯一口径。
 *
 * mac 用 `⌘`（`metaKey`），其余平台用 `Ctrl`；调用方（App 全局快捷键 / FindBar /
 * 各处 kbd 提示）都从这里取，不各自探测（`navigator.platform` 已废弃，用
 * `userAgent` 的 `Mac` / `iPad` 判定：iPad 外接键盘时修饰键同样是 ⌘）。
 */
export function isMacKeyboard(): boolean {
 if (typeof navigator === "undefined") return false;
 const ua = navigator.userAgent;
 return /Mac|iPhone|iPad|iPod/.test(ua);
}
