# V27 行尾中文预编辑（IME 合成）不再把终端推偏

> 目标：在 omp 终端行尾输入拼音、**还没选字**时，预编辑文字在终端内**换行**——既不伸出终端右缘，
> 更不把整个工作区横向推偏（左栏一起走的那个现象）。
> 上游口径与实测见 §1（`@xterm/xterm` 6，真 Chromium + CDP `Input.imeSetComposition`，2026-09-29）。

## 1. 上游事实与实测（xterm 6）

|问题|结论|
|---|---|
|合成视图怎么画|`CompositionHelper.updateCompositionElements()`：`.composition-view`（未确认的预编辑文字）按 `left = 光标列 × cell 宽`、`top = 光标行 × cell 高` 绝对定位，行高与字体取自终端配置，**`white-space: nowrap`（xterm.css）且没有右边界**——宽度就是文本宽度。|
|谁跟着一起变大|隐藏的 `textarea`（`.xterm-helper-textarea`）。同一个函数把它的 `left/top/width/height/line-height` 全按合成视图的 `getBoundingClientRect()` 写一遍（IME 需要「光标就在那里」）。所以越界是**两个元素一起**越界。|
|为什么 `.xterm { overflow: hidden }` 挡不住（0.7.0 已发布的口径）|`hidden` 也是**滚动容器**。浏览器为了让输入法光标可见，会沿祖先链把每个可滚动容器的 `scrollLeft` 推进去——`.xterm` 挡住了「滚动条」，但挡不住 `scrollLeft`。实测 `.xterm.scrollLeft` 0 → 234 → 313，终端网格被整体左推（父面板不再滚，因为 `.xterm` 已经替它吃掉了）。|
|三种口径的实测对比（同一夹具：终端铺满面板、光标停在第 12 个 cell 之前、拼音 40 字符）|**无任何规则**：合成视图右缘超出终端右缘 **+313px**，面板容器 `scrollLeft` 0 → 297（工作区被推偏）。<br>**只上 `overflow: hidden`**（0.7.0）：超出 **+313px**，`.xterm.scrollLeft` 0 → 234 → 313。<br>**本口径**：超出 **0**，`.xterm` / 面板 / `#root` / 文档 `scrollLeft` 全为 **0**。|
|能不能只按「剩余宽度」换行（纯 CSS）|不行。行尾只剩几个 cell 时，合成视图退化成一列 1 cell 宽、几十行高（实测宽 8px / 高 938px）——大部分预编辑掉到面板外看不见，「换行」等于没换。所以走**悬挂缩进**：首行缩到光标列、续行从第 0 列起（与真实终端的换行一致），块宽恒等于整行。|
|块宽怎么给|`.composition-view` 的包含块是 `.xterm-helpers`（绝对定位）——它自己**没有宽度**（子元素全是绝对定位 → shrink-to-fit = 0），`right` / 百分比都无从解析。必须先把它钉成与 `.xterm-screen` 同宽（`left: 0; right: 0`）。|
|换行后的行数要进 rect|`height: auto !important`（xterm 写的是单行 cell 高）。否则 textarea 拿到的仍是单行尺寸。|
|textarea 的行高|xterm 把 textarea 的 `line-height` 写成合成视图的**总高**（`updateCompositionElements` 里 `lineHeight = compositionViewBounds.height`）——多行合成时 textarea 自己内部滚动（实测 `scrollTop 25 / scrollHeight 74 / clientHeight 37`）。必须钉回 cell 高。|
|textarea 的字体|xterm **从不**给它设字体 → 它落在 `body` 的无衬线栈（实测 14px sans），而合成视图是终端等宽栈（13px mono）→ 换行点与可见的预编辑不一致 → 输入法候选窗按 textarea 的光标算，会跟着错行。必须一起镜像。|
|换行片段的底色|`box-decoration-break: clone`（带 `-webkit-` 前缀）让**每个换行片段各画一块**底色；默认的 `slice` 会画成一整块矩形，把提示行与已输入的文字一起盖住。|
|谁能被推进去|`overflow: clip` 的盒子**不是**滚动容器 → 祖先链上无物可推。`.xterm` 与 `#root`（终端面板与它之间没有别的滚动容器，所以外壳就是那个「被推偏」的容器）都改成 `clip`（保留 `hidden` 作旧引擎回退）。|

## 2. 实现

- **`src/lib/termIme.ts` 的 `installImeCompositionWrap(term)`**（`TerminalPane` 在 `x.open()` 之后挂，卸载时清理）：
  - 合成期给 `.xterm` 挂 `ime-composing`（`compositionend` / `blur` 都摘——组字中途点走不保证有 `compositionend`）；
  - 监听注册在 **xterm 之后**（同一目标节点按注册序执行），于是在每次 `compositionupdate` 里读到的是**最新**的 inline `left` / `lineHeight` / `fontFamily` / `fontSize`，把它们搬成 `--ime-indent` / `--ime-line-height` / `--ime-font` / `--ime-font-size` 四个 CSS 变量（挂 `.xterm` 根上，靠继承给合成视图与 textarea 一起用）；
  - 预编辑文字包一层 `<span>`（xterm 每次都会重写 `textContent` 把 span 顶掉 → 每次重包、且只包一层），底色由样式表给。
- **`src/index.css`**：
  - `.xterm .xterm-helpers { left: 0; right: 0 }`——辅助层有宽度，`right` 才解析得出；
  - `.xterm.ime-composing .composition-view, .xterm.ime-composing .xterm-helper-textarea`：`left: 0 / right: 0 / width: auto`（`!important` 压 xterm 的 inline 值）+ `white-space: pre-wrap` + `overflow-wrap: anywhere` + `word-break: break-all` + `text-indent: var(--ime-indent)`；
  - 合成视图额外 `height: auto !important`、透明底、正文色；`> span` 才上 `--term-background` 底 + `box-decoration-break: clone`（`padding: 2px 0` 只把底色撑到整行高，纵向内边距不进行框，换行点不变）；
  - textarea 额外 `line-height: var(--ime-line-height)`、`font-family: var(--ime-font, var(--font-mono))`、`font-size: var(--ime-font-size, inherit)`；
  - `.xterm` 与 `#root`：`overflow: hidden; overflow: clip;`。
- **不动的地方**：不碰 omp / PTY / 字节流，不改 xterm 内部实现（只读它的 inline 值 + 挂类），不新增依赖。

## 3. 完成口径（实测）

- **真 Chromium 三口径 A/B**（夹具 = 真 xterm + 真 `xterm.css` + 真 `FitAddon` + 真 `Input.imeSetComposition`）：见 §1 第三行；本口径的合成视图 rect = 整行宽 × 2 行高（1057 × 37），各层 `scrollLeft` 全 0。
- **应用内核对**（`pnpm build` + `pnpm preview` + 注入 `__TAURI_INTERNALS__` mock；CDP `Input.imeSetComposition` 驱动真合成；1440×900，左栏 292）：

|场景|结果|
|---|---|
|合成中（拼音 40 字符，光标在行尾）|`.xterm` 类含 `ime-composing`；`--ime-indent = 1017.27px`、`--ime-line-height = 18.41px`、`--ime-font` = 终端等宽栈、`--ime-font-size = 13px`；合成视图 `293 → 1412`（= 整行 1119px）、高 37（2 行）、`text-indent 1017px`、`white-space: pre-wrap`；**越界 0**；`.xterm` / `#root` / 文档 `scrollLeft` 全 0。|
|同一场景的按行片段（`span.getClientRects()`）|第 1 行 `1310 → 1396`（光标列 → 右缘）、第 2 行 `293 → 716`（第 0 列 → 文本末）——悬挂缩进成立。|
|textarea|与合成视图同宽同高（1119 × 37）、同字体同字号同行高；`scrollHeight === clientHeight`、`scrollWidth === clientWidth`、`scrollLeft/scrollTop = 0`（钉行高之前是 `scrollTop 25 / scrollHeight 74`）。|
|复核视觉（截图）|`> ` 提示行与已输入的 `填…` 完全可见；预编辑从光标列开始、第二行从第 0 列继续，底色只贴在文字上；左栏与终端面板一点没动。|
|提交（`Input.insertText`）|`ime-composing` 摘掉；合成视图隐藏；各层 `scrollLeft` 仍为 0。|
- **单测**：`src/lib/termIme.test.ts`（6 项：挂类 / 四个变量镜像 / 只包一层 span / 结束与失焦摘类 / 连开两次跟新光标列 / 清理与缺依赖）；`src/lib/termViewport.test.ts`（5 项：样式表里的换行、底色 clone、textarea 行高与字体、辅助层宽度、`clip` 祖先）。
- `pnpm check` 全绿（typecheck + lint 0 警告 + **318 项前端单测 / 43 文件** + `e2e:ipc` 70 命令 × 双向一致）。

## 4. 边界（明确不做）

- **不做「只裁剪不换行」**：行尾拼音被裁掉就看不见自己在打什么——换行才是终端的既有语义。
- **不打补丁 / 不 fork xterm**：只用它写在 DOM 上的 inline 值 + 一个挂在 `.xterm` 上的类名。
- **不做逐字样式**（下划线 / 分色 / 灰化未确认段）：预编辑只上底色，字体与终端一致。
- **不做垂直兜底**：光标停在最后一行且拼音超长时，换行后的行会落到面板下方（被 `.xterm` 剪掉）。要彻底解决得让合成视图向上生长或滚动终端，暂不做——行尾（而非末行）是这次的靶子。
- **不动 `html` / `body` 的 `overflow`**：`#root` 的 `clip` 已经堵住祖先链上那个可滚动容器，缩面更小。
