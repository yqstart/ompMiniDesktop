# V29 皮肤切换后终端不再留下混合色（让运行中的 omp 重新探测外观）

> 症状（用户实测，附截图）：**浅色皮肤**下终端里仍留着一块块深色卡片与深色状态行——
> 「在终端输出过程中去切换了皮肤」之后出现的半深半浅混合态。
> 根因与上游机制见 §1（omp 18.4.4 + xterm.js 6.0.0，本机实测，2026-09-30）；
> 修法：壳侧在皮肤切换后给**每个还活着的终端**注入 omp 自己的「重置终端显示」按键（alt+l）。

## 0. 范围与口径

| 决策 | 结论 |
|---|---|
| 症状 | 皮肤在深 / 浅之间切换时，omp **已经画出的显式色单元格**不跟 xterm 的新主题走（亮底上留深卡、深底上留亮块） |
| 根因 | omp TUI 只在**启动时**用 OSC 11 问一次终端背景色，据此在 `theme.dark` / `theme.light` 之间选定一套；会话中途不再问（§1①②） |
| 修法 | `<html class="dark">` 变化时：① 先换 xterm 的 `theme`（既有行为）；② 给每个 `status === "running"` 的终端注入 `ESC l`（Alt+L = omp 的 `app.display.reset`）→ omp 重新探测 → 重绑主题 → 清屏（含滚动缓冲）+ 用新配色重放转录 |
| 新文件 | `src/lib/termAppearance.ts`（注入通道 + 单测）；`TerminalPane` 的皮肤 MutationObserver 里调用 |
| 不做 | 不重启终端、不写 omp 配置、不实现 2031 外观上报协议、不代偿 omp 自己的渲染（§5） |

## 1. 上游事实（omp 18.4.4 + xterm.js 6.0.0 本机实测）

**① 启动探测一次；会话中途唯一的重新探测入口是「重置终端显示」（默认 alt+l）。**

omp 的 TUI 起来时写 `\x1b]11;?\x07`（再跟一个 `\x1b[c` 要 DA1），把 OSC 11 应答里的 RGB 按
`0.299R + 0.587G + 0.114B < 0.5 ⇒ dark` 判深浅（`packages/tui` 的 `#Le`），命中后绑
`theme.dark`（默认 `dark-catppuccin`）/ `theme.light`（默认 `light-canyon`），然后**只在这一刻决定**。
会话中途能触发重探的只有 `app.display.reset`（默认 **alt+l**）→ `resetDisplayAfterAppearanceRefresh()`：
先 `refreshAppearance()`（重发 OSC 11 查询），再 `resetDisplay()`（`\x1b[H\x1b[2J\x1b[3J` + 历史重放）。

**② SIGWINCH 不是入口。** 它只重绑**缓存的**外观（`Ipt("SIGWINCH")` → `Ppt()` 取上次探测结果
`_We`，主题名没变 → 直接返回），不会重新问终端。改尺寸只能把旧配色重画一遍。

**③ 「外观上报」协议走不通。** omp 启动时发 `\x1b[?2031h` 并 DECRQM 查询 `\x1b[?2031$p`；
xterm.js 6 对未知私有模式回 `\x1b[?2031;0$y`（"not recognized"），omp 那侧对同一模式还会去重
（`#Ue` 的 `#se` 集合），本版里 `\x1b[?997;…n` 外观上报分支是**死代码**——终端主动推、omp 不消费。

**④ xterm.js 6 会照当前 `theme.background` 应答 OSC 11。** 实测它对 omp 的探测回
`\x1b]11;rgb:1717/1717/1717\x1b\\`（深色皮肤 `--term-background` = `#171717`）/
`\x1b]11;rgb:f3f3/f5f5/f9f9\x1b\\`（浅色 `#f3f5f9`）；DA1 回 `\x1b[?1;2c`；DECRQM 已知模式报状态、
未知回 `;0$y`。**所以只要让 omp 再问一次，它拿到的就是新皮肤的底色。**

**⑤ 端到端实测**（真 Chromium + 仓库里同一个 `@xterm/xterm` 6.0.0 + 真实 `omp` 跑在真 PTY 里的桥）：

| 时刻 | 事件 |
|---|---|
| 启动 ~0.7s | omp 发 `]11;?` → xterm 答深色 → omp 用 `dark-catppuccin` 画（卡片底 `#11111b`） |
| 切浅色皮肤（改 `term.options.theme`）+ 直写 `ESC l` 进 PTY | — |
| +20ms | omp 重新发 `]11;?` |
| +30ms | xterm 答 `rgb:f3f3/f5f5/f9f9` |
| +数秒 | omp 用 `light-canyon` **清屏 + 重放转录**（实测约 30KB 输出；底色从 `#11111b` 变成 `#f2e8dd`） |

反向（浅 → 深）同样成立；同一终端里连切两次就是两次这样的往返。`ESC l`（legacy）与
`\x1b[27;3;108~`（modifyOtherKeys 形态）都能被 omp 认成 alt+l —— 前者正是 xterm.js 自己送
alt+l 的形态，也是壳侧注入用的那一串。

**⑥ 混合态的成因**：omp 画卡片 / 状态行用的是**显式色**（`48;2;R;G;B`）；xterm 换主题只重绘
「默认色」单元格，显式色的旧单元格原地不动 —— 这就是截图里「亮底 + 深卡」的来源。

**⑦ 重放会清滚动缓冲**：`resetDisplay` 里带 `\x1b[3J`（ED3 = 连已滚出的行一起擦），
所以「回看历史」不会再看到旧配色的残留（实测：切换后把整个缓冲逐行扫一遍，
55 行里显式色行全部是浅色、0 行深色）。

## 2. 设计

- **谁触发**：皮肤切换本身（`applyTheme` 改 `<html class="dark">`，V27 起的既有通道）。
  `TerminalPane` 里那个 MutationObserver 已经在做「换 xterm 配色」，现在多一步「通知 omp」。
  跟随系统的档位下、系统外观变化也走同一条路。
- **注入什么**：`ESC l`（Alt+L，legacy 形态）。这是 omp 官方键位 `app.display.reset` 的默认键，
  不是壳侧自造的私有协议。
- **什么时候注入**：`status === "running"`（PTY 还活着）就注入。**不**要求 π = 等待输入——
  用户报的场景正是「输出过程中切皮肤」；等待确认（`!`）时该动作也被上游绑定（ask 弹窗内同样触发）。
  启动早期注入最坏情况是被还没注册按键的 TUI 丢掉：那时 omp 启动自带的探测用的已经
  是**新**皮肤的底色，结果依然正确。
- **顺序**：先 `term.options.theme = readTermTheme()`，再注入 —— omp 的探测必须被
  **新**底色应答（xterm 是在收到探测那一刻读 `theme.background` 的）。
- **失败静默**：与 `termRename` / `termRef` 同一条 PTY 通道（`api.ptyWrite`），写失败不打扰用户。

## 3. 实现

| 层 | 文件 | 内容 |
|---|---|---|
| 注入逻辑 | `src/lib/termAppearance.ts`（+ `termAppearance.test.ts`） | `DISPLAY_RESET_SEQUENCE = "\u001bl"`；`notifyTerminalAppearance(id)` 走 `api.ptyWrite`；注释里写明「为什么是 alt+l」 |
| 触发点 | `src/components/terminal/TerminalPane.tsx` | 皮肤 MutationObserver 的回调：换色 → 从 store 取当前终端 → `status === "running"` 才 `notifyTerminalAppearance` |
| 文档 | 本文件 + `AGENTS.md`（文档索引 / 核心数据流 / lib 清单）+ `CHANGELOG.md` | — |

## 4. 验证

- **单测**：`termAppearance.test.ts` 钉住注入的字节（`ESC l`，不带回车）；`pnpm check` 全绿
  （typecheck / lint 0 警告 / vitest 337 项 / `e2e:ipc` 71 命令）。
- **应用层核对**（`pnpm build` + `pnpm preview` + 真 Chromium + `__TAURI_INTERNALS__` mock，
  目录数据与终端全走 mock）：开一个终端 → 切「深色」（class 变化）→ mock 记录到
  `pty_write(id, "\u001bl")`；切「浅色」→ 再记一次；给该终端推 `exit` 事件后 → 切皮肤**不再注入**；
  同色档位间点击（class 没变）也不注入。
- **端到端（上游行为）**：§1⑤ 的表 —— 真 xterm.js + 真 omp：注入后 20ms 重探、应答新底色、
  清屏重放为新配色；切换前后整份缓冲逐行扫描无旧配色残留（§1⑦）。
- **反向（浅 → 深）**与**连续切换**同样走过一遍。

## 5. 边界（不做）

- **不重启终端、不重开会话**：注入一个按键就够了（上游的官方入口）。
- **不写 omp 配置**：`theme.dark` / `theme.light` 是上游设置，壳侧只让 omp 重新探测，
  不替它选主题；用户在 omp TUI 里手改过主题（`/theme` 固定某一套）时，重探也只影响
  「自动档」——那是上游行为，壳侧不代偿。
- **不实现 2031 外观上报协议**：本版 omp 不消费终端推送（§1③），实现它没有效果。
- **不覆盖 omp 内部的渲染**：重放的是 omp 自己的转录；omp 没记进转录的东西（例如它在
  启动画面上写过的欢迎语）随 `ED3` 一起消失——实测如此，属上游行为。
- **无法区分「用户自己在跑的内层程序」**：若用户在 omp 的 bash 工具交互里正好处于
  命令行输入中、此时切换皮肤，`ESC l` 会被那层程序收到（readline 的 `M-l` = downcase-word）。
  概率极低且无害；要绝对避免只能改成「下次重启终端才生效」，那是更差的取舍。
