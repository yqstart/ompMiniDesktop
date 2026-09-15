import { api } from "@shared/api";

/**
 * 皮肤切换时让**运行中的** omp 重新探测终端外观（V29）。
 *
 * 根因：omp TUI 只在**启动时**用 OSC 11 问一次终端背景色（亮度 < 0.5 = 深色），
 * 据此在 `theme.dark` / `theme.light`（默认 dark-catppuccin / light-canyon）之间选一套，
 * 然后把**显式色值**画进屏幕；壳侧后来只换 xterm 的 `theme`，omp 已经画出的深色卡片
 * 不会跟着变（显式色单元格不随主题重绘），亮底上就留下一块块深色 —— 混合态。
 *
 * 上游给的口子：它的「重置终端显示」动作（`app.display.reset`，默认 **alt+l**）会
 * 重新发一次 OSC 11 并按应答重绑主题 + 重放转录。xterm.js 6 会照当前 `theme` 的
 * 背景色应答 OSC 11，所以壳侧只要在换完色之后把这个按键写进 PTY，
 * omp 就会自己切到另一套主题、自己重画（实测见 `docs/v29-schedule.md`）。
 */

/**
 * Alt+L 的 legacy 编码（ESC 前缀，xterm.js 自己送这个键时也是它）。
 * omp 的输入解码器按 50ms 超时收 ESC 序列，这里 `l` 紧随其后不成问题；
 * `macOptionIsMeta` 开着时用户手按 Alt+L 走的也是同一形态。
 */
export const DISPLAY_RESET_SEQUENCE = "\u001bl";

/**
 * 注入「重置终端显示」（alt+l）：触发 omp 重新探测 + 重放转录。
 *
 * 只给还活着的 PTY 调（调用方判 `status === "running"`）——退出的终端没有可换肤的 TUI。
 * **不**要求 π = 等待输入：这个动作正是要在工作态 / 等待确认态下也能收（用户就是在输出
 * 过程中切皮肤的）；启动早期注入的最坏情况是 TUI 还没注册按键而被丢掉，而那时 omp 启动
 * 自带的探测已经用的是新背景色，结果依然正确。失败静默（与 termRename / termRef 同口径）。
 */
export function notifyTerminalAppearance(id: string): void {
 void api.ptyWrite(id, DISPLAY_RESET_SEQUENCE).catch(() => undefined);
}
