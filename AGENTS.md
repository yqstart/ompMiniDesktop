# ompMiniDesktop 工程导航

oh-my-pi（`omp`）的极简桌面端：**左侧项目 / 分支树，右侧 omp 终端标签页**——每个终端就是一个 omp 会话。
Tauri v2 + React + TS + Tailwind v4 + Zustand，包管理 pnpm。

> **形态变更史（V11，2026-09-17 起）**：app 从「聊天界面壳」（RPC 流式渲染）颠覆性改为「终端工作区壳」。
> 聊天渲染、RPC 驱动、审批卡、输入框等全部退场——那些职责回到 omp 自己的 TUI。
> V1–V10 的文档（`docs/v1-design.md`、`docs/v2..v10-schedule.md`、`docs/rpc-memo.md`）是**历史存档**，
> 描述的是旧形态；现行口径以 `docs/v11-schedule.md` 为准。

## 文档索引

|文档|路径|说明|
|---|---|---|
|终端工作区（现行）|`docs/v11-schedule.md`|冻结设计稿 + 上游实测口径 + 完成口径（**改代码前先读这份**）|
|产品冻结稿（历史）|`docs/v1-design.md`|V1 聊天界面的设计（形态已被 V11 取代，仅作历史参考）|
|RPC 实测备忘（历史）|`docs/rpc-memo.md`|`omp --mode rpc` 协议的实测结论（V11 起壳侧不再驱动 RPC；留存给未来需要协议能力的场景）|
|功能排期（历史）|`docs/v2..v10-schedule.md`|各期明细与实测数据（设置页各页签的沿革在这批文档里）|
|自定义模型与添加供应商（现行）|`docs/v12-schedule.md`|`models.yml` 可视化 + 合并式「添加供应商」面板（V12c）的上游实测、实现与完成口径（**改这块前先读**）|
|快速切换环（现行）|`docs/v13-schedule.md`|`cycleOrder`（omp 终端 Ctrl+P 的轮换序）可视化的上游实测、实现与完成口径|
|git 工作流（现行）|`docs/v19-schedule.md`|提交 / 推送 / 提交信息的重构（V19）：壳侧快路径（一次 `omp -p`）+ 可选的完整轨（`omp commit`，含 CHANGELOG）、文件勾选、一键提交并推送——**改 git 这块前先读**（worktree 生命周期已由 V20 移除）|
|左栏精简（现行）|`docs/v20-schedule.md`|去 worktree 管理入口（新建 / 删除 / 清理退场，worktree 只读展示）、项目行「移除项目」、活动项目文件夹标识（V20）——**改左栏前先读**|
|工作区提交并推送（历史）|`docs/v14-schedule.md`|V14 的 `omp commit` 两段式封装（形态已被 V19 取代，仅作历史参考）|
|供应商用量（现行）|`docs/v15-schedule.md`|设置 ›「供应商用量」（`omp usage --json` 的滚动窗口：5 小时 / 每周 / 每月）的上游实测、设计与完成口径（含「能否自定义配置取用量」的结论）|
|终端图标字体（现行）|`docs/v16-schedule.md`|终端 nerd 图标：内嵌单宽图标字体（Nerd Fonts Symbols Only 派生）+ 设置 ›「图标符号集」（`symbolPreset`）的上游实测、设计与完成口径|
|会话标题与改名 / 批量归档 / git 快照刷新 / 内存实测（现行）|`docs/v17-schedule.md`|终端标签用会话标题（识别 omp 的 cwd 回退名）+ 双击改名（`/rename` 注入）、会话弹窗批量归档 / 删除、git 快照刷新时机（窗口 focus + 30s 兜底轮询）与三终端内存实测结论|
|终端标签单行 / 会话标题语言（现行）|`docs/v18-schedule.md`|标签去掉 cwd 第二行（只留会话标题）+ 标题语言随界面语言（写 `<agentDir>/TITLE_SYSTEM.md`，含 omp 18.2.10 三组 PTY 实测与 Pi 时代遗留配置失效的结论）|
|设置页加载性能（现行）|`docs/v20-schedule.md`|模型目录（`omp models --json`，实测 2–10s）的单飞 + 5 分钟缓存 + 过期后台刷新（含 `omp-models://catalog` 事件）、config 多键读取合并成一次 `omp config list`、模型页各自到达即渲染——**改设置页数据加载前先读**|
|设计真相|`design-system/MASTER.md`|token、布局、交互、组件命名（改 UI 先读）|
|应用图标|`design-system/icon/omp-mini-icon.svg`|π 字标矢量唯一源，`pnpm icon` 重新生成 `src-tauri/icons/`|
|更新日志|`CHANGELOG.md`|Keep a Changelog 风格，发版时归入新版本节|
|第三方声明|`THIRD-PARTY-NOTICES.md`|直接依赖清单，增删依赖时同步|

## 技术基线

- 桌面壳：Tauri v2（`src-tauri/`，identifier `com.omnidesktop.mini`；窗口 `titleBarStyle: Overlay` + `hiddenTitle`，标题栏是自绘的——顶栏与左栏红绿灯占位都挂 `data-tauri-drag-region`，拖动走 `core:window` 的 `start_dragging`。**该权限不在 `core:default` 里**，必须在 `src-tauri/capabilities/default.json` 显式加 `core:window:allow-start-dragging`；macOS 产物签名是 adhoc（`signingIdentity: "-"`），`src-tauri/Info.plist` 只放桌面/文稿/下载三处文件夹用量说明文案，打包时与生成值合并——它不解决 adhoc 下 TCC 授权不持久）
- 前端：React 19 + TS + Vite + Tailwind v4 + Zustand（`src/`）+ `@xterm/xterm` 6（终端模拟器，DOM renderer）
- 后端：Rust + tokio + serde/serde_json + **`portable-pty`**（PTY 进程管理）+ **`reqwest`**（供应商用量的补充探针，rustls/webpki-roots）+ tauri-plugin（dialog/opener/process/updater，`main.rs` 实注册）
- 工具链：Node 22 + pnpm 11；Rust stable（已验证 1.97）+ 本地 `@tauri-apps/cli`（`pnpm tauri:*` 走项目本地 CLI）
- 上游运行时：`omp` 18.x（已验证 18.2.2），不随仓库分发，用户另行安装

## 源码结构（V11 现行）

```
src/
  app/App.tsx              # 顶层装配：左栏（可拖宽/窄窗抽屉）+ 标签栏（终端 + 设置）+ 面板区 + 终端关闭确认 + 全局快捷键（⌘T/⌘W/⌘1..9）
  components/health…       # HealthBanner（omp 不可用横幅）
  components/SettingsPage.tsx        # 设置页外壳（左栏竖向菜单两组：omp = 常用设置 / 模型 / 记忆 / 供应商用量；本应用 = 关于 / 使用统计 / 已归档对话 + 右侧内容区）
  components/ArchivedSessions.tsx    # 设置 ›「已归档对话」：恢复（= 取消归档 + 终端 resume）/ 删除，行级与分组级
  components/ConfirmDialog.tsx       # 通用二次确认浮层（跨分组危险操作用它）
  components/LanguageToggle.tsx      # 界面语言三档（跟随系统 / 中 / EN），挂左栏底部「设置」行右侧
  components/ThemeToggle.tsx         # 皮肤三档（跟随系统 / 深色 / 浅色），挂「设置」行右侧
  components/sidebar/
    WorkspaceSidebar.tsx   # 左栏：添加项目 + 项目列表 + 底部「设置/语言/皮肤」行（更新小点在设置入口上）
    ProjectGroup.tsx       # 项目组：折叠头（会话入口 / 移除项目，文件夹图标标活动项目）+ 工作区行（worktree 只读展示）
    SessionPopup.tsx       # 项目会话弹窗：会话搜索 + 全部归档 / 全部删除（作用于当前过滤结果）+ resume 到终端
  components/terminal/
    TerminalView.tsx       # 终端面板区：全部终端面板（隐藏不销毁）+ 当前工作区空态（标签栏与关闭确认归 App）
    TerminalTabs.tsx       # 标签栏（常驻）：当前工作区的终端标签（π 状态标 + 会话标题 + 关闭；双击改名）+ 设置标签（单例）+ ＋
    TerminalPane.tsx       # 单个终端：xterm 实例 + PTY 管道（Channel）+ fit/resize + 退出浮层（重启/关闭）
  components/settings/     # GeneralSettingsPanel（常用设置）/ ModelsPanel（模型页壳：我的模型 / 供应商 / 角色 / 快速切换环 / 转移）/ CycleOrderSection（快速切换环：Ctrl+P 轮换序）/ ProvidersSection（供应商合并区块：已添加列表 + 两个弹窗）/ ProviderPicker（提供商搜索选择器）/ ProviderModelsDialog（挑选模型弹窗 + 列表）/ CustomProviderEditForm（models.yml 表单）/ DialogShell（设置页模态壳）/ EnumSelect（枚举下拉浮层：设置页的枚举值选择器）/ FallbackChains / ModelPickList / MemoryPanel / UsagePanel（使用统计：tokens 用量 / Cache 命中率 / 活跃天数三张卡，默认「今日」+「Token 活动」热力图：每日 / 每周 / 累计三档、悬停浮层给按模型拆分、底部「少 ▢▢▢▢▢ 多」对照条）/ ProviderUsagePanel（供应商用量：各供应商滚动窗口的进度条 + 重置倒计时 + 无数据 / 停用凭据块；V15）/ StarToggle + Switch（共享小件）
  components/update/       # UpdateDialog（App 常驻挂载，updateDialogOpen 控制；有更新的提醒在左栏设置入口小点）
  components/git/
    CommitTaskPanel.tsx     # 提交 / 推送浮层（V19：轨道切换「快速 / 完整（含 CHANGELOG）」/ 文件勾选 / 可编辑提交信息 / 提交并推送 / 语言三档 + 记住选择 / 完整轨日志）
  lib/                     # 见下
  shared/                  # api（invoke 唯一入口，命令名走 IPC 常量）/ ipc（命令与事件常量的唯一清单）/ types
  stores/app.ts            # Zustand 全局状态（项目/工作区/终端/语言/皮肤/设置页/更新/提交任务）
src-tauri/src/
  main.rs / lib.rs         # 插件注册 + 命令注册（generate_handler 是命令面真相）；RunEvent::Exit 收掉全部 PTY 进程与提交任务
  pty.rs                   # PTY 进程表（portable-pty）+ 读线程 + 增量 UTF-8 解码 + Channel 推送（含真实 PTY 单测）
  commands/mod.rs          # 项目 / 工作区 / 会话列表与归档 / omp 定位 / git_info 命令 + 归属判定（owner_project / ownership_scope）
  session_scan.rs          # agentDir 解析 + jsonl 头解析 + cwd 归组（含单测）
  overlay.rs               # overlay.json 读写与版本归一（含单测）
  git_info.rs              # git 子命令执行 + git 路径探测缓存 + **worktree list 解析**（左栏树与会话归属共用；含单测）
  git_commit.rs            # 提交 / 推送的任务编排（V19）：按 cwd 的任务表 + Channel 事件 + CancelToken 取消 + 子进程泵；`git commit`/`git push` 与完整轨 `omp commit` 的执行器（含单测与真实仓库测试）
  git_ops.rs               # 壳侧 git 写操作（V19）：变更集读取（porcelain -z + numstat）、勾选 → 暂存区同步（含子集复查）、提交 / 推送参数构造（含单测）
  commit_msg.rs            # 提交信息快路径（V19）：一次 `omp -p` 单轮生成——参数序列 / diff 截断 / 提示词 / 输出解析 / 模型角色读取（含单测）
  settings.rs              # 设置 ›「常用设置」后端：`omp config list/set/reset` 三个命令（含单测）
  models_config.rs         # 设置 › 供应商 ›「自定义模型」后端：`<agentDir>/models.yml` 的读 / 写（保真文本由前端给，后端做 hash 乐观锁 + 预校验 + 备份 + 原子写；含单测）
  title_prompt.rs          # 会话标题语言（V18）：按界面语言写 `<agentDir>/TITLE_SYSTEM.md`（omp 的标题生成 prompt；用户自写的同名文件不覆盖，原子写；含单测）
  providers.rs             # 设置 › 供应商 / 模型后端：auth-broker login/logout + modelRoles + cycleOrder + retry.fallbackChains
  memories.rs              # 设置 › 记忆后端：列 / 读 / 删 omp 项目记忆（含单测）
  usage.rs                 # 设置 › 使用统计后端：扫会话 jsonl 聚合 tokens 用量 / Cache 命中率 / 活跃天数 + 53 周热力图窗口（逐日按模型拆分）（只读；含单测）
  provider_usage.rs        # 设置 › 供应商用量后端（V15；从 V11 删除的 quota.rs 恢复并增强）：`omp usage --json` 的解析与命令（只读；含单测与真实 omp 慢测试）
  extra_usage.rs           # 供应商用量的**补充探针**（V15 二轮）：omp 无探针的 commandcode / deepseek 由壳侧补查（API key 经 `omp token` 内存传递、不落盘；reqwest 只读 GET；含单测与真实 commandcode 慢测试）
scripts/                   # e2e-ipc-selfcheck.mjs（IPC 契约双向自检）、generate-icons.mjs、changelog-notes.mjs（从 CHANGELOG 抽某版本的整节说明 → Release 说明与 latest.json 的 notes）、fixup-latest-json.mjs（latest.json 资产 URL → 公开直链 + notes 回填；发版 fixup job 与存量修补共用）、build-nerd-icons-font.py（终端 nerd 图标字体派生 → public/fonts/omp-nerd-icons.woff2，V16）
public/fonts/              # omp-nerd-icons.woff2：内嵌的单宽 Nerd Font 图标字体（V16；生成脚本见上，来源与许可见 THIRD-PARTY-NOTICES.md）
```

`lib/` 明细（V11）：

```
locale.ts        # 全界面中英字典（~300 键）+ 语言偏好三档 + 解析纯函数（含单测）
theme.ts         # 皮肤三档归一 + localStorage + resolveTheme + applyTheme（含单测）
termTheme.ts     # 终端配色：从 CSS `--term-*` 读值喂给 xterm（组件不写死色值）
termTitle.ts     # 终端标签的 π 状态标与展示名：解析 omp 窗口标题 `π <状态> <会话名>` → 状态 + 会话标题；识别 omp 的「会话还没有标题」回退名（cwd 末段目录名不许当标题）、`terminalDisplayName`（title ?? label）（含单测）
termRename.ts    # 会话改名：清洗标题（去控制字符 / 长度上限）→ 只在 π=等待输入时经 PTY 注入 omp 原生命令 `/rename`（先 Ctrl+U 清草稿；壳侧零本地状态）（含单测）
termInput.ts     # macOS WKWebView 漏键补丁（上游 #5374）：只补 xterm 自身去重规则会拒绝、且 keypress 没发的那一次 input（`isDroppedInput` 镜像其 `_inputEvent` 接受条件，与真实 xterm 对拍）；正常按键、IME 组字、读屏一律不动（含单测）
useText.ts       # 组件取文案的唯一入口
useDropdown.ts   # 下拉与共用 useDialogFocus：最上层 Esc、Tab 圈定、焦点恢复、隐藏面板隔离
workspaces.ts    # 工作区逻辑：loadWorkspaces（唯一刷新入口）/ 显示名 / 点工作区开终端 / ＋ 新建 / resume 到终端
terminalScope.ts # 右栏终端范围：terminalsInWorkspace（按左栏选中工作区过滤，null 不过滤）+ 工作区行徽章计数（含单测）
commitTasks.ts   # 提交 / 推送前端编排（V19）：打开面板与变更集 / 勾选与消息编辑 / 生成 / 提交（可选推送）/ 完整轨 / 只推送 / 取消 / 关闭语义 / git 快照刷新时机
commitLang.ts    # 提交信息语言偏好（系统默认 / 中文 / 英文，localStorage 按项目存 → 两轨共用的要求文本；V14 增补、V19 扩展到快路径；含单测）
titlePrompt.ts   # 会话标题语言（V18）：把界面语言同步成 omp 的标题生成 prompt（`<agentDir>/TITLE_SYSTEM.md`，失败静默；判定「谁的文件」在后端）
projects.ts      # 添加项目（pickAndAddProject 唯一实现）
sessions.ts      # 会话按项目分组（归档页用；含单测）
sessionBatch.ts  # 批量归档/恢复/删除的唯一实现（BATCH_LIMIT 200 + 失败聚合）
myModels.ts / modelSelector.ts / modelNames.ts / roleNames.ts / ompSettings.ts  # 设置页数据层（含单测；myModels = 我的模型，模型选择器的候选范围）
customModels.ts  # 自定义模型（models.yml）保真编辑数据层（yaml 包；含单测）
usageHeat.ts     # Token 活动热力图（GitHub 贡献图口径）的纯计算：每日 / 每周 / 累计三档取值与悬停按模型拆分 `heatModels` + 分位分档 + 月份刻度（含单测）
providerUsage.ts # 供应商用量数据层（V15）：模块级快照（useSyncExternalStore）+ 60s 节流 / 单飞 / 失败保留旧值 + 分组 / 告警档 / 相对时间纯函数（含单测）
ompDiag.ts       # omp 自检与手动指定路径
appUpdate.ts     # 应用内更新状态机
```

## 核心数据流（不许违背）

- **终端 = PTY 里的 `omp` TUI（V11 的根）**：每个终端 tab 在后端是一个 `omp --cwd <dir>` 进程跑在 PTY 里（**无 `--mode`** —— 交互式 TUI；`--resume <id>` 可选）。壳侧**不解析、不翻译**终端字节流：Rust 读线程做增量 UTF-8 解码后经 **Tauri Channel** 直推前端 `xterm.write`；键盘走 `pty_write`、尺寸走 `pty_resize`、关闭走 `pty_kill`。**kill 是双保险**：omp 的 TUI 收到 SIGHUP 不退出（实测），终止统一走 **SIGHUP → 1 秒宽限 → SIGKILL 进程组**（`force_kill_group` 打 `-pid`；应用退出路径直接补 SIGKILL）；读线程收尾用带宽限的 `wait_with_grace`，`PtyHandle.seq` 防「同 id 快速重启时旧读线程误删新句柄」。**高频字节流不进 Zustand**——store 只放 tab 元数据（id/cwd/label/title/state/status/exitCode/resume/spawnSeq）。
- **终端环境**：`TERM=xterm-256color`、`COLORTERM=truecolor`；`PATH` 取登录 shell 的一次性探测结果（GUI 启动的 .app 只有 launchd 默认 PATH）。**终端字体 = `--font-mono`**（`TerminalPane` 创建 xterm 时读它）——栈末尾挂内嵌的 "OMP Nerd Icons"（单宽 0.6 em，只补图标码点；omp 的 `symbolPreset: nerd` 图标靠它渲染，V16）：壳内没有别的字体来源，改字体栈就是改终端观感。omp 发 OSC 0/2 标题（`π <状态> <会话名>`：转轮字形 = 工作中、`!` = 等你确认、`>` = 轮到你；`tui.titleState` 默认开）→ `setTerminalTitle` **解析出会话标题与状态**（`lib/termTitle.ts`）——omp 在会话还没有标题时会把 **cwd 末段目录名**当名字发出来（项目名，不是会话标题），壳侧认出来落 `null`、标签退回工作区显示名；标题一到位就顶上。标签上是「π 状态标 + 会话标题」且**只有一行**（V18：不再显示 cwd 第二行——工作目录由左栏选中项与标签栏的工作区过滤表达，完整 cwd 留在标签的悬停提示里；改名失败原因仍临时占名字行下方），**双击标签 = 改名**（`lib/termRename.ts` 注入 omp 原生的 `/rename <title>`，只在 π=等待输入时允许；omp 自己写回会话并广播新标题，壳侧不留本地覆盖）——**π 的颜色即 omp 状态**（working=accent+呼吸 / attention=warn / ready·正常退出=ok / 异常退出·启动失败=danger / 未知=faint），状态文字进 `sr-only` 与 π 的悬停提示（颜色不作唯一信号）。转轮每 80ms 换一帧：**解析放在 store 边界，只有名字或状态真变了才写 store**（别退回「每个标题帧写一次」）。终端配色从 `--term-*`（两套皮肤）运行时读取；`<html class="dark">` 变化时所有 xterm 实例换色（MutationObserver）。
- **fit 只在可见时做**：`display:none` 里量不到尺寸——`ResizeObserver` 与切 tab 的 fit 都用 active 判断挡掉隐藏面板；切到本 tab 时 rAF 后 fit + `pty_resize` + focus。同一 id 快速重启有竞态防护（后端 `PtyHandle.seq` 比对，旧读线程不误删新句柄）。
- **右栏只显示当前工作区的终端**（过滤键 = `activeWorkspacePath`，`cwd` 精确匹配；`lib/terminalScope.ts` 的 `terminalsInWorkspace`）：左栏选中 `login` 就只列 login 目录的终端，别的分支的终端照常跑、只是不在这个视图里（隐藏 = CSS 显隐、不 kill；左栏工作区行的终端数徽章与 `⌘⇧K` 快速切换是它们的入口，跳过去左栏跟着切）。不变式：`activeTerminalId` 要么 null、要么落在该目录里——`openTerminal` / `focusTerminal` 同步过滤键，`closeTerminal` 在同工作区的相邻终端里收敛（同工作区关完 → 空态且选中项不动），`loadWorkspaces` 选中项失效回退时同步收敛；`activeWorkspacePath == null`（一个可用工作区都没有）时不过滤。
- **主区 = 常驻标签栏 + 常驻面板（设置是标签，不是替换）**：`App` 里是 `<TerminalTabs />`（终端标签 + 设置标签 + ＋，只要有任何标签就常驻）+ `<TerminalView visible={!settingsTabActive} />` + `{settingsTabOpen && <SettingsPage visible={settingsTabActive} />}` + 终端关闭确认（`ConfirmDialog`，任意标签下都要弹得出来）。**面板只切显隐、不许条件渲染**——**卸载 `<TerminalView />` 会连带卸载每个 `TerminalPane`，其清理 effect 直接 `pty_kill`**（那是「关闭标签」才该发生的事；实测：卸载终端树 → kill 立即发生）。切到设置标签时 `visible=false` 让面板的 active 判定为假（不量尺寸 / 不推 resize），切回时按「切到本 tab」重新 fit + 聚焦；隐藏期间到达的输出照常进 xterm 缓冲，设置页的页签选择 / 滚动位置也保留（`settingsTabOpen` 置 false 才卸载）。`activeTerminalId` 在切去设置标签时保持不变，作为「上次的终端」。
- **终端 tab 不追踪 session id**：jsonl 的 sessionId 由 TUI 自己创建，壳侧不做运行时绑定（会话列表的「运行中」标记不做——tab 上的 π 状态来自 OSC 标题，不是从 jsonl 推断）；`--resume` 由会话弹窗发起（cwd 用会话原目录）。**改名同理**：壳侧不写 jsonl、不留本地覆盖——注入 omp 原生命令 `/rename <title>`，让 omp 自己改（`title_change`）、自己广播（OSC）。
- **会话标题语言 = 壳的界面语言（V18；`title_prompt.rs` + `lib/titlePrompt.ts`）**：omp 的自动标题 prompt 可用 `TITLE_SYSTEM.md` 覆盖——**项目级 `<cwd>/.omp/TITLE_SYSTEM.md` 优先，其次用户级 `<agentDir>/TITLE_SYSTEM.md`**；上游**没有** CLI / 设置项能改它（`omp --help` 只有 `--no-title`，`omp config list` 只有 `title.refreshOnReplan`），写用户级文件是壳侧唯一路径（继 `models.yml` 之后第二个「无 CLI 入口只能写文件」的例外）。壳在健康检查解析出 `agentDir` 后同步一次、界面语言每变一次再同步：**只在文件不存在或内容恰好是壳的中文 / 英文文本时才写**；用户自写的同名文件一律跳过（`skipped`）永不覆盖，写入是原子写、失败静默。**生效范围 = 该 agentDir 下所有新会话**（不止壳内；项目级文件存在时项目级优先）——omp 只在**会话启动**时读它，所以切语言对**新开的终端**生效、已开会话保持原语言（上游口径，壳侧不代偿）。`~/.omp/agent/pi-session-title.json` + `title-prompt.txt` 是 Pi 时代遗留（omp 18.2.10 二进制 0 命中，不再读），壳侧不碰。实测见 `docs/v18-schedule.md` §1.2。
- **左栏 = 项目 → 工作区（主目录 + git worktree）**：`list_workspaces` 聚合（每个项目一次 `git worktree list --porcelain`；porcelain 第一块是主目录）。**worktree 真相 = git**（手工 `git worktree add` 的也列出）；**V20 起只读展示**：壳侧不创建 / 不删除 worktree（新建走 `omp worktree add`、清理走 `git worktree remove/prune`，都在命令行完成），项目头也不再有 worktree 管理入口；项目头 hover 的「移除项目」= `remove_project`（解绑覆盖层 + 该项目会话标记归档，不删任何文件）走 `ConfirmDialog` 二次确认；项目头的文件夹图标在活动工作区落在本项目（右栏正在显示它的终端）时上 accent 色。点击工作区行：该目录已有终端 → 聚焦最近一个；否则新建。`＋`/`⌘T` 用 `activeWorkspacePath`（无选中时退第一个可用工作区）。行尾状态区的**终端数徽章**（`BrowserTerminal` + 数量，有进程在跑时上 accent）是「别的分支还开着几个」的提示，另有 dirty 点 / ahead（可点推送）/ behind / 上游缺失 / 任务徽章（顺序与口径见 `design-system/MASTER.md` §8）。
- **会话归属扩展到 worktree**：`ownership_scope(projects)` = 项目路径 ∪ 各项目全部 worktree 路径（`git worktree list` 求得）——`list_sessions` / `list_archived_sessions` / `list_memories` 的归属**全部走它**。worktree 里跑的会话（jsonl cwd = worktree 目录）必须归到所属项目，不许掉「未归属」。`owner_project` 仍是唯一判定入口（真实路径前缀匹配、最长优先）。
- **工作区树刷新入口唯一**：`lib/workspaces.ts` 的 `loadWorkspaces()`（拉取 + 落 store + 失效选中项回退）。项目增删 / worktree 创建后都调它（`refreshSidebar`）。
- **提交 / 推送（V19）= 两轨并存**（`docs/v19-schedule.md`）：左栏工作区行 hover 的「提交…」**打开提交面板**（`activeCommitCwd` 单例浮层），面板里先勾选文件（勾选 = 本次提交包含哪些文件；默认 = 已暂存的那批，一个都没暂存则全选）。
  - **快速轨（默认）**：「生成提交信息」→ 壳侧把勾选同步进暂存区（`git_ops::apply_selection`：未选的 `restore --staged`、选的 `add -A -- <paths>`，提交前复查「暂存集合 ⊆ 勾选集合」）→ `git diff --cached` 进提示词 → **一次 `omp -p` 单轮**（`commit_msg.rs`：`--no-session --no-tools --no-lsp --no-extensions --no-rules`，模型与思考档取 `modelRoles.commit`；实测 p50 3.5s）→ 输出流式进编辑框（`delta`）并落定解析结果（`message`）→ 用户过目 / 手改 → 「提交」（`git commit --cleanup=strip -F -`，消息走 stdin）或「提交并推送」（再跑 `git push`）。
  - **完整轨（可选）**：切「完整（含 CHANGELOG）」→ 同样先同步勾选（上游见到非空暂存区就不再 `add -A`，**实测尊重勾选**）→ `omp commit`（AI 信息 + changelog 维护 + 校验器，数十秒）→ 日志流式。推送仍由壳侧 `git push` 完成。
  - **推送**：有上游 `git push`；没有上游自动 `git push -u <remote> <branch>`（优先 origin，唯一 remote 也行，多个且无 origin 报错不猜）；壳侧 git 子进程带 `GIT_TERMINAL_PROMPT=0`（没有 TTY 就快速失败，凭证问题给「终端里先手动 push 一次」的 hint）。
  - **任务模型**（`git_commit.rs`）：按 **cwd** 建表（不同工作区并行 = Cursor 式「多个任务一起跑」，同一工作区 BUSY），取消走 `CancelToken`（多步子进程要各自可见）+ 杀当前子进程的进程组，各步有硬超时；应用退出 `kill_all` 收尾。**闭浮层 = 转后台**（行徽章指示：`Loader` 运行中 / `AlertTriangle` 失败，点开面板）。
  - 行徽章的 git 快照（改动点 / ahead 可点推送 / behind 只读 / 上游缺失）与刷新时机（启动 / 任务结束 / 窗口可见或获焦 / 终端 π 转就绪防抖 / 可见时 30s 兜底轮询）**沿用 V14 口径**；点按钮不再走后端预检选路，改由面板的变更集 + 提交前的暂存复查裁决。
- **提交信息语言（V14 增补、V19 扩展到两轨；`lib/commitLang.ts`）**：提交浮层里三档（系统默认 / 中文 / English）+「记住选择（本项目）」——偏好**按项目**（`projectId`）记，同一项目的主目录与全部 worktree 共用；「记住」= 写 localStorage `omp.commitLang.v1`（只落已记住的项目），不记住则只在本次运行的内存态里生效。`lib/commitTasks.ts` 的 `contextArgFor(cwd)` 把该档解析成一段**要求文本**：快速轨拼进提示词（`commit_msg::build_commit_prompt` 的「语言要求：」段），完整轨走 `omp commit --context=`。运行中锁住控件（参数在 spawn 时已定），终态可改、下次任务生效。上游实测（omp 18.2.10）：`--context` 能决定摘要主体与正文的语言（实测 `chore: added a.txt 与 b.txt 文件`），但摘要首词必须是英文过去式动词——完整轨的校验器硬约束；快速轨把「首词英文过去式动词」写进提示词（仓库约定），壳侧不改写模型产物。
- **会话弹窗（项目行 Clock）**：数据 = `list_sessions(projectId)`（归属含 worktree）；行点击 = 新终端 `omp --resume <id>`；归档 / 恢复 = 覆盖层批量命令（单条=数组长度 1）；删除 = `delete_sessions` + ConfirmDialog。**批量不勾选**（V17 增补）：底部常驻「全部归档（N）」「全部删除（N）」，作用于**当前过滤结果**（搜索后就是搜出来的那批）——全部归档只数未归档的那些（无适用项 = 禁用），全部删除覆盖列出的每一行；与单条行内操作共用 `lib/sessionBatch.ts` 的分批与失败聚合。设置 ›「已归档对话」是归档的唯一管理面（不受扫描窗口限制），其「打开」= **恢复（unarchive）+ 终端 resume**（V11 没有只读回放渲染器）。
- **模型目录（`omp models --json`）= 单飞 + 5 分钟缓存 + 过期后台刷新（SWR）**：这条命令实测 **2–10s**（上游每次拉各供应商的目录，抖动大），是「设置页要等好几秒」的根因。壳侧只有**一个读取入口** `commands::load_catalog`（`models_fetch` 单飞锁：同一时刻至多一个进程，其余调用方等同一份结果；阻塞子进程走 `spawn_blocking`）；`get_models`（TTL 命中）/ `refresh_models`（force）/ `get_health` / `list_providers` 全走它。新鲜（<5min）直接命中；**过期的读取方（`catalog_swr`：健康检查 / 供应商页）不等**——拿旧快照 + 起一次后台刷新，完成后广播 **`omp-models://catalog`**（payload = 整份快照）→ `App` 换 `store.models`、供应商页重算「已配置」（判定 = 目录里出现过的 provider，`configured_set`）。只有从未拉过才阻塞等待。**设置页的 config 读取同源**：`modelRoles` / `modelRoleStorage` / `cycleOrder` / `retry.fallbackChains` / `retry.modelFallback` / `retry.fallbackRevertPolicy` 六个键合并成**一次 `omp config list --json`**（`providers::config_values_global`，0.14s 拿全量 500+ 键、值与 `config get` 同构），不再逐键 `config get`；读取统一钉 agentDir（与写入同层）。模型页 / 供应商页的读取**各自到达即渲染**——目录不拖着角色 / 切换环 / 转移链。
- **设置是标签栏里的单例标签**：左栏底部「设置」入口打开 / 聚焦（`openSettingsTab`），标签的 `×` 或 ⌘W 关闭（`closeSettingsTab`，回到上次的终端标签；关闭最后一个终端标签时若设置标签开着则自动切过去）。设置页左栏分**两组**（**omp** = 改 omp 的配置与数据；**本应用** = 本应用自己的信息与设置——组标题在窄导航下收进 sr-only，页内快捷定位 chips 已删、左栏切页是唯一导航），**七个页签**仍是全 app 唯一改 omp 状态的地方（除本应用偏好）：**常用设置**（`omp config` 白名单 **41 项**——V11 把 `tools.approvalMode` 收回本页）/ **模型**（V12b 起为唯一模型管理面；V12c 把「供应商」与「自定义模型」并成**一个区块 + 两个弹窗**：**供应商在最上方** → 我的模型（挑选结果）→ `modelRoles` → **快速切换环（`cycleOrder`）** → `retry.fallbackChains`；「添加供应商」弹窗 = 可搜索的提供商选择器 → API key / OAuth 走 `auth-broker login`，首项「自定义」写 models.yml（自定义表单：**名称可改**——改键保位置与原注释，支持中文（omp 实测无字符集约束，只挡空白与 `/` 等歧义字符）；接口类型只给 `openai-completions` / `anthropic-messages` 两档，既有文件里的其它 `api` 值原样列出保留；**认证只有 API Key**，留空 = `auth: none`）；「挑选模型」弹窗 = 该供应商的模型星标；平铺的「可用模型」目录已删除；**从终端标签切回设置标签会重读 omp 的角色 / 转移链**——omp TUI 里改完即识别，模型目录走上面的单飞缓存不额外重拉）/ 记忆（只删不写）/ **供应商用量**（V15；只读：各供应商的滚动窗口进度 + 重置倒计时 + 无数据供应商 / 停用凭据提示，数据 = `omp usage --json`；omp 未覆盖的 commandcode / deepseek 由**壳侧补充探针**补齐——`extra_usage.rs`，凭据只经 `omp token` 内存传递，查询失败显示「查询失败」而非「无数据」）——以上为 omp 组，以下为本应用组：**关于**（本应用的更新 + omp 运行环境诊断：路径 / 版本 / agentDir 的展示与复制、重新检测、手动指定可执行文件）/ 使用统计（只读；tokens 用量 / Cache 命中率 / 活跃天数三张卡 +「Token 活动」热力图，默认「今日」）/ 已归档对话（覆盖层 + 删文件）。读写口径与实测结论见 `docs/v8-schedule.md` / `docs/v9-schedule.md` / `docs/v15-schedule.md`（仍然有效）。
- **「我的模型」= 模型选择器的候选范围**（V12b；`lib/myModels.ts`，localStorage 键沿用 `omp.favoriteModels.v1`）：我挑过的 selector 非空时，`candidateModels` 让模型角色 / 失败转移目标的候选只列这些；空 = 全部可用模型（不挡新人）。**不写 omp 的 `enabledModels`**——实测那才是 omp 侧 TUI `/model` 的白名单（`[]` = 不限制），本应用明确不动它（`docs/v12-schedule.md` §6）。
- **自定义模型（V12；V12c 起入口在「供应商」区块的添加面板里，选择器首项「自定义」）直接写 `<agentDir>/models.yml`**——omp 没有 CLI 写入口（`omp models` 只有 ls / find / refresh，`omp config` 只管 `config.yml`），写文件是唯一路径；这是壳侧唯一直接写 omp 配置文件的例外。前端 `lib/customModels.ts`（`yaml` 包）做**保真编辑**：只改被编辑的节点，注释 / 格式 / 界面之外的字段（`headers` / `compat` / `modelOverrides` / `cost`…）原样保留；**覆盖型块（无 `models` 的覆盖字段块）界面只读**。后端 `models_config.rs` 四道闸：hash 乐观锁（外部改过即拒写）→ 预校验（临时 agentDir 跑一次 `omp models` 读 stderr，坏配置**不落盘**）→ 备份（`$APPDATA/omp-mini/backups/`，保留 10 份）→ 原子写。文件发现规则与 schema 细节见 `docs/v12-schedule.md`。
- **模型编辑安全**：编辑表单固定读取时的文本/hash，模型条目按 `originalIndex` 复用原 YAML 节点（改模型 id 仍保留 cost 等隐藏字段）；新建/改名撞供应商、重复模型 id、异常结构及覆盖型块均拒写。保存期间禁用表单且不允许误关；预校验后再次检查文件内容与生效路径。YAML 序列化保留字段和注释内容，但部分集合行尾注释可能换到下一行，不承诺任意输入逐字节不变。
- **模型候选不等于模型能力目录**：角色与转移目标只从「我的模型」挑选，但当前模型的思考档始终用完整目录判断。新建转移链不能复用已有键；修改启用开关/回归策略不清空编辑草稿，保存时锁定草稿。角色读取以最新请求为准，旧读请求不得覆盖写回结果。
- **快速切换环（V13；`cycleOrder`）**：模型页「模型角色」下方的独立区块，管 omp 终端 Ctrl+P / Shift+Ctrl+P 的轮换序——条目是**角色 id**（不是模型 selector，也不是全部角色），顺序即轮换顺序；环内角色按 `modelRoles` 解析模型，未配置模型 / 无可用凭证的会被 omp 直接跳过。写入是**整组覆盖写**（array 键直接 `omp config set cycleOrder`，空数组 = 清空环；与 `set_model_role` 共用 `roles_edit` 锁防两次并发写互相覆盖）；交互与角色行同款——每次增删 / 移动立即写回 + 回读。**生效范围**：写入对**新起**的 omp 终端生效；已打开的会话不热读外部配置改动（settings 为进程内快照，重开终端即可——上游行为，壳侧不代偿）。见 `docs/v13-schedule.md`。
- **IPC 错误归一**：`shared/api.ts` 的 `call` 将 Rust `CmdError.message/hint` 与字符串错误转成带原始 cause 的 `Error`；PTY spawn 同样通过该入口。回归在 `shared/api.test.ts`，组件不各自猜错误形状。
- **登录会话隔离**：`providers.rs` 每次 spawn 分配内部序号；状态更新、事件发送与清槽只接受对应会话，不能仅按 provider id 判断（同一家快速重开也不同）。前端启动中关闭等待启动结果后取消，错误可见且可重试。
- **覆盖层**（`$APPDATA/omp-mini/overlay.json`）职责不变：项目列表 / 归档标记 / 备注 / `ompPath`。`sessionApproval` 是 V1 遗留字段（读旧文件时保持形状，新写入停止）。

## 前端约定（血泪规则）

- **消息类渲染已全部退场**（Thread / Composer / 审批卡 / 工具行 / 视图归一 / 图片附件 / @提及 / `/` 补全）——不要在任何新代码里引用这些旧概念。终端里的输出就是终端，不做结构化渲染。
- **左栏选中态**：工作区行 = `bg-active` 填充 + 左侧 2px accent 线 + 等宽加粗分支名；`DiagramTree` 区分主目录与 worktree（主目录强调色、普通 worktree 灰色），与项目行共用悬浮语言。
- **终端关闭语义**：`requestCloseTerminal` 统一收口（running → ConfirmDialog 确认；exited → 直关）；关 = 从 store 移除 → 组件卸载 → kill 进程。重启 = `restartTerminal`（spawnSeq+1，TerminalPane 重新 spawn，xterm 实例与滚动缓冲保留）。
- **皮肤与语言仍是纯展示层偏好**：三档分段控件挂在左栏底部「设置」行右侧（语言在左、皮肤在右），不写 omp 配置、不进设置页；`--term-*` 两套色板跟着这两个开关走。深浅色不准用 Tailwind `dark:` 变体绕开 token；终端色值只准放 `index.css` 的 `--term-*`（`lib/termTheme.ts` 运行时读取）。
- **全 app 不显示滚动条**（2026-09-24 口径）：任何滚动容器都只滚动、不画滑块——`index.css` 里 `*::-webkit-scrollbar { display:none }`（WebKit / WKWebView 只认这条伪元素规则）+ `scrollbar-width: none`；终端 xterm 是自绘 overlay 滑块，另有单独规则。滚动照常（滚轮 / 触控 / 键盘 / 程序化），也不再需要 `scrollbar-gutter` 占位（相关类与 `.no-scrollbar` 已删，别再引入）。
- **行尾下拉（`EnumSelect`）宽度按最长选项撑开、文本不截断**：面板 `width: max-content`，装不下时换行，`max-width` 夹在视口内——别退回「面板窄 + 选项 `truncate`」（WKWebView 下会把选项切成 `mini…`）。
- **终端图标字体是壳的资源**（V16）：`--font-mono` 末尾的 "OMP Nerd Icons"（`public/fonts/omp-nerd-icons.woff2`，Nerd Fonts Symbols Only 派生、横向压到 0.6 em = 1 个终端 cell；重新生成走 `scripts/build-nerd-icons-font.py`）**只补图标码点**，ASCII / 中文仍走系统字体；`main.tsx` 启动预热。设置 ›「常用设置」的 `symbolPreset` 是**唯一进白名单的外观键**（nerd 档能不能渲染由壳决定）。omp 欢迎头那条「Please use nerdfont 😭.」是上游行为（unicode 档 + 每会话 10% 概率，见 `docs/v16-schedule.md`）——**不许在壳侧过滤终端输出**，消除它靠切 `symbolPreset`。
- **界面文案一律走字典**（`src/lib/locale.ts` 的 `TEXT`）：组件内 `useText()`、非组件模块 `TEXT[useApp.getState().locale]`；插值 `fmt(t.key, v1)`（占位 `{0}`）；**上游数据不进字典**（会话标题、omp 输出、后端错误原样透传）。设置项 label 是动态键（`s_` + 点换下划线 / 分组 `sg_` / 值标签 `sv*`）——**这批前缀的键不许被「未使用键清理」误删**（有单测守着）。
- 左侧栏宽度 **292–480px（默认 292，localStorage 持久化）**；下限由底部行内容决定（改 `SIDEBAR_MIN` 前先量那一行）。窄窗 <768px 收抽屉。
- 状态收敛：无独立状态条；omp 健康走 `HealthBanner`，更新提醒走左栏设置入口的小点（`update.status` 为 available/ready）。
- 导出 / 复制 / 草稿 / 队列这些聊天概念亦已退场；新功能不许把它们引回来。
- **视觉基线（2026-09-17 精修）**：冷灰外壳与内嵌工作面；桌面主区外沿 8px / 16px 圆角，48px 标签栏始终存在（空态仍保留工作区标题与新建按钮，窄窗提供项目抽屉入口）。设置页 `max-w-6xl`，通过容器查询在 176px 文字导航与 44px 图标导航间切换；七个页面共用卡片、控件与浮层层级。颜色与圆角真相见 `design-system/MASTER.md` / `index.css`，实心 accent 按钮文字用 `accent-foreground`。

## 常用命令

```bash
pnpm install
pnpm tauri:dev              # 桌面壳联调
pnpm dev                    # 纯前端
pnpm check                  # 提交前全过：typecheck + lint + test + e2e:ipc
pnpm typecheck              # tsc --noEmit
pnpm lint                   # eslint（flat config，0 警告）
pnpm test                   # vitest
pnpm e2e:ipc                # IPC 契约双向自检（ipc.ts ↔ main.rs ↔ 实现）
pnpm build                  # tsc + vite 构建
cargo test --manifest-path src-tauri/Cargo.toml    # Rust 单测（含真实 PTY 回环）
cargo test --manifest-path src-tauri/Cargo.toml -- --ignored   # 慢测试：真实 omp TUI 冒烟 / 真实 agentDir 基准 / 真实 omp usage 解析 / 真实 commandcode 探针（真实 HTTP） / 真实提交信息快路径（3 次 `omp -p`，打印耗时）/ 真实 `omp commit` 完整轨（各消耗 AI 调用，临时仓库自建自清）
pnpm tauri:build            # 本机发布构建，产物见 src-tauri/target/release/bundle/
pnpm icon                   # 从 design-system/icon/omp-mini-icon.svg 重生成桌面图标
```

界面核对（无屏幕权限时）：`pnpm build` + `pnpm preview` + 浏览器里注入 `window.__TAURI_INTERNALS__` mock（含 Channel 协议：`transformCallback` 回调表 + **`{index, message}` 序号帧**——Tauri v2 的 `Channel` 在 `new Channel()` 时就注册回调、且序号不连续的消息会被挂起，mock 必须按 index 自增投递；`onEvent` 参数是 Channel 实例，要自己触发 `toJSON()` 才拿到 `__CHANNEL__:N`），可驱动全流程（开终端 / 多 tab / 退出浮层 / 会话弹窗 / 提交任务）。**注意执行世界（2026-09-23 复测修正）**：omp 的 browser runtime 里 **`page.evaluate` 落在 isolated world**——那里写的 `window` 属性对 main world 的应用不可见（表现为「灌了 mock 应用仍报 undefined」）；但 **Puppeteer 的 `page.evaluateOnNewDocument`（main world）在本机实测生效**：注册一次 + `page.reload()`，应用启动前就拿到 mock（V16 曾记「`Page.addScriptToEvaluateOnNewDocument` 不生效」——那一版是直接调 CDP 未指定 world 的口径，别再照抄）。所以清单是：**mock 走 `evaluateOnNewDocument` + reload；注入的 mock 要一次补齐本次核对用到的全部命令**（缺命令 = 返回 null，界面会如实报错，别把它当产品 bug）；DOM 读回（`page.evaluate` 查 DOM）跨 world 可用，断言放同一个 `tab.run` 里。

## 发版与更新

- 打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json` 供应用内 updater 拉取。**仓库必须保持 public**：updater 匿名拉取 `latest.json`，私有仓库会 404（工作流的守卫 job 会挡住私有状态发版）。
- `latest.json` 的资产链接必须是公开直链：tauri-action v1 默认写 `api.github.com/.../releases/assets/<id>`（匿名限流 60 次/小时/出口 IP，应用内下载经系统代理会 403「能检查、不能下载」），发版末尾的 `fixup` job 用 `scripts/fixup-latest-json.mjs` 统一改写为 `releases/download` 直链；存量 release 也用同一脚本修补。
- **更新说明取 CHANGELOG 的版本节**：`scripts/changelog-notes.mjs` 抽出当前版本那一节（剥掉版本标题），publish job 拿它当 `releaseBody`、fixup job 拿它回填 latest.json 的 `notes`——应用内更新弹窗把 `notes` 当「本次更新」按 Markdown 渲染（`UpdateDialog` 复用记忆页的 `.md-body` 排版）。版本节缺失或为空会让这两步直接失败，所以「发版前 CHANGELOG 没写」挡在工作流里；存量 release 的 notes 也这样回填（`node scripts/fixup-latest-json.mjs <latest.json> vX.Y.Z`）。
- updater 需签名校验：`src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey` 已配置（私钥全文需在仓库 Secrets `TAURI_SIGNING_PRIVATE_KEY`，见 README「应用内更新」节）。
- 升版本号发 Release 前，必须同步更新 `CHANGELOG.md`（将 Unreleased 条目归入新版本节并写明日期）。

## 范围边界（V11 现行口径）

- **不做**：编辑器 / 文件树 / diff 审查 / 内置浏览器 / SSH / 移动端 / PR 集成（Orca 的「复杂」部分）；终端滚动缓冲持久化（重启不恢复 tab）；终端与 jsonl 会话的运行时绑定；分屏（split）；多窗口。
- git 这块的边界（V19）：**不做** pull / 同步远端、创建 PR、逐 hunk 暂存、提交撤销、提交前的 diff 预览；提交信息支持「生成 + 手改」，但**不给自由文本附加说明**（`omp commit -c` 的输入框仍是候选）。快速轨**不维护 `CHANGELOG.md`**——要它就用完整轨（`omp commit`）。worktree 生命周期（创建 / 删除 / 清理）不在壳侧（V20）：只读展示 + 提交入口保留。
- 沿用旧口径的边界：自动化 / 定时任务、插件 / Skill / MCP / Hook 管理、主题市场、云同步——仍在范围外。
- 自定义模型的 **`discovery` 表单**与**覆盖型块的编辑**不做（见 `docs/v12-schedule.md` §5）；写的是 agentDir 的全局层——项目级 models 配置上游没有发现路径。
- 上下文容量（V7）的**壳侧 UI 已随 V11 退场**（omp TUI 自带 `/context`）；用量限额（V6）的供应商配额视图在 **V15 以设置 ›「供应商用量」回归**（`provider_usage.rs`；V6 的输入框上下文条入口随聊天界面删除），上游数据 = `omp usage --json`。壳侧对 omp 无探针但上游有「API key 可用」查询接口的供应商（commandcode / deepseek）做**有限补充探针**（`extra_usage.rs`：凭据只经 `omp token` 内存传递、不落盘、不回传前端；见 `docs/v15-schedule.md` §6）；既无 omp 探针也无可用接口的仍显示「无用量数据」。
- 旧的会话内容搜索（M7b）随左栏会话列表一并退场；已归档对话仍可搜索式管理？——**不**，归档页只按项目分组列出（无搜索）。要恢复先定交互（见 `docs/v11-schedule.md` §7）。

## 命名与变更约定

- 对外名称：ompMiniDesktop；仓库/包名：`ompMiniDesktop` / `omp-mini-desktop`；标识符、文件名：英文；界面文案、注释、文档、提交说明：中文。
- 架构级变更（创建/删除/移动文件或目录、核心数据流变更）必须同步更新本文档、`docs/` 与 `design-system/MASTER.md`。
- 增删前后端依赖时同步 `THIRD-PARTY-NOTICES.md`；密钥、Token、私钥、签名证书、个人路径一律不得进仓库。
