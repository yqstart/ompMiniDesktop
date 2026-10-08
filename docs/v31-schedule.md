# V31 omp 诊断搬进 omp 更新弹窗（「关于」页退场）

> 目标：设置 ›「关于」里的 omp 诊断（omp 路径 / agentDir / 重新检测 / 指定路径）搬进
> **omp 更新弹窗**（左栏字标行 omp 版本 chip 点开的那个，V24 建的）——用户指定落点（截图里
> 框住的就是弹窗里「当前版本 / 最新版本 / 更新渠道 / 上次检查」那张事实表）。
> 搬完之后「关于」页没有别的区块（应用更新 V30 已搬去应用版本 chip），于是**整个页签退场**：
> 设置页从八个页签收成七个。

## 1. 迁移口径

| 决策 | 结论 | 理由 |
|---|---|---|
| 落点 | omp 更新弹窗里，事实表 `dl` 之后加一块 **「omp 诊断」**（复用 `diagSection` 标题键）：状态徽章（正常 / 不可用）+「重新检测」「指定路径」两枚按钮 + `omp 路径` / `agentDir` 两行（各带复制键）+ 健康错误列表 + `diagFoot` 说明。 | 弹窗本来就是「omp 运行时」的信息与操作面板（当前版本 / 最新版本 / 渠道 / 上次检查 + 检查 / 更新）；诊断信息属于同一个对象的同一件事。放事实表正下方：两块表读出「这台机器的 omp 在哪、什么版本、能不能更新」。 |
| 两个检查按钮并存 | 弹窗底部原有的 **「重新检查」= 查 omp 有没有新版本**（`check_omp_update`）不动；诊断块里的 **「重新检测」= 重跑健康检查**（`get_health`：重探路径 / 版本 / agentDir，并顺手静默查一次更新）——两个动作语义不同，都留，各自就地显示结果。 | 合并成一个按钮会丢掉「我只想重探路径」这个动作；文案本来就不一样（重新检测 vs 重新检查），实测两者在弹窗里并排也不挤。 |
| 「关于」页整页退场 | `SettingsTab` 去掉 `about`；页签从八项收成**七项**（omp 组五项 + 本应用组两项：使用统计 / 已归档对话）；`tabAbout` / `tabAboutHint` / `version` 三个字典键删除。 | 页面没有别的内容可放（应用更新 V30 已搬走）。留一个空页签只会让人以为功能坏了。 |
| omp 复制键 | `omp 路径` 行加一枚复制键（`copyPath`），`agentDir` 行沿用 `copyAgentDir`；两枚共用一个 `copiedKey` 状态（原「升级方式」块里复制 `omp update` 命令的那枚键也并进同一状态机）。 | 用户拿到弹窗里的路径十有八九是要粘到终端里跑（`which` 排查 / 手动升级），复制比手抄强。 |
| omp 找不到时怎么办 | 那条路径**不经过这个弹窗**：`health.omp.ompPath` 为空时 `OmpUpdateChip` 整个不渲染（V24 口径），弹窗也就点不开——那种场景仍由顶部 `HealthBanner`（同样的「重新检测」「指定路径」两枚按钮）兜底。诊断块只在 `health` 存在时渲染。 | 不改变「omp 未找到 = 横幅负责」的既有分工；弹窗只是把「omp 在、但我想看/改它」这套动作从 About 接过来。 |
| 文案指向 | `ompSettingsMissing`（「常用设置」页在 `health.ok === false` 时的那行提示）改成先指**顶部横幅**（omp 真找不到时 chip 不渲染、弹窗开不出来，只有横幅一定在）：「未找到 omp——先用顶部横幅的「重新检测 / 指定路径」指定；omp 就绪后，安装信息与诊断在左栏字标行 omp 版本 chip 的弹窗里」。 | 旧文案写的是「先在『关于』页的诊断区指定 omp 路径」——那页已经没了，留着就是把人指进死路；新文案的第一落点必须在「omp 找不到」时真的存在。 |
| 复制失败的反馈 | 三枚复制键失败时落诊断块里的 `diagError` 行（`role="alert"`，`copyFailed`），不再静默。 | 原「升级方式」的复制键失败是静默的；既然诊断块已经有错误行，顺手把失败说清楚。 |

## 2. 实现

- **`OmpUpdateDialog`**（`src/components/update/OmpUpdateDialog.tsx`）：事实表后新增「omp 诊断」块
  （`border-border-soft bg-surface` 卡片，与「升级方式」块同款）——头部一行 = 标题 + 状态徽章 +
  两枚按钮（窄窗 `flex-wrap`），下面是 `omp 路径` / `agentDir` 的 `dl`（各带复制键，值为空时不渲染
  复制键）、`health.omp.errors` 列表、`health.modelsError`、`diagError`、`diagFoot`；`copiedKey`
  状态机（`"command" | "path" | "agentDir" | null`）与 `copy()` / `runDiag()` 两个小助手。
- **`SettingsPage`**：`about` 页签连类型 / 图标 / 分组 / 面板分支 / 状态与助手（`diagError` /
  `copied` / `runDiag` / `copyAgentDir`）一起删；`general` 分支从条件表达式末尾挪成兜底分支；
  引入的图标与 `ompDiag` 依赖一并清掉。
- **`lib/ompDiag.ts`**：头注释改成「omp 更新弹窗的「omp 诊断」块 + 顶部引导横幅共用一份实现」。
- **字典**：删 `tabAbout` / `tabAboutHint` / `version`；`ompSettingsMissing` 中英同步改指向；
  其余诊断键（`diagSection` / `diagOk` / `diagBad` / `recheck` / `pickPath` / `pickPathTitle` /
  `ompPath` / `notFound` / `unknown` / `copyAgentDir` / `copyPath` / `copyFailed` / `opFailed` /
  `diagFoot`）全部原键平移，一个关键字都没新增。

## 3. 完成口径

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **338 项前端单测**（含字典中英同键 / 无空文案 /
  英文不含中文三项校验——这次删了三个键，校验照样过）+ `e2e:ipc`（71 命令 × 双向一致）。
- **真实 Chromium 核对**（`pnpm build` + `pnpm preview` + `__TAURI_INTERNALS__` mock；mock 走
  `evaluateOnNewDocument`、控制面走 DOM 属性（`data-health-calls`），1440×900、深色、zh-CN）：

| 场景 | 结果 |
|---|---|
| 点 omp 版本 chip | 弹窗「omp 更新」渲染：状态行「已是最新」→ 事实表（当前版本 18.8.3 / 最新版本 18.8.3 / 更新渠道 stable / 上次检查 10/8 10:35）→ **「omp 诊断 正常」块**（重新检测 / 指定路径 + `omp 路径 /opt/homebrew/bin/omp` + `agentDir /Users/mock/.omp/agent` + 「指定路径只写入本应用的覆盖层，不改 omp 自己的配置文件。」）→ 底部「重新检查 / 关闭」 |
| 复制键 | 诊断块内两枚：`aria-label` = 「复制路径」（omp 路径）与「复制 agentDir」 |
| 点「重新检测」 | `get_health` 再次被调用（mock 计数 1 → 2，`data-health-calls` 属性变化） |
| 设置页签 | `#settings-tab-about` **不存在**；`role="tab"` = 常用设置 / 模型 / 插件 / 技能 / 记忆 / 使用统计 / 已归档对话（七项） |
| omp 找不到（`ompPath: null, ok: false`） | omp chip 不渲染（左栏只剩应用 chip `v0.10.0`）、顶部横幅给「重新检测 / 指定路径」、设置 ›「常用设置」的提示 = 「未找到 omp——先用顶部横幅的「重新检测 / 指定路径」指定；omp 就绪后，安装信息与诊断在左栏字标行 omp 版本 chip 的弹窗里。」 |

  截图（深色）：弹窗全貌（事实表 + 诊断块 + 底部按钮）。

## 4. 边界（明确不做）

- 不做「omp 路径可编辑输入框」：指定路径仍走系统文件选择器（`ompDiag.pickOmpExecutable`），
  与 `HealthBanner` 同一入口——壳侧不解析用户手输的路径文本。
- 不做诊断块里的「打开安装目录 / 在访达中显示」：只需要路径与复制（V23 的技能页有访达入口，
  那是另一个场景）。
- 不改健康检查的行为与时机（启动一次 + 手动「重新检测」+ 顶部横幅），也不把 `health` 拆细到
  「路径 / 版本 / agentDir 各自的状态」。
- 不把「应用更新」也塞进这个弹窗：两条更新链路互不相干（V24 §2.1），应用侧仍在自己的 chip +
  `UpdateDialog` 里。
- 设置页不再有「关于」入口：本应用的版本号在左栏字标行的应用版本 chip 上常驻可见，不需要再开
  一个页看它。
