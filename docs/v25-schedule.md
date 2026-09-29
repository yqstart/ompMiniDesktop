# V25 终端「回到最新输出」悬浮键

> 目标：omp 的流式输出很快，用户向上回看时输出已经走了很远，滚回去要滚很久——
> 终端面板右下角浮出一枚向下箭头的悬浮键，点击直接回到最新位置。
> 上游口径与实测见 §1（`@xterm/xterm` 6 本机实测，2026-09-28）。

## 1. 上游事实与实测（xterm 6）

|问题|结论|
|---|---|
|怎么判断「视口不在底部」|`term.buffer.active.viewportY < term.buffer.active.baseY`（`viewportY` = 视口顶行、`baseY` = 底部页顶行；贴底时两者相等）。不用解析字节流、不用自己记行数。|
|什么时候重新判定|`term.onScroll`（用户滚轮 / 键盘 / 程序化滚动）+ `term.onWriteParsed`（每次写入解析完）。**只订阅 `onScroll` 不够**：贴底时新输出会把 `viewportY` 一起推着走（视口跟随），上滚时 xterm 又不动视口（见下一条）——两个方向都可能只有写入事件才看得到。|
|回看中来了新输出，会不会把视口拽回底部|**不会**。实测：视口停在 line 0048–0089，期间输出推进到 0351，顶行一动不动。这正是用户要「手动滚回去」的原因，也就是这个键存在的理由。|
|怎么回到底部|`term.scrollToBottom()`（瞬时；`smoothScrollDuration` 保持默认 0——用户要的是「立刻回到最新」，不是缓动）。|
|能不能用 DOM `<div class="xterm-viewport">` 的 `scrollTop` 判断滚动位置|**不能**。xterm 6 的滚动条是自绘 overlay（`.xterm-scrollable-element > .scrollbar`，`index.css` 里已单独隐藏），视口滚动是内部虚拟滚动：实测 `.xterm-viewport` 的 `scrollHeight === clientHeight`、`scrollTop` 恒为 0，用它判断会永远误判成「贴底」。位置判断一律走 `buffer.active`。|

## 2. 实现（`src/components/terminal/TerminalPane.tsx`）

- **状态**：组件内 `atBottom`（初值 `true`）；`syncAtBottom()` 读 `buffer.active` 两个字段比对，**只有布尔翻转才写 React state**——流式输出时写入事件很密，不能每次回调都渲染。
- **浮出条件**：`!atBottom && term.status === "running"`。贴底时不渲染；omp 退出（退出浮层的遮罩态）时也不渲染。
- **外观**：32px 圆形（`size-8` + `rounded-full`），`border-border` + `bg-elevated` + `shadow-pop`，图标 `ChevronDown`（`reicon-react`，16px），`text-muted` → hover `bg-hover` + `text-foreground`；定位 `absolute right-3 bottom-3 z-10`（压在终端内容之上、不参与布局）。`aria-label` / `title` = 字典键 `termScrollToBottom`（中文「回到最新输出」/ 英文 "Jump to latest output"）。
- **点击**：`term.scrollToBottom()` + `focus()`——回底后立刻能继续输入，按钮随状态翻转自动消失，不额外维护「已点击」这类本地态。
- **不动的地方**：不碰 omp、不碰 PTY 与字节流、不写 Zustand（仍是每个终端组件的局部状态，与「高频字节流不进 store」的口径一致）。

## 3. 完成口径

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **289 项前端单测**（含字典中英同键校验）+ `e2e:ipc`（69 命令 × 双向一致）。
- **真实 Chromium 核对**（`pnpm build` + `pnpm preview` + 注入 `__TAURI_INTERNALS__` mock，含 Channel 帧协议；mock 在 `pty_spawn` 后先推 320 行、随后每 250ms 一行，模拟 omp 的快速流式输出）：
  - 贴底：右下角**没有**按钮（`button[aria-label="回到最新输出"]` 不存在）；
  - 上滚约 240 行（视口停在 line 0048–0089）：按钮浮出，32×32、落在面板右下角；深色 / 浅色两套皮肤都核对（截图）；
  - 回看期间新输出继续到达（推进到 0351）：**视口不跳**（顶行仍是 0048）、按钮保持可见；
  - 点击按钮：视口回到最新（末行 = 当前输出末行 0351）、按钮消失、`document.activeElement` 回到 `xterm-helper-textarea`；
  - 进程退出（mock 发 `exit`）：退出浮层出现，按钮不渲染；
  - 重启（退出浮层的「重启」）后再回看：按钮照常浮出。

## 4. 边界（明确不做）

- 不做「新输出条数」计数徽章、不做未读小点——先看这枚键够不够用。
- 不新增快捷键：xterm 自身已有「用户输入时回到底部」（`scrollOnUserInput`）等行为，壳侧不另立键位。
- 键盘可达性：终端内的 Tab 会进 PTY（xterm 口径），这枚键与退出浮层的按钮一样**只能鼠标点击**——不做额外的键序接管。
- 不提供「自动跟随 / 暂停跟随」开关：xterm 的既有行为（回看即暂停跟随）保持不变，壳侧只补「一键回去」。
- 不做终端滚动位置持久化（重启不恢复 tab 的既有口径不变，见 `docs/v11-schedule.md` §7）。
