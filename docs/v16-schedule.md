# ompMiniDesktop 十六期（V16）：终端 nerd 图标字体 + 设置 ›「图标符号集」——设计稿

> 基线：V15 已交付（供应商用量）。本文只排 V16；实现落地后同步 `AGENTS.md`、`CHANGELOG.md`、`MASTER.md`、`THIRD-PARTY-NOTICES.md`。
> 用户口径：「一个新的 omp 任务，会出现：Tip: Please use nerdfont 😭.」

## 0. 结论先行

| 问题 | 结论 |
|---|---|
| 这条提示从哪来？ | **omp 上游行为**，不是壳的 bug。二进制里 `get tip()`：`getSymbolPreset() === "unicode" && Math.random() < 0.1` 时返回 `"Please use nerdfont 😭."`（否则从 `tips.txt` 里抽取正常提示）；显示在欢迎头底部的 ` Tip: … ` 行，**每个新会话 10% 概率**。 |
| 为什么此前在壳里「跟不了」？ | 壳的 xterm 字体栈里没有任何 Nerd Font、设置页也没有 `symbolPreset` 入口——用户即便切到 nerd 档，PUA 图标码点也没有字体可渲染（系统字体不含），只会得到豆腐块。而「过滤掉这条提示」违反 V11 的根本约定（壳侧不解析、不翻译终端字节流），不做。 |
| 怎么解决？ | **壳内嵌一枚单宽图标字体**（Nerd Fonts Symbols Only 派生，横向压到 0.6 em = 1 个终端 cell），挂在 `--font-mono` 末尾只补图标码点；设置 › 通用 ›「交互与显示」新增「图标符号集」（`symbolPreset` 三档），切到 nerd 后图标开箱即用、该提示不再出现。 |

## 1. 上游事实（omp 18.2.6，Homebrew 安装；二进制内字符串与行为实测）

**① 「Please use nerdfont」提示的完整条件**（`/opt/homebrew/Cellar/omp/18.2.6/bin/omp` 里 JS bundle 原文）：

```js
get tip() {
  this.#o ??= Math.random();
  this.#n ??= Math.random();
  if (b.getSymbolPreset() === "unicode" && this.#o < 0.1) {
    return "Please use nerdfont \uD83D\uDE2D.";
  }
  return iht(yna, this.#n) || undefined;   // tips.txt 抽取
}
```

- `#o` 是 welcome 头实例级随机数 → **每个新会话各掷一次**，10% 命中；
- 非 `unicode` 档（nerd / ascii）永不出现这条；
- 真实 PTY 复现：欢迎头底部 ` Tip: … ` 行（同一位置平时显示 `orchestrate` 等正常 tip）。

**② `symbolPreset` 的定义**（omp 配置 schema）：

```
symbolPreset = unicode (unicode|nerd|ascii)     # 默认 unicode
# ui 分组 appearance / Theme；label "Symbol Preset"
# description: "Glyph set for icons and symbols (Unicode, Nerd Font, or ASCII)"
# nerd 档选项描述自带 "Requires Nerd Font"
```

- **YAML 路径是顶层键**：`~/.omp/agent/config.yml` 里就是 `symbolPreset: unicode`（`omp config list` 里的人读分组 `[appearance]` 只是 UI 标签，不是路径）；
- 读写走既有设置通道（`omp config get/set symbolPreset`），后端白名单机制零改动。

**③ 没有自动检测、没有环境变量覆盖**：二进制里搜不到任何字体探测（`fc-list` / `system_profiler` / `NSFontManager` / `fontconfig` 全为 0 命中），也没有 `PI_SYMBOLS` / `OMP_SYMBOLS` 之类的 env 开关——档位纯配置驱动，壳侧不代偿。

**④ `--config <overlay.yml>` 的语义**（本版实测）：只影响 **TUI 运行时**的配置合并，`omp config get/list` **不反映**它。用它免改全局配置抓 nerd 档输出（overlay 内容就是顶层 `symbolPreset: nerd`）；`appearance.symbolPreset` 这种点路径结构**不生效**（第一次试验因此误判为「overlay 不生效」）。

## 2. 字体：为什么是 Symbols Only + 横向压缩 0.6

**上游字体**：`NerdFontsSymbolsOnly.zip` 里的 `SymbolsNerdFontMono-Regular.ttf`（v3.5.1，10627 字形；MIT）。`Mono` 在这里只表示「集合内统一宽度」，**不是**终端意义上的单宽——实测（fontTools）：

| 指标 | 实测值 |
|---|---|
| 字形数 | 10627（其中 PUA 图标 10610） |
| advance | **全部 2048/2048 upem = 1 em**（无零宽、无 2 倍宽） |
| Menlo 13px 的字符宽（浏览器实测） | `'W'` = 7.828125px（= 0.6022 em） |
| 未压缩图标在 13px 下的渲染宽 | **13px = 1.66 cell** |
| 派生后（横向 ×0.6） | advance 1229/2048 = **0.6001 em ≈ 1 cell** |

**为什么必须压缩**：xterm 的 DOM renderer 按 cell 网格排布（`DomRendererRowFactory`：`spacing = width × cellWidth − widthCache.get(chars)`，用 letter-spacing 把每字符 advance 归一到 cell 宽）。未压缩的 1 em 字形虽然 advance 会被归一到 1 cell，但**字形本身仍画 1.66 cell 宽**，会压到右侧相邻字符上。Nerd Fonts 官方的 `Nerd Font Mono` 变体就是「图标压成单宽」的形态（官方口径：非 Mono 版图标约 1.5 个字母宽，Mono 版即单宽）——本版对 Symbols Only 做同款横向压缩，**纵向保持 1 em**（图标与文字同高；等比缩小会让图标明显偏小、偏离官方 Mono 观感——两种候选并排实测过）。

**字体迟到加载的实测**（担心点：xterm 的宽度缓存把 fallback 宽度记死）：用请求拦截把字体请求人为延迟 2.5s，首帧渲染后测量容器宽 86.23px、字体就绪后 86.14px（差 0.09px / 11 字符），`letter-spacing` 全程为默认值——**没有**出现「缓存错误宽度 → 后续字符被压」的路径；谨慎起见仍在 `main.tsx` 启动时预热（一行，避免首次打开终端的短暂空窗）。

## 3. 设计

### 3.1 字体接入

```
public/fonts/omp-nerd-icons.woff2     ← 派生产物（进仓库，构建期不需要 Python）
scripts/build-nerd-icons-font.py      ← 唯一生成入口（fontTools + brotli）
  index.css @font-face "OMP Nerd Icons"（font-display: block）
  index.css --font-mono = "JetBrains Mono", "SF Mono", Menlo, "OMP Nerd Icons", monospace
  main.tsx 启动预热 document.fonts.load
```

- **排在系统字体之后**：ASCII / 中文仍走系统字体，只有图标码点（PUA）落到它——不改现有观感；
- `font-display: block` 而非 `swap`：字体未就绪时宁可不画（回退字形要么是豆腐、要么宽度不对，终端是固定网格）；
- 派生字体的 name 表改名 `OMP Nerd Icons`（copyright / license 字段原样保留；MIT 允许修改与再分发，图标集许可见 `THIRD-PARTY-NOTICES.md`）。

### 3.2 设置入口

设置 › 通用 的 `ompSettings.ts` 白名单新增 `symbolPreset`（`interaction` 组末位）——**外观键里唯一进白名单的一项**，理由：图标形态不只由 omp 决定，能不能渲染由壳决定（字体是壳内嵌的），它是一个壳相关的显示设置。下拉三档走字典（`svSymbolsUnicode` / `svSymbolsNerd` / `svSymbolsAscii`），上游英文 description 照旧挂 `title`。

生效口径与其它设置一致：**新起的会话**读到新值；已打开的会话不热读外部配置（上游为进程内快照），壳侧不代偿。

## 4. 实现

| 层 | 文件 | 内容 |
|---|---|---|
| 字体 | `public/fonts/omp-nerd-icons.woff2`（新） | Symbols Only 派生：轮廓与 advance 横向 ×0.6、composite 先分解再缩放、head/hhea/OS-2 极值重算、name 表改名；1176 KB |
| 脚本 | `scripts/build-nerd-icons-font.py`（新） | 从上游 ttf 复现整个派生（用法与理由写在文件头；`pip install fonttools brotli`，只在重新生成时需要） |
| 样式 | `src/index.css` | `@font-face` 声明 + `--font-mono` 末尾挂 "OMP Nerd Icons"（注释写明来源与 block 的理由） |
| 启动 | `src/main.tsx` | 预热字体（`document.fonts.load('13px "OMP Nerd Icons"')`，失败静默） |
| 设置 | `src/lib/ompSettings.ts` + `src/lib/locale.ts` | 白名单加 `symbolPreset`（interaction 组）+ 中英 label 与三个选项文案 |
| 文档 | `THIRD-PARTY-NOTICES.md` / `design-system/MASTER.md` / `AGENTS.md` / `CHANGELOG.md` | 字体资源与图标集许可清单、等宽栈口径、导航与变更记录 |

壳侧**零 IPC / 零后端改动**：设置读写走既有 `get_omp_settings` / `set_omp_setting`。

## 5. 完成口径与验证

- `pnpm check` 全绿（166 单测 + `e2e:ipc` 50 命令双向一致）；`pnpm build` 通过（`dist/fonts/omp-nerd-icons.woff2` 随包，1.2 MB）。
- **字体度量**（fontTools 实测）：上游 10627 字形全 2048/2048 upem（1 em）→ 派生后 advance 1229/2048 = 0.6001 em；浏览器实测 Menlo 13px 的 cell 宽 7.828125px（0.6022 em）。
- **真实 TUI 重放**：真实 PTY 抓 omp 两种档位的输出（100×30；nerd 档用 `--config` overlay 注入顶层 `symbolPreset: nerd`，**不改全局配置**）→ 在带最终字体栈（`"JetBrains Mono", "SF Mono", Menlo, "OMP Nerd Icons", monospace`）的 xterm 里重放：nerd 档每个图标 span 宽 **7.83px = 恰好 1 cell**、`letter-spacing` 全为默认（xterm 无需校正），连排 span 宽 = 字符数 × 7.83（227.44/29、47.05/6）——无重叠、无错位；截图核对两种档位的状态栏与欢迎头。
- **字体迟到加载**：请求拦截把字体请求人为延迟 2.5s，首帧测量宽 86.23px、就绪后 86.14px（差 0.09px / 11 字符），`letter-spacing` 全程默认——没有「宽度缓存记错 → 后续字符被压」的路径；仍在 `main.tsx` 预热（一行，失败静默）。
- **设置页核对**（静态构建 + CDP 注入 `__TAURI_INTERNALS__` mock，中英双语）：行渲染「图标符号集 / Icon symbol set」+ 上游 description 挂 `title`；三档文案正确；切到「Nerd Font 图标」→ 写回 `{ key: "symbolPreset", value: "nerd" }` 并回读显示 `nerd`；`--font-mono` 计算值含 `"OMP Nerd Icons"`，`document.fonts.check` 为 true（预热生效）。
- **核对方法的坑（本版踩到）**：omp 的 browser runtime 里 `page.evaluate` 跑在 **isolated world**——在那里写的 `window.__TAURI_INTERNALS__` 对 main world 的应用不可见（应用仍报 `Cannot read properties of undefined (reading 'invoke')`）。mock 必须用 CDP `Runtime.evaluate` / `Page.addScriptToEvaluateOnNewDocument`（默认 main world）注入，断言也在 main world 做；另外 mock 的 `get_health` 必须给全 `omp.errors`（SettingsPage 读 `health?.omp.errors.length`，缺字段会白屏——这是 mock 数据问题，不是壳缺陷）。

## 6. 未覆盖

- 真机 WebView（`pnpm tauri:dev`）未实测——同一环境权限限制（见 README 排障）；字体本地加载，WKWebView 与 Chromium 的 @font-face 行为一致，风险低；
- 未做字体子集化（保留全部 10627 个图标字形）：终端里跑的不止 omp，用户的 shell 提示符 / 其它 TUI 工具同样会用 nerd 图标，子集化会牺牲通用性；
- 屏幕字体细调（终端字体族 / 字号设置）不在本版：V11 口径里没有该入口。
