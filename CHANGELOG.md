# 更新日志

本项目的所有重要变更记录于此。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

发版时把 `Unreleased` 条目归入新版本节并写明日期——该节即 Release 说明（`scripts/changelog-notes.mjs` 抽取，缺失会挡发版）。

## [Unreleased]

### Added

- **设置 ›「存储维护」：omp 缓存 / 日志清理 + 闲置会话回收**（2026-10-22）：新条目给出磁盘占用读数（omp 图片缓存 / 会话记录 / 日志 / 数据库、壳侧粘贴临时文件 / 设置备份 / 用量账本）与常驻会话进程数；清理分两档——**安全清理**（未被任何会话引用的图片缓存、按 7 / 14 / 30 天过期的日志与粘贴临时文件、设置备份、数据库 WAL）与**深度优化**（由 omp 归档冷会话 / 压缩空闲会话，默认不勾）。清理前先跑 `omp gc` 的 dry-run 给可回收读数，执行必须过确认框；**不删除任何会话内容**。内存一段可立即回收闲置 ≥30 分钟的会话进程（运行中 / 等审批 / 等后台投递不碰，下次发消息自动恢复）。口径见 `docs/storage-maintenance.md`。

- **常用设置 ›「工具」组：浏览器自动化配置整组上浮**（2026-10-22 用户口径）：此前设置页里只有一个 `browser.enabled`，`browser.headless` 还躺在三稿的删除名单里——结果是「omp 的浏览器操作看不见」在壳里根本无从下手。现在 `browser.cdpUrl` / `relay` / `relayUrl` / `headless` / `freezeOnTurnEnd` / `idleCloseSec` / `screenshotDir` 一并可选（清单 80 → 87 项）。**让操作可见 = 关掉「无头浏览器」**：行内会补一句「窗口可见（omp 另开一个浏览器窗口）」，省得去悬停读上游那句 "disable to show browser UI"；omp 随后启动的是自带的有头 Chrome for Testing 窗口，配置改动在下一次 browser 调用（或新会话）生效。`browser.cmux` / `browser.tern` 仍不进：那是 cmux / Tern 两个宿主的开关，桌面壳里没有可观测差异。壳侧不做内置浏览器。

### Changed

- **会话图片：可点开预览、复制到剪贴板、另存为**（2026-10-22）：消息气泡里的图片变成可点缩略图，点开全屏预览；顶栏「复制图片」走后端 `arboard` 解码写系统剪贴板，「保存图片」走系统另存为对话框。历史图片按需从 omp 的 blobs 目录读取（40 张 / 48M 字符 LRU + 单飞），不把整段历史的 base64 常驻内存；手机 PWA 保留预览、隐藏复制 / 保存（不在远程白名单）。

- **死代码清理**（2026-10-22，全量 review）：移除已退场功能留下的无调用者链路——`/fork` 的前端映射 / `fork_session` / `fork_at` 与 `openForkedSession`、`/branch` 的 `branch_session`、`/slow` 的 `set_slow_mode`、未注册的 `locate_omp` 前端绑定、`useSingleOpen`、`SessionActions`、`SLASH_GROUPS`、`resetRemoteAuth`、仅测试调用的 `providerSelectors` / `highestThinking` / `referenceInsertText` / `appendReference`，以及 `s_*` / `sa*` 两组无人引用的文案键；后端删除未使用的 `walkdir` 依赖与模板残留的 `lib.rs` 目标。`lint` 改为覆盖仓库根配置（`eslint .`），`@eslint/js` 对齐 ESLint 9。

### Fixed

- **技能删掉后不再在「已停用」里阴魂不散**（2026-10-23 用户实测）：设置 ›「技能」的停用名单来自 omp 全局 `disabledExtensions`，手动删掉技能目录后配置里的旧记录还在，「已停用」照样列着一个已经不存在的技能，看着像页面没刷新。现在 `list_skills` 用一次「清空停用」的探测（临时 overlay 走 `PI_CONFIG_FILES`，由 omp 自己重新发现）拿到全部技能名，配置里对不上任何技能的名字归为悬空记录——它们不再作为停用行展示，只在列表底部给一行「N 条停用记录指向已不存在的技能」+「清除记录」一键摘除；设置搜索也不再命中这些悬空项。探测失败时按原样显示（不误藏真实存在的停用项）。

- **历史会话里的图片不再显示成坏图**（2026-10-22）：omp 写 jsonl 时把图片外置成 `blob:sha256:<hash>`（实体在 `~/.omp/agent/blobs/`），旧版壳侧把它当 base64 拼成 `data:image/...;base64,blob:sha256:…`，重开会话后图片全部显示不出来（实时帧是 base64，所以刚发完时正常）。现在 `imagesFromContent` 识别 blob 引用、`MessageImage` 经 `read_blob_image` 按需读实体（hash 形状校验 + 只读 blobs 目录 + 10MB 上限），远程白名单同步放行该只读命令。

- **「系统授权 › 自动化」不再把「System Events 没在跑」读成未授权**（2026-10-22 用户实测）：`AEDeterminePermissionToAutomateTarget` 按 bundle id 寻址时**要求目标进程正在运行**，而 System Events 由 launchd 按需拉起、平时不常驻——归零状态下这个 API 一律返回 `-600`（procNotFound），于是系统设置里 System Events / Chrome 的开关全开着、面板仍显示「去授权」。现在 -600 时后端先 `open -g -b com.apple.systemevents` 把它拉起来（启动 app 不发 Apple Event、不会弹授权框；拉起有效就不留门槛——用户手动退出 System Events 后下一轮轮询即可恢复，只有拉起本身失败才 30s 内不再重试），短暂等待后重查，再按 0 / -1743 / -1744 给出真实读数。回归测试从冷状态（先杀掉 System Events）验证查询不再停在 -600。

## [0.3.2] - 2026-10-22

### Added

- **设置 ›「系统授权」：macOS 四项隐私授权可查、可一键跳转**（2026-10-22）：设置「通用」组新增条目，直接读 TCC 的**实际生效状态**——完全磁盘访问（能否读 `~/Library/Application Support/com.apple.TCC/TCC.db`）、辅助功能（`AXIsProcessTrusted()`）、屏幕录制（`CGPreflightScreenCaptureAccess()`）、自动化（`AEDeterminePermissionToAutomateTarget`，目标 System Events、只查不弹），每行右侧是「已授权」或「去授权」（`open` 深链到系统设置对应面板）。**不再看系统设置里那个开关**：ad-hoc 签名 / 证书轮换会让 TCC 记录与当前签名身份对不上（tccd `Failed to match existing code requirement`），开关看着开着、API 全是 false——computer use 报「没有权限」时在这里一眼能看出哪一项没落地。面板每 2 秒回读一次（纯本地查询、单飞）+ 窗口重新获得焦点立刻读；屏幕录制未授权时提示要退出并重新打开应用。

### Changed

- **项目 / 分支 / 提交搬回输入卡内部**（2026-10-22 用户口径）：此前它们悬在卡片上方当一根裸行，把「任务清单浮卡 → 目标条 → 输入卡」的整摞切断，看着像两块拼起来的 UI。现在这行是**卡内顶行**（与工具行同一份左右内边距），卡片自己就是这一行与输入区的共同外框；目标条与任务清单浮卡因此直接叠在卡上方，圆角 / 描边 / 浮起层级统一成 `rounded-xl` + `--border` + `--elevated` + `--shadow-pop`，整摞读成一个整体。输入卡焦点高亮改按编辑器焦点（`has-[.draft-editor:focus]`），点项目 / 分支这类行钮不再把整张卡点亮。

### Fixed

- **点击脚本后终端里命令只出现一次**（2026-10-22 用户实测）：脚本注入原先按「首帧输出」判断 shell 就绪（另有 1.5s 兜底），但行编辑器起来之前 zsh 会先输出 `%` 占位提示符（首帧输出 ≠ 提示符就绪）——那一刻终端还是 cooked 模式，写进去的命令先被 tty 行规程回显一遍，行编辑器起来后又把输入缓冲连提示符重画一遍，界面上就成了两行同样的命令（实际只执行一次）。现在注入改走新的 `terminal_write_ready`：后端轮询 PTY 的 termios，等行编辑器把终端切到 raw（提示符出来、能读输入，`pty.rs` 的 `shell_ready`）再落字，8s 超时兜底；键盘输入仍走原来的同步 `terminal_write`（不排队）。真实 zsh PTY 回归用例覆盖「立刻写 = 两行 / 等 raw = 一行」。

- **未进入工作区的项目不再出现「引用工作区文件」入口**（2026-10-22 用户口径）：项目在左栏「未分组」里时没有任何跨项目可引用，`+` / `/` 面板却仍摆着这一行，点开只会看到「没有可引用的其他项目」。现在统一按 `hasWorkspaceRefs`（`lib/workspaceFiles.ts`，口径 = `referenceScope` 里有其他有效成员项目）判断：未分组 / 单成员工作区 / 目录不属于任何项目时，`+` / `/` 面板的「工作区文件」整行、`@` 补全顶部的入口、⌘⇧P 快捷键**都不出现 / 不响应**；文件与压缩不受影响。

- **自定义供应商的模型现在能收藏进「我的模型」**（2026-10-21 用户实测）：此前「挑选模型」弹窗只有清单编辑与调参，没有星标——自定义端点的模型只能绕到聊天输入卡的模型下拉里加星，「我的模型」的空态文案却写着「点击供应商旁的『挑选模型』」。现在每行行尾有星标（与登录型供应商的挑选面板同一份 `StarToggle`），selector = `provider/id`；id 为空或重复时不摆（selector 不唯一）。新加的行提前收藏会在「我的模型」标「已不可用」，保存后目录刷新即恢复。
