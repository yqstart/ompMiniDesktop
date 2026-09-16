# ompMiniDesktop 八期（V8）功能排期：通用设置（omp 常用配置项）

> 基线：V1–V7 已交付（见 `CHANGELOG.md`）；本文只排八期。
> 目标：把 omp 全局配置里**用户最常改的那些键**搬进「设置 › 通用」——开关 / 下拉 / 数字框直接改，
> 不要求用户为了调一个 `compaction.enabled` 去开终端敲 `omp config set`。
> 约束：真相在 `~/.omp/agent/config.yml`；壳侧只做读写映射，不自己解析 YAML、不自己存一份配置。

## 0. 范围与口径

用户口径：「设置 tab 中的通用 tab 需要添加 omp 的一些常用配置项，你来总结一些常用的配置项放置到通用配置中」。

| 位置 | 区块 | 映射的上游物 | 写入什么 |
|---|---|---|---|
| 设置 › 通用（omp 诊断与「应用更新」之间） | 「omp 常用设置」：6 组 / 40 项 | `omp config list --json`（读数） | `omp config set` / `omp config reset`（**omp 全局配置**） |

**这一页是本 app 第二个（也是第三个）改 omp 状态的地方**，与前两个页签的性质相同、理由也相同：

- 设置 ›「供应商」写 omp 的**凭证库**（`omp auth-broker login|logout`）；
- 设置 ›「模型」写 omp 的 `modelRoles`（`omp config set modelRoles`）；
- 设置 › 通用（本期）写 omp 的**普通配置键**（`omp config set <key> <value>`）。

三条都是「用户在这个界面上显式点的动作」，且改的都是 omp 自己的东西（记忆页只删文件、使用统计页只读 jsonl、
「诊断」区只写本应用的覆盖层 `ompPath`——那些口径不变）。

**范围外**（本批不做）：

- **不摆一个 500 项的配置浏览器**：omp 18.2.1 有 501 个键，绝大多数是 TUI 渲染细节（`theme.*` /
  `statusLine.*` / `tui.*` / `appearance` 组），桌面端要么不生效、要么无从显示。这里只收「影响 agent 行为、
  且用户真的会改」的 40 项（见 §2）。
- **不做 array / record 类型的键**（如 `bash.patterns` / `tools.approval` / `retry.fallbackChains`）：
  它们要整表读写，语义与单个开关不同，各有专门入口或干脆留给 TUI。
- **不做项目级写入**：`omp config set` 只写全局层，界面也如实这么说（见 §1 ④）。
- 不做配置搜索 / 过滤、不做「已改动」标记、不做导入导出。

## 1. 上游事实（omp 18.2.1 本机实测）

**① `omp config list --json` 一次就能拿全量读数。** 输出是**扁平点路径** → `{value, type, description}`，
本机实测 **501 项 / 约 90KB / 0.13s**。`type` 取 `boolean|number|enum|string|array|record`；
`description` 是 omp 自己对这条设置的定义（英文）。

> **枚举的合法取值不在 JSON 里**：schema 里带枚举的键只给 `"type": "enum"`，取值表只出现在**人读的**
> `omp config list` 文本里（`edit.mode = hashline (apply_patch|hashline|patch|replace|sloppy)`）。
> 所以界面上的选项表是**壳侧自带的**（`src/lib/ompSettings.ts`）；上游加了新枚举值时，当前值不在表里
> 就**原样补一条**进下拉，不吞信息（`optionsFor()`，有单测）。

**② 部分键支持 `get` / `set` / `reset`，值按 schema 类型解析。**
`omp config get <key> --json` 回 `{key, value, type, description}`（未知键退出码 1）；
`omp config set <key> <value>` 按类型解析——boolean 接受 `true/false/yes/no/on/off/1/0`，
enum **必须精确匹配**（失败时 stderr 回 `Error: Invalid value: nope. Valid values: off, local, …`，
这条消息原样透传给用户）；`omp config reset <key>` 把该键的 **schema 默认值写回**配置（不是删键）。

**③ 以 `-` 开头的值必须用 `--` 分隔（本期踩到的第一个坑）。**
`omp config set temperature -1` 直接报 `error: Unknown option '-1'`（yargs 把它当 flag），退出码 1。
正确写法是 `omp config set temperature -- -1`（实测对 bool / enum / number 都无副作用）。
`temperature` 与 `compaction.thresholdPercent` 的「默认」恰好就是 `-1`，绕不开——后端统一走带 `--` 的调用形式。

**④ 读数是「合并项目层之后的有效值」，写只写全局层。**
`omp config list|get` 返回的是 `built-in defaults ← global ← project ← CLI overlays ← runtime overrides`
合并后的结果。实测：在 `<cwd>/.omp/config.yml` 写了 `compaction: {enabled: false}` 的目录里
`omp config get compaction.enabled` 读回 `false`，同一条命令在目录外读回 `true`。

> 所以后端**把工作目录钉在 agentDir**（`~/.omp/agent`，那里不会有 `.omp/`）再跑 `config`——
> 否则「从项目目录启动 app」时，界面显示的是该项目的覆盖值，用户改全局会「看起来没生效」。
> agentDir 自己可能还没被建出来（全新机器），那种情况下退回「不指定目录」而不是让整页报错
> （`settings_cwd()`）。

**⑤ 改动何时生效——未实测。** 长驻的 `omp --mode rpc` 会话**是否热读** `config.yml` 没能验证：

- 试过用 `extendedContext` + `get_state.contextWindow` 对拍（起 RPC 进程 → 外部改配置 → 同一进程再
  `get_state` → 再起新进程对比），但该键对当前模型**没有可观测差异**（窗口恒为 1M），实验无区分度；
- omp 18.2.1 的二进制里 JS 已编译成字节码，`strings` 取不到配置加载逻辑（18.1.22 时期还能取到内嵌源码，
  这也是 `docs/v2-schedule.md` §2 那批口径的来源）。

**所以界面只做必然为真的表述**：「写的是 omp 的全局配置，**新建的会话一定读到新值**」——
不宣称已打开的会话会立刻应用。留待后续用真实会话复验（见 §5）。

## 2. 白名单（40 项 / 6 组）

取舍原则：**影响 agent 行为、用户真的会改、且没有别的入口**。已有专门入口的键一律不进：

| 已有入口 | 键 |
|---|---|
| 输入框工具行的 `PermissionBadge` | `tools.approvalMode` |
| 设置 ›「模型」（角色与失败转移） | `modelRoles` / `modelRoleStorage` / `retry.fallbackChains` / `retry.modelFallback` / `retry.fallbackRevertPolicy` |

| 组 | 项 |
|---|---|
| 会话与上下文（8） | `extendedContext` / `contextPromotion.enabled` / `compaction.enabled` / `compaction.thresholdPercent` / `compaction.autoContinue` / `defaultThinkingLevel` / `temperature` / `retry.maxRetries` |
| 工具（10） | `web_search.enabled` / `fetch.enabled` / `browser.enabled` / `computer.enabled` / `github.enabled` / `todo.enabled` / `checkpoint.enabled` / `eval.py` / `eval.js` / `dev.autoqa` |
| 终端与编辑（8） | `bash.enabled` / `bashInterceptor.enabled` / `bash.allowCompoundCommands` / `edit.mode` / `read.defaultLimit` / `lsp.enabled` / `lsp.formatOnWrite` / `lsp.diagnosticsOnWrite` |
| 记忆与学习（2） | `memory.backend` / `autolearn.enabled` |
| 任务与技能（6） | `plan.enabled` / `goal.enabled` / `skills.enabled` / `task.isolation.enabled` / `task.isolation.merge` / `task.maxConcurrency` |
| 交互与显示（6） | `autoResume` / `power.sleepPrevention` / `steeringMode` / `followUpMode` / `hideThinkingBlock` / `includeWorkspaceTree` |

**白名单与真实 omp 对拍过**（脚本核对 `omp config list --json` 的实况）：40 个键**全部存在**、
`type` 声明**全部一致**、7 个 enum 的取值表（含顺序）**全部一致**。

**文案口径**：label 进字典（键名规则 `s_` + key 里的点换下划线，由 `src/lib/ompSettings.test.ts` 逐条守着，
拼错就是界面上的 `undefined`）；**说明文字用上游英文原样透传**（`description`，挂行的 `title`）——
翻译会引入壳侧自己的解释，也会随上游改语义而漂移。`edit.mode` 与 `defaultThinkingLevel` 的**选项值也原样显示**
（工具形态名 / 思考档名，与输入框的 `ThinkingPicker` 同一口径），其余枚举用字典里的简短中文
（`memory.backend` 的中文来自上游 description 自己的写法）。

## 3. 实现

**后端**：新增 `src-tauri/src/settings.rs`（3 个命令，`pnpm e2e:ipc` 契约扩到 **60** 个命令）。

- `get_omp_settings(keys)`：一次 `omp config list --json` + 按请求的键过滤——**不逐键 `config get`**
  （40 项就是 40 个进程，每次 ~0.12s）。上游没有的键**整个缺席**，界面据此显示「当前 omp 版本没有这个设置」
  并禁用控件，**不补一个壳侧编的默认值**。
- `set_omp_setting(key, value)`：`omp config set <key> -- <value>`，**写完回读**返回真相
  （omp 静默丢弃写入时界面不停在乐观值上）。
- `reset_omp_setting(key)`：`omp config reset <key>`，同样回读。
- `valid_key()` 校验点分标识符（每段字母开头，段内允许 `_` / `-`——实测 schema 里
  `web_search.enabled` 与 `providers.openai-codex.codeMode` 都真实存在），`value_arg()` 只放标量。
  校验的意义不在防命令注入（`run_omp` 用 `Command::args` 传参、**不经 shell**），而在别把前端 bug
  变成对 omp 配置的随意写入。
- `providers.rs` 新增 `run_omp_in(dir, …)`（`run_omp` 变成它的无目录形式），用于把工作目录钉在 agentDir（§1 ④）。
- 9 项单测（key 形状含下划线/连字符 / 值序列化含 `-1` 与小数 / 拒绝非标量与空串 / 有序挑键 /
  上游没有的键缺席 / 坏 JSON 与非对象 / redacted 不当真值 / 批量上限）。

**前端**：`src/lib/ompSettings.ts`（白名单 + 分组 + 枚举表 + `optionsFor` 兜底，12 项单测）+
`src/components/settings/GeneralSettingsPanel.tsx`（分组可折叠、行内展开的枚举选择器、开关、数字框、
行尾「恢复 omp 默认值」；写入先乐观改、失败回滚 + 内联错误条）。字典新增 70 键 × 2 语言。

## 4. 完成口径（已达成）

- `pnpm check` 全绿（typecheck / lint / test / e2e:ipc / e2e:rpc）；`cargo test` **178 项**通过
  （lib 77 + bin 101，另有 1 项 `#[ignore]` 真机基准不计）。
- 白名单对拍：40 项在真实 omp 18.2.1 里全部存在，`type` 与枚举取值（含顺序）全部一致。
- 真机验证（`pnpm tauri:dev`，真实 agentDir）：设置 › 通用里「omp 常用设置」面板渲染正确——
  6 个分组（会话与上下文 8 / 工具 10 / 终端与编辑 8，其余折叠在下方）、40 行中文 label 与 omp 键名、
  真实读数（`compaction.enabled = 开`、`compaction.thresholdPercent = -1` 且带「-1 = 默认」提示、
  `defaultThinkingLevel = max`、`retry.maxRetries = 10`、`checkpoint.enabled = 关`）、
  每行的上游英文说明作为悬浮提示、`恢复 omp 默认值: <label>` 的 aria-label、开关的开/关两态配色、
  数字框与下拉的对齐（控件右对齐成一条线）均逐项核对通过。
- **写入链路端到端验证**（在一个**隔离 agentDir** 的实例上做，`PI_CODING_AGENT_DIR=/tmp/omptest-agent`
  启动裸二进制，用户真实配置零改动）：
  - 隔离生效的第一证据是页面本身——诊断区显示 `agentDir = /tmp/omptest-agent`，
    且 `采样温度` 读出的是临时配置里的 `0.5`（真实实例同一位置读的是 `-1`）；
  - **写**：点「任务清单」（`todo.enabled`）开关 → 磁盘上 `config.yml` 真的变成 `todo: enabled: false`，
    界面同步显示为关（回读生效）；再点一次 → 回到 `true`，界面同步；
  - **恢复默认**：点「采样温度」行尾的「恢复 omp 默认值」→ 磁盘上 `temperature: 0.5` 变成 `-1`
    （`omp config reset` 写回 schema 默认值）。

## 5. 风险与未实测项

| # | 事项 | 状态 | 缓解 |
|---|---|---|---|
| 1 | 运行中的会话是否**热读**配置（§1 ⑤） | **未实测** | 界面只声明「新建的会话一定读到新值」；后续可用真实会话复验 |
| 2 | 上游新增 / 改名配置键 | 持续风险 | 白名单取不到值时显示「当前 omp 版本没有这个设置」并禁用，不摆假值；新增枚举值原样补进下拉 |
| 3 | 项目级 `.omp/config.yml` 覆盖 | 已规避 | 后端钉住 agentDir 读数，界面如实写明「项目覆盖优先于这里」 |
| 4 | 写入链路 | **已端到端验证** | 在 `PI_CODING_AGENT_DIR` 指向的**隔离 agentDir** 里点开关与「恢复默认」，磁盘写回与界面回读都对得上（见 §4），全程零改动用户真实配置 |

## 6. 后续候选

- 让「设置 › 通用」支持**项目级**写入（写 `<cwd>/.omp/config.yml`）——omp 对普通键**没有**项目写入路径，
  只能自己改 YAML，与「壳侧不解析 / 不改写 omp 配置文件」的口径冲突，要先定边界。
- 每行显示「与 schema 默认值不同」的标记（`config list --json` 不返回默认值，需要额外一次 `reset` 对拍或读 schema）。
- 把白名单做成可搜索的全量配置浏览器（501 项）——需要先解决数组 / 对象类型的编辑交互。
