# ompMiniDesktop 二十四期（V24）：omp 运行时更新（检查 + 直接更新）

> 目标：壳里能看到 **omp 自己**有没有新版本，也能**直接更新**——左栏字标行右端一枚版本 chip
> （当前版本 + 检查结论 + 更新进度），点开是详情弹窗：当前 / 最新 / 渠道 / 上次检查 + 升级方式，
> 有新版本时可一键更新（流式日志 + 可取消 + 失败可重试）。
> 上游口径全部实测（omp 18.3.5，2026-09-28），实测方法与结论见 §1。
> 这是 V11 以来「本应用更新」（Tauri updater）之外的**第二条更新链路**：那条管壳自己，这条管壳里
> 跑的 omp 运行时（`omp 18.x`）。两条链路互不相干，状态也分开存（`update` / `ompUpdate`）。

## 0. 结论先行

- **两条上游命令**：`omp update --check`（只检查）与 `omp update`（真安装）。壳侧只调这两条、
  不自己拼安装命令——`omp update` 会先识别安装方式（brew / npm / bun / mise / nix / 独立二进制）
  再选路，这是唯一能覆盖全部安装方式的写法。
- **入口放在左栏字标行右端**（红绿灯下方那一行的 `ompMiniDesktop` 字标右边）——用户指定的落点。
  它是拖拽区里的 `<button>`：Tauri 的 drag-region 只在**直接落点**上生效、可点元素会把拖拽拦下来
  （`tauri-2.11.5/src/window/scripts/drag.js` 的 `isClickableElement`），所以点 chip 不会误拖窗口。
- **四种检查状态**（颜色沿用终端 π 的语义；颜色不是唯一信号——完整文案在 `title` / `aria-label` /
  弹窗里）：

  | 状态 | chip 内容 | 圆点 | 悬停提示（也是 aria-label） |
  |---|---|---|---|
  | 检查中 | 当前版本 + 转轮 | 转轮（`Loader`） | 「正在检查 omp 更新…」 |
  | 有新版本 | **新版本号** | `accent` | 「omp 有新版本：18.3.5 → 18.4.2 · 点击查看」 |
  | 已是最新 | 当前版本 | `ok` | 「omp 18.3.5（stable）已是最新 · 点击查看」 |
  | 检查失败 | 当前版本 | `warn` | 「检查 omp 更新失败 · 点击查看」 |
  | 还没查过 | 当前版本 | `faint` | 「检查 omp 更新」 |
  | **更新中** | 当前版本 + 转轮 | 转轮 | 「正在更新 omp…」 |

- **直接更新**（新增）：弹窗里的主按钮「立即更新」→ 二次确认 → `omp update` 跑起来，
  日志**流式**进弹窗的日志区，可以「取消更新」；成功刷新健康 + 重查版本（chip 立刻变成
  「已是最新 + 新版本号」），失败 / 取消保留日志与原因、按钮变「再次更新」。
  **关掉弹窗不会中断更新**（任务在后端继续，chip 转圈提示；重新打开还能看日志）。
- **失败不打扰**：检查失败只落状态（warn 点 + 弹窗里的原因原文），更新失败只落在弹窗里，
  不弹系统级错误、不打断任何操作。原因用上游输出原文（不翻译），排查提示由界面按当前语言给。
- **单飞 + 静默冷却**：检查同一时刻只有一个在飞（手动与静默共用），静默路径 5 分钟内不重复；
  更新有前端闸门 + 后端**全局单槽**兜底（并发更新返回 BUSY）——一台机器只有一份 omp 安装。
- **检查与更新的数据源**：`omp update` 查的是 **npm registry 的 `dist-tags`**（本机 =
  `~/.npmrc` 里的 `registry.npmmirror.com`），不是 GitHub releases。实测成功 0.27s，冷/慢网络可到
  30s（上游自己的超时），所以检查给 30s 硬超时、更新给 15 分钟硬超时（上游给自己下载二进制也是
  15 分钟上限）。
- 后端两个模块件：检查命令 `check_omp_update` + 更新命令 `start_omp_update` / `cancel_omp_update`
  （`src-tauri/src/omp_update.rs`），前端数据层 `src/lib/ompUpdate.ts`（纯函数都有单测），
  界面两块：`OmpUpdateChip`（左栏字标行）、`OmpUpdateDialog`（`DialogShell` 壳）。

## 1. 上游实测（omp 18.3.5，2026-09-28）

### 1.1 检查：`omp update --check`

```
$ omp update --check
Current version: 18.3.5
New version available: 18.4.2          # 有新版本
$ echo $?                              # 0

$ omp update --check
Current version: 18.3.5
✔ Already up to date                   # 已是最新（`✔` 是上游的符号，随终端能力变化）
$ echo $?                              # 0
```

- **失败**（网络不可达 / 镜像超时）：退出码 **1**，stdout 仍只有 `Current version:`，
  原因在 **stderr** 一行：`Failed to check for updates: <原因>`。
  实测原文两条：
  - `Failed to check for updates: TypeError: Unable to connect. Is the computer able to access the url?`
  - `Failed to check for updates: Error: Timed out fetching release info for @oh-my-pi/pi-coding-agent from https://registry.npmmirror.com/ (/Users/yanqi/.npmrc) after 30s`
- **canary 档多一行** `Current channel: canary`（stable 不打印渠道行，所以「没有这行」= stable）。
- 非 TTY 下上游不上色；带着 `FORCE_COLOR` 之类环境变量时仍会上色——解析前一律剥 ANSI。

**数据源是 npm registry，不是 GitHub**（反直觉，值得记）：`omp update` 的实现是
`fetchLatestReleaseInfo()` → 按 `.npmrc` / 环境变量解析出的 registry 拉
`@oh-my-pi/pi-coding-agent` 的 `dist-tags.latest`；只有从 npm 拿不到（400/404/405）才回落
`dist-tags` 的常规形状。上游帮助里那句「If GitHub rate-limits release metadata, set GITHUB_TOKEN」
说的是**下载二进制**那条路（独立二进制安装才会走 GitHub releases）。实测耗时 0.27s（镜像快时），
慢/超时按 30s 计。`~/.omp/cache/github-cache.db` 与这条检查**无关**（那是别的功能在用）。

### 1.2 执行：`omp update`

- **自己选路**：`brew` → `brew upgrade`、`mise` → `mise upgrade`、`bun` / `npm` → 包管理器更新、
  独立二进制 → 换二进制（Nix 档直接说明「自己管不了」）。本机实测 `omp` 来自 Homebrew
  （`/opt/homebrew/bin/omp` → `Cellar/omp/18.3.5`），所以壳侧只给一条通用的 `omp update`。
- **它要调外部命令**（brew / npm / mise），所以壳侧 spawn 时必须把 **登录 shell 的 PATH** 传给它
  （`pty::login_path()`；GUI 启动的 .app 只有 launchd 的贫瘠 PATH，缺 `/opt/homebrew/bin`）——
  否则上游会报 `Could not resolve omp binary path in PATH`。
- 没有可预期的上界（下载 / 装包）：bottle ≈ 210MB，**实测本机 2026-09-28 这一趟 `brew upgrade`
  从头到尾 9303s（约 2.5 小时，其中绝大部分是拉 bottle）**——慢网络下这不是「分钟级」。
  所以壳侧的硬超时给足 **六小时**（只是防任务永久占住单槽的最后一根保险；界面上的「取消更新」
  才是真正的逃生口，而且运行中会显示**已用时**，让人知道它是静默下载而不是卡死）。
- **给不给参数**：不给。不替用户选渠道（`--canary` / `--stable` 是用户的决定）、不加 `--force`
  （那会无脑重装）。
- 输出是人读的进度文本（`Updating via brew...` / `Downloading …` / `Restarted omp to use the new
  version` 之类），**没有 `--json`**，所以壳侧只把它当「日志流」展示，不解析进度百分比。

## 2. 设计

### 2.1 三条链路分开，别混

| 链路 | 管什么 | 状态 | 入口 |
|---|---|---|---|
| `UpdateState`（既有） | **本应用**（Tauri updater → GitHub Release `latest.json`） | `store.update` | 左栏「设置」入口小点 + 设置 ›「关于」+ 启动静默 |
| `OmpUpdate` / `OmpUpdateRun`（本期） | **omp 运行时**（`omp update --check` / `omp update`） | `store.ompUpdate` / `store.ompUpdateRun` | 左栏字标行版本 chip + 弹窗 |
| 插件 / 技能 | omp 的扩展 | 各自面板 | 设置页 |

三者互不触发、互不覆盖状态：本应用有更新不该让 chip 变色，omp 有更新也不该点亮设置入口的小点
（那是本应用更新的常驻提醒；omp 的提醒在 chip 自己身上）。

### 2.2 chip 的位置与无障碍

- 字标行 `div[data-tauri-drag-region].flex.h-9` 内：字标 `ompMiniDesktop` 左、chip `ml-auto` 右。
- chip 是 `<button>`：`aria-label` = 完整结论（含版本与状态），`title` 同文案（鼠标悬停）；
  `aria-hidden` 的圆点只是颜色信号，颜色不作唯一信号（状态文字进 `aria-label`）。
- 更新进行中：chip 换成转轮 + 「正在更新 omp…」，点开就是进度（弹窗里有日志）。
- **omp 未找到时 chip 整个不渲染**：那种情况由 `HealthBanner` 说明；这里是版本信息位，不是报错位。

### 2.3 详情弹窗（`DialogShell` 壳）

- **状态行**（任务态优先于检查态）：有新版本（`ArrowUpCircle` accent）/ 已是最新（`CheckCircle` ok）/
  检查失败（`TriangleWarning` warn）/ 检查中（`Loader` 转）/ 更新中（`Loader` 转）/
  更新完成（`CheckCircle` ok）/ 更新失败（`TriangleWarning` warn）/ 已取消（`MinusCircle` 中性）。
- **四行事实**：当前版本 / 最新版本 / 更新渠道 / 上次检查（本地时间）。已是最新时「最新版本」
  显示与当前相同，检查失败时显示「未知」。
- **检查失败块**：上游原因原文（`whitespace-pre-line`，多行照实）+ 本地化排查提示。
- **更新块**（按任务态）：
  - 进行中 → 只有日志区（`role="log"`，mono，`max-h-40`，自动滚底）+ 底部「取消更新」；
  - 成功 → 「已更新到 X。」+ 「已打开的终端仍跑着旧进程，新开的终端用新版本。」；
  - 失败 → 上游输出尾行（`error_text`）+ 「也可在终端里跑一次 omp update 看完整日志，或稍后重试」；
  - 取消 → 「如果安装只做了一半，可再次更新重试。」
- **升级方式块**：`omp update` 命令 + 复制按钮（1.5s 的「已复制」反馈）——给想自己在终端里跑的人。
  更新进行中隐藏（那时候它只会喧宾夺主）。
- **底部按钮**：进行中 = 「取消更新」；否则 =（有新版本 / 上次失败或取消时）「立即更新 / 再次更新」+
  「重新检查」+「关闭」。Esc / 遮罩 / × 都能关（`DialogShell` 自带），**关闭不中断更新**。
- **打开时顺手补一次检查**：结果旧于 10 分钟（或从没查过）就再跑一次——点开这个动作总是想看新结论。

### 2.4 更新的并发与收尾

- **二次确认**：更新是不可逆的机器级动作（换掉全局安装），走 `ConfirmDialog`（与工作区删除同一
  个浮层组件，嵌套在 `DialogShell` 之上——`useDialogFocus` 的 `topDialog()` 栈保证 Esc 只关最上层）。
  文案写清：跑什么命令、影响谁（已开终端不受影响）、能不能取消、关掉弹窗会怎样。
- **单飞**：前端 `updating` 闸门 + 后端全局单槽（重复发起 = `BUSY`）。
- **取消**：`CancelToken` → 读流循环杀子进程 + 打整个进程组（`process_group(0)`，brew / npm 派生
  的子进程一起收掉）。**收口在一条路径上**：命令层只发信号，进程处理在读流循环里。
- **收尾顺序**：先放槽（`release`）再发终局事件——前端收到 canceled / failed 后立刻重试不会撞 BUSY。
- **成功后**：前端重拉健康（`get_health` 重新解析 omp 路径与版本）+ 重查一次；新版本号回填进
  `ompUpdateRun.to`，弹窗显示「已更新到 X」。（`lib/ompUpdate.ts` 直接用 `api.getHealth()` 而不是
  `lib/ompDiag.ts` 的 `refreshOmpHealth`——后者反向依赖本模块，会成环。）
- **进程退出**：`RunEvent::Exit` 里 `kill_update`（放槽 + 发取消信号；子进程由 `kill_on_drop` 收掉）。

## 3. 实现清单

**后端**（`src-tauri/src/omp_update.rs`；`main.rs` 注册 `check_omp_update` / `start_omp_update` /
`cancel_omp_update`；`AppState.omp_update_task` 是那个全局单槽）：

- `parse_check_output(stdout, stderr, code)`（纯函数，单测锁着）：退出码非 0 → `Err(stderr 首行，
  剥掉 "Failed to check for updates: " 前缀)`；退出码 0 但没有新版本行、没有 `Already up to date`、
  也解析不到当前版本 → `Err("输出无法解析")`（**不把空输出说成「已是最新」**）；
  渠道 = 出现 `Current channel: canary` 即 canary，否则 stable。解析前剥 ANSI
  （复用 `git_commit::strip_ansi`，不再造第二份）。
- `classify_update(signals)`（纯函数）：取消优先，其次退出码 0 = Done，其余 Failed + 输出尾行摘要
  （复用 `git_commit::RunSignals::error_text`）。
- 检查命令：钉 agentDir（渠道是配置键，从项目目录跑会读到项目覆盖值），超时 30s，错误不带 hint
  （界面给本地化提示，避免双语混排）。
- 更新：`spawn_update`（新进程组 / 登录 PATH / 两路管道 / `kill_on_drop`）+
  `run_update`（复用 `git_commit::pump_child` 读流）+ `probe_version`（更新前后各探一次
  `omp --version`）。命令**立刻返回**，过程与终局走 Channel（`line` / `exit`）；起不来的错误也走
  `exit`，前端只有一个展示路径。
- 单测：检查解析 6 条 + **假 omp 脚本**驱动的执行路径 3 条（成功流式 / 失败尾行摘要 / 取消杀进程组，
  实测取消后 10s 内返回）+ `--ignored` 真实检查 1 条（联网查 registry，只检查不安装）。

**前端**：

| 文件 | 职责 |
|---|---|
| `src/lib/ompUpdate.ts` | 数据层：`deriveOmpUpdate` / `deriveOmpUpdateError` / `shouldCheckSilently` / `appendOmpUpdateLine` / `reduceOmpUpdateRun`（纯函数，有单测）+ `checkOmpUpdate`（单飞）/ `autoCheckOmpUpdate`（冷却）/ `openOmpUpdateDialog`（打开 + 旧则重查）/ `startOmpUpdate` / `cancelOmpUpdate` |
| `src/components/sidebar/OmpUpdateChip.tsx` | 左栏字标行的版本 chip（六态渲染 + 点击开弹窗） |
| `src/components/update/OmpUpdateDialog.tsx` | 详情弹窗（状态行 / 四行事实 / 失败块 / 更新块 + 日志区 / 升级方式 / 按钮组 + 二次确认） |
| `src/stores/app.ts` | `ompUpdate`（检查状态）+ `ompUpdateRun`（更新任务）+ `ompUpdateDialogOpen` |
| `src/app/App.tsx` | 启动：健康检查拿到 omp 路径后静默查一次；挂载弹窗 |
| `src/lib/ompDiag.ts` | 「重新检测 omp」成功后同样静默查一次（走冷却） |

**契约**：`ipc.ts`（3 个命令）/ `api.ts` / `types.ts`（`OmpUpdateStatus` + `OmpUpdate` +
`OmpUpdatePhase` / `OmpUpdateOutcome` / `OmpUpdateEvent` / `OmpUpdateRun`）/
`scripts/e2e-ipc-selfcheck.mjs`（rsFiles 清单含 `omp_update.rs`）同步，`pnpm e2e:ipc` 双向核对（69 命令）。

## 4. 边界（本期不做）

- **不替上游选路 / 选渠道**：不自己拼 `brew upgrade` / `npm install -g`，也不传 `--canary` /
  `--stable` / `--force`——那是用户与上游的事。
- **不做安装预览**：没有「将要执行什么」的 dry-run（上游没有这个能力）。
- **不留历史**：只有「上一次检查」的时间与结论 + 本次运行的任务记录，重建应用后清空；
  不做更新历史 / CHANGELOG 视图。
- **不代管定时器**：没有后台轮询与定时检查——只有启动 / 重新检测 / 手动点这三条路径。
- **不改 omp 的任何配置**：不写 `update.channel`、不写 config.yml、不动 registry 缓存。
- **不做回滚**：更新后想退版本得自己用包管理器退（壳侧不提供「降级」按钮）。

## 5. 完成口径（验证记录，2026-09-28）

- `pnpm check`：typecheck + eslint（0 警告）+ vitest 289 项 + `e2e:ipc` 69 命令双向一致 —— 全过。
- `cargo test --manifest-path src-tauri/Cargo.toml`：131 + 165 项通过（含 `omp_update` 的 6 条解析
  单测与 3 条假 omp 执行路径测试：成功流式 / 失败尾行 / 取消杀进程组）。
- `cargo test … omp_update -- --ignored --nocapture`（真实 omp，联网）：**成功路径**实测
  `当前 18.3.5 → 最新 18.4.2`（0.27s）；另一次同命令在镜像超时时走**失败分支**
  （`Failed to check for updates: … after 30s`），两条路径都被断言覆盖。
- 界面核对（vite dev server + 浏览器注入 `__TAURI_INTERNALS__` mock，含 **Channel 帧协议**；
  注意 `Channel.toJSON()` 返回的是字符串 `"__CHANNEL__:<id>"`，mock 要按这个形状取回调 id）：
  - 启动即静默查一次 → chip 显示新版本号 + accent 点；
  - 点 chip → 弹窗四行事实 + 升级方式块（中英逐条对过）；
  - 「立即更新」→ 二次确认（标题带目标版本）→ 进行中：状态「正在更新 omp…」、日志区逐行到达、
    底部只剩「取消更新」、chip 转圈且悬停提示为「正在更新 omp…」；
  - 完成：状态「更新完成」、绿块「已更新到 18.4.2。」+ 终端提示、chip 变
    「omp 18.4.2（stable）已是最新」（走完健康刷新 + 重查）、主按钮消失；
  - 失败：状态「更新失败」、上游报错原文 + 提示、日志保留、按钮变「再次更新」；
  - 取消：状态「已取消更新」+ 说明、日志保留；
  - 关闭弹窗后 chip 仍转圈（更新在后端继续），重新打开还能看到日志与结果。
- 真实升级（本机，2026-09-28）：`omp update` 实测走 Homebrew，`brew upgrade can1357/tap/omp`
  18.3.5 → 18.4.2 **跑完**（全程 9303s，其中绝大部分是拉 210MB 的 bottle）；之后
  `omp --version` = `omp/18.4.2`、`omp update --check` = `Current version: 18.4.2` +
  `✔ Already up to date`。壳侧随之把硬超时从 15 分钟提到**六小时**（见 §6），并加了运行中的
  「已用时」读数与确认文案里的体量提示。**这次运行就是「检查 → 更新 → 完成 → 再检查已是最新」
  这条真实链路的端到端验收**（壳内点击走的是同一条命令、同一套进程与超时口径）。
- 弹窗排版修了两处实测问题：`dt` 列宽 80px 在英文下把「Last checked」折成两行（改 96px +
  `whitespace-nowrap`）；上游错误与后端 hint 双语混排（去掉后端 hint，提示由界面统一给）。

## 6. 已知风险与取舍

- **检查依赖网络**：镜像不稳时 chip 会停在 warn 态，弹窗里给出上游原因；这是「如实展示」，
  不做重试与降级（不想把一次网络抖动伪装成「已是最新」）。
- **更新中途取消**：包管理器可能留下半装状态（brew 的 partial download 会留在缓存里、可续传；
  `npm` 可能留下半装的全局包）——界面上照实提示「可再次更新重试」，壳侧不做清理。
- **升级在慢网络下是小时级的**：本机实测（2026-09-28）`omp update` 走 Homebrew，
  `brew upgrade can1357/tap/omp` 从 18.3.5 到 18.4.2 **全程 9303s（约 2.5 小时）**——第一次带着
  15 分钟硬超时的真实运行就是在下载阶段被壳侧掐掉的（brew 缓存留下 `.incomplete` 分片，可续传；
  omp 本身没被动过），第二次不限时跑到底：`omp/18.4.2` + `✔ Already up to date`。
  据此把硬超时改成**六小时**，并在确认文案里写明「约 210MB / 慢网络要等 / 可随时取消」、
  运行中显示**已用时**（非 TTY 下 brew 的下载没有进度条，静默期需要这个读数）。
  这条路要调 `brew`：spawn 时必须给登录 shell 的 PATH（见 §1.2）。
- **`Already up to date` 是英文硬编码匹配**：上游改文案会让解析落到「输出无法解析」分支
  （报检查失败而不是谎报已是最新）。`--ignored` 的真实检查测试会在上游改口径时先炸出来。
- **版本号是字符串比较**：壳侧不比较版本，只转述上游结论（谁新谁旧由 `omp` 判断，壳侧不猜）。
- **手动指定路径钉的是那一份二进制**：设置 ›「关于」里指定过的 omp 路径优先于登录 shell 的 PATH；
  若指到 `Cellar/omp/<版本>/bin/omp` 这种带版本号的路径，Homebrew 升级后旧 Cellar 目录通常还在
  （`brew cleanup` 之前），chip 会继续显示旧版本——这是「用户指定了哪一份」的语义，不是 bug。
- **chip 宽度**：`max-w-[86px]` + 截断，canary 长版本号（如 `18.4.2-canary.1`）也放得下；
  左栏最小宽 292px 时字标 + chip 不挤压（实测英文界面最宽组合仍有余量）。
