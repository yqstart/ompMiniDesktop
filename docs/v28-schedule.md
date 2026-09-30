# V28 omp 常用设置（设置 ›「常用设置」）

> 目标（现行）：omp 全局配置在本应用的**唯一设置面**——117 项展示清单
> （`src/lib/settingsList.ts`）按上游分组渲染：分组浏览、搜索、按 schema 类型编辑
> （开关 / 枚举下拉 / 数字 / 文本 / array·record 的 JSON 编辑）、逐项恢复默认；
> 全量清单不在界面里，在终端 `omp config list` 看。
> 上游口径与实测见 §1（omp 18.4.4，2026-09-30）。

## 0. 范围与口径

### 0.1 现行形态

| 决策 | 结论 |
|---|---|
| 页面形态 | 设置 › omp 组的**「常用设置」页签**（唯一设置面）——上游 519 项目录按壳侧**展示清单**（`src/lib/settingsList.ts`，117 项）过滤后显示；「全部设置」/「更多设置」两代页签已退场（沿革见 §0.2） |
| 展示清单 | **117 项** = 原常用设置白名单 42 项 + 二稿精选剩余 75 项（三稿删 33 项后）；全部与 omp TUI `/settings` 面板可见项同源（§1⑦） |
| 数据来源 | `omp config list`（人读文本）**+** `omp config list --json` 两路合并：文本定顺序 / 分组 / 枚举取值表，JSON 定类型 / 值 / 上游说明（后端返回**全量目录**、不裁剪，过滤在前端） |
| 写入 | `omp config set <key> -- <value>` / `omp config reset <key>`——**只写全局层**（cwd 钉 agentDir）、写完回读 |
| 与 V8 的关系 | V8 的「常用设置」白名单（41 项日常动线）在三稿**并入本页**（机制从「前端手写 spec」换成「catalog 驱动 + 展示清单过滤」）；V8「不摆一个 500 项的配置浏览器」的口径仍守住——界面只显示 117 项 |

### 0.2 沿革（同日三稿）

- **一稿**：`get_omp_settings_catalog` 把 519 项全量铺进「全部设置」页——机械上正确
  （见 §4 的控件全量核对与真机走查），但 519 项里 **132 项 omp 自己都不在 TUI 设置面板里
  给用户改**（凭证、gc、租约秒数、状态行分段……），噪声大。
- **二稿**：收敛为 **108 项精选**（从 TUI 可见的 387 项里挑高频），与常用设置 42 项零交集；
  页签更名「更多设置」。
- **三稿（现行）**：按用户口径**删去 33 项**（外观零碎 2 / 附加工作区目录 / 分支摘要 /
  供应商整组 8 / Shell 与脚本的补充项 4 / worktree 目录 / 外部命令来源 4 / 工具整组 12），
  并把两页**合并成一页**——「常用设置」成为唯一设置面。被删的 33 项由
  `settingsList.test.ts` 钉住**不得回流**；渲染机制沿用二稿（catalog 驱动），
  原「常用设置」的前端手写白名单（`ompSettings.ts`）与批量读命令（`get_omp_settings`）
  随合并退场。

## 1. 上游事实（omp 18.4.4 本机实测，2026-09-30）

**① 人读 `omp config list` 是分组与枚举取值的唯一来源。**

```
Settings:

[appearance]
  theme.dark = dark-catppuccin (string)
  symbolPreset = nerd (unicode|nerd|ascii)
  colorBlindMode = false (boolean)
...
```

- 11 个 `[section]` 标题：`appearance` / `context` / `files` / `interaction` / `internal` / `memory` /
  `model` / `providers` / `shell` / `tasks` / `tools`；
- 行格式 `  key = value (…)`，与 JSON 的键**一一对应**（实测 519 行 ↔ 519 键，无单边项）；
- **尾括号含 `|` 才是枚举取值表**（89 个枚举全部带表）；普通类型是 `(boolean)` / `(number)` /
  `(string)` / `(array)` / `(record)`；值里的括号（`(not set)`）不在行尾，解析不歧义。

**② 三种特殊值各有标识。**

| 形态 | 人读文本 | JSON | 含义 |
|---|---|---|---|
| 未设置 | `(not set)` | **没有 `value` 字段** | 上游没有显式值（实测 38 项） |
| 显式空值 | `=  (string)`（等号后为空） | `"value": ""` | 用户显式设成空串（与「未设置」不同；`reset` 才回到未设置） |
| 脱敏 | `********` | `{"redacted": true}`（无 value） | 令牌 / 凭证类键（实测 1 项：`images.urls.credentials`） |

**③ 脱敏只作用于 `list`，`get` 不脱敏。** 实测 `omp config set searxng.token -- zzz-secret` 后：
`config list` 显示 `********` + JSON `redacted: true`，但 `config get searxng.token --json` **返回明文**。
壳侧口径：目录里这类键**不给编辑器**（值读不到，盲写等于覆盖凭证），只留「恢复默认」，
提示去终端 `omp config set`（展示清单里已无此类键，此路径为防御性保留）。

**④ `config set` 对复合类型走 JSON 文本。** 实测：

```
omp config set ttsr.disabledRules -- '["a","b"]'   → ok（get 回 ["a","b"]）
omp config set ttsr.disabledRules -- 'a,b'         → Error: Invalid array JSON: a,b（退出码 1）
omp config set modelTags -- '{"a":"b:c"}'          → ok（get 回 {"a":"b:c"}）
omp config set modelTags -- 'a=b'                  → Error: Invalid record JSON: a=b
omp config set browser.cdpUrl -- ''                → ok（get 回 ""）
```

**⑤ `config reset` = 写回 schema 默认值；可缺省的键是「删除」。** 实测
`config reset browser.cdpUrl` → `Reset browser.cdpUrl to (not set)`，配置文件里该键消失；
`config reset ttsr.disabledRules` → 回到 `[]`。界面上的「恢复默认」用的就是它。

**⑥ 类型分布与耗时。** JSON `type` 分布（519 项全体）：boolean 205 / number 130 / enum 89 /
string 53 / array 28 / record 14；展示清单 117 项的类型分布：boolean 76 / number 8 / enum 30 /
string 3（array / record 无）。两路 `config list` 各 ~0.2s，合并目录一次 ~0.4s。

**⑦ omp 的 TUI 设置面板 = 上游对「用户可改」的官方边界。** omp 二进制里
`packages/coding-agent/src/config/all-settings.ts` 定义全部设置项，每项可选带一段
`ui: { tab, group, label, description }` 元数据；`settings-ui.ts` 的 `createSettingsHost`
**只渲染带 `ui` 的项**。本机 18.4.4 实测（`strings -a` 提取 + 正则配对：`ui: {` 块向上找最近的
`id: "…"`、向下取 `tab` / `group` / `label`）：

- **387 项带 `ui`**（`tab` 分布：tools 68 / model 55 / interaction 50 / appearance 38 /
  providers 38 / tasks 34 / memory 30 / context 30 / files 27 / shell 17；**没有 internal**）；
  提取结果与 519 键一一核对，**0 噪音**；
- **132 项无 `ui`**（TUI 设置面板不显示）：凭证（`auth.broker.token` / `searxng.token` /
  `mnemopi.embeddingApiKey`…）、机器状态（`setupVersion` / `extensions` / `enabledModels` /
  `modelRoles` / `cycleOrder`…）、细调（`gc.*` / `memories.stage1*` 时序 / `thinkingBudgets.*` /
  `statusLine.leftSegments`…）；
- **`omp config list --json` 不暴露 `ui` 元数据**（只有 `value` / `type` / `description`）
  ——所以展示清单只能是壳侧静态表；提取口径记在本节，供上游升级后重新核对。

**⑧ 三个键是 `string` 但取值有限（`ui: { options: "runtime" }`）。** omp 对
`theme.dark` / `theme.light` / `composer.shape` 的定义都是 `type: "string"` +
`ui.options: "runtime"`（全量里仅此三处）——TUI 设置面板给它们渲染下拉、选项运行时求值
（`settings-ui.ts`：主题取 `availableThemes`、形态取内置八项）。壳侧同口径复刻：

- **主题列表**（`packages/tui/src/theme` 的 `getAvailableThemes`）：
  `Object.keys(内置注册表) ∪ <agentDir>/themes/*.json（去 .json 后缀）`，排序；目录读不到按
  「没有自定义主题」处理。内置注册表 = `{ dark, light, ...defaults }`，本机 18.4.4 = **102 个**
  （`dark` + `light` 两个默认主题 + `defaults/` 的 100 个；与 `theme/defaults/*.json` 文件清单
  交叉核对零差异）；
- **`composer.shape`**：内置八形态 `band | box | claude | pi | borderless | rule | field | rail`
  （Status Band (Default) → Accent Rail；插件还能注册更多——壳侧只含内置）；
- 壳侧实现：后端命令 `list_omp_themes`（`themes.rs`：内置 102 个 ∪ `<agentDir>/themes`，
  排序去重），前端 `runtimeChoiceValues`（`settingsList.ts`）把主题列表 / 八形态接进下拉
  （当前值不在表里时原样补一条；主题列表为空——命令失败——退化成文本框）。

其余口径沿用 V8 实测：负数 / 以 `-` 开头的值必须 `--` 分隔；enum 必须精确匹配（报错原文透传）；
`list` / `get` 是「defaults ← global ← project」合并后的**有效值**，所以 cwd 一律钉 agentDir。

## 2. 设计

**合并两路（后端）。** `get_omp_settings_catalog` 并发跑 `config list` 与
`config list --json`：文本定**顺序 / 分组 / 枚举取值表**，JSON 定**类型 / 值 / 说明**；文本里
没有的键（理论上不该有）按 JSON 顺序补在末尾、分组留空；文本那一路失败时退化成纯 JSON
（无分组 / 无取值表），不把整页打不开。**后端不裁剪**——过滤在前端（`settingsList.ts`），
后端保持「上游目录的忠实映射」。

**展示清单（`src/lib/settingsList.ts`）。**

- **117 项**，三稿分布（面板显示的分组 = 上游分组，两项经归位修正见下）：
  appearance 23 / interaction 24 / files 16 / tasks 13 / model 12 / context 8 / memory 8 /
  tools 8 / shell 5；
- **维护契约**（`settingsList.test.ts` 守着）：无重复；每一项在名称表里都有中英短名；
  规模 100–140 项（防扩回全量）；**三稿删掉的 33 项不得回流**（写死数组断言）；
  顺序照上游人读清单（组内顺序 = `omp config list` 的顺序）；
- **分组归位**（`SETTING_SECTION_OVERRIDES`）：上游把 `compaction.autoContinue` 与
  `skills.enabled` 归在 `internal`（那组其余全是凭证与机器状态），按原常用设置页的归类
  显示为 `context` / `tasks`；
- 上游升级后新键**不会自动进来**——判断新键值不值得进本页时，先看它在不在 TUI `/settings`
  面板里（§1⑦ 的提取口径）。

**界面（`GeneralSettingsPanel`）。**

- **只显示展示清单的键**：`catalog.items.filter((i) => SETTINGS_LIST_SET.has(i.key))`
  （并做分组归位）再交给 `groupCatalog`——**空组不渲染**（如 `internal`），
  分组 / 搜索 / 计数全部基于过滤后的集合；
- **分组默认展开**（可见性优先，折叠是用户的选择）＋「全部展开 / 全部收起」＋计数；
- **行内容**：第一行是**短名**、第二行是 `键名 · 类型 · 状态`（+ 行内标注）。短名来自
  `src/lib/ompSettingNames.ts` 的**全量名称表**（519 项 × 中英，顺序照上游清单；展示清单是它的
  子集，测试钉住全覆盖）；上游新增键没有条目时回退键名；
- **行内标注**（`SETTING_NOTES`）：`仅 TUI 生效`（`plan.enabled` / `goal.enabled` 是功能总闸，
  实测 RPC / 壳侧无可观测差异）/ 值为 `-1` 时的「-1 = 默认」（`temperature` /
  `compaction.thresholdPercent`）；
- **搜索**：键前缀 → 键子串 → **名称子串** → 说明子串 四档排序（同档保持上游顺序；名称 = 当前
  语言的短名）；搜索时忽略折叠态、命中按分组切开且组的先后 = 最佳匹配的先后；无命中给
  「没有匹配的设置」+ 清空按钮；
- **六种编辑器**：boolean → `Switch`（点击即写）；enum → `EnumSelect`（选项来自取值表，当前值
  不在表里时原样补一条；**enum 却没有取值表**时 `choiceOptions` 给空数组、退化成文本输入框——
  不是「只有当前值一个选项」的残废下拉）；**string 但取值有限的键**（`theme.dark` /
  `theme.light` / `composer.shape`，§1⑧）同样是 `EnumSelect`：主题列表 = `list_omp_themes`、
  形态 = 内置八项；number → 数字框（blur / Enter 提交，解析不出数字就丢弃草稿）；
  string → 文本框（同提交时机；与当前值相同不发请求）；array / record → JSON 文本区
  （**本地先 `JSON.parse` + 形状校验**，过了才发请求）——展示清单里没有此类键，
  此路径是渲染器按上游 schema 类型分派的通用能力；
- **国际化**：页面自身的文案全部走字典（分组名 `sg_*`、六种 schema 类型名 `settingKind*`、
  按钮 / 空态 / 错误 / JSON 编辑区的无障碍名）——**未知分组 / 未知类型回退上游原文**；
  **下拉选项的 label 走 `OPTION_LABELS`**（`settingsList.ts`：普通词翻界面语言、
  多个键重复出现的取值共享公共字典键 `svOn` / `svOff` / `svAuto` / `svDefault` / `svNone`；
  **专有名词与档位名原样**——主题名、`xhigh` / `max`；字典里的每个 `sv*` 键都必须被翻译表引用，
  由测试钉住无孤儿）；**上游数据不进字典**（配置键、配置值、上游说明原文），
  行首提示里明说「说明是上游英文原文，不做翻译」（与 V8 同口径）；
- **状态标记**（键名下第二行）：`<type> · 未设置` / `<type> · 值已隐藏`——脱敏键不渲染编辑器；
- **写入**：乐观更新（开关 / 下拉立刻有反馈）+ 失败回滚 + 回读覆盖；
  刷新 / 重新挂载会用回读后的真实值。

**边界（§5）：** 不做项目级写入；不检测「某个键是否在 config.yml 里显式写过」（上游只给合并后
有效值）；脱敏键不给盲写；不做导入导出 / diff / 按键导航。

## 3. 实现

| 层 | 文件 | 内容 |
|---|---|---|
| 后端 | `src-tauri/src/settings.rs` | `CatalogItem` / `SettingsCatalog` / `parse_catalog` / `trailing_options` / `split_list_row` / `valid_key` / `value_arg`；命令 `get_omp_settings_catalog`（`tokio::join!` 两路 + 合并，返回**全量目录**、不裁剪）/ `set_omp_setting` / `reset_omp_setting`（含单测与真实 omp 慢测试）。三稿删掉了批量读命令 `get_omp_settings`（`pick_settings` / `check_keys` / `KEYS_MAX` 一并退场——前端不再按白名单批量读，改读全量目录） |
| 后端（主题） | `src-tauri/src/themes.rs`（+ 单测；`main.rs` 注册） | 命令 `list_omp_themes`：内置注册表（`BUILTIN_THEMES`，本机 18.4.4 = 102 个）∪ `<agentDir>/themes/*.json`（去后缀），排序去重；目录缺失按「没有自定义主题」（与上游 `getAvailableThemes` 同口径） |
| IPC | `src/shared/ipc.ts` / `types.ts` / `api.ts` | `getOmpSettingsCatalog` / `listOmpThemes` / `setOmpSetting` / `resetOmpSetting`；`OmpCatalogItem` / `OmpSettingsCatalog`（与 Rust 同构，camelCase） |
| 展示清单 | `src/lib/settingsList.ts`（+ `settingsList.test.ts`） | **117 项清单**（顺序照上游清单）+ `SETTINGS_LIST_SET` + `SETTING_SECTION_OVERRIDES`（分组归位）+ `SETTING_NOTES`（行内标注）+ `OPTION_LABELS`（选项翻译）+ `COMPOSER_SHAPES` / `runtimeChoiceValues`（§1⑧）；维护契约见 §2.2 |
| 名称表 | `src/lib/ompSettingNames.ts`（+ `ompSettingNames.test.ts`） | **519 项 × 中英短名**（`[zh, en]`，顺序照上游清单）。契约由测试守着：① 覆盖率——18.4.4 的 519 键快照每条都要有条目；② 无幽灵键；③ 中英都非空、英文名不含中文 |
| 前端逻辑 | `src/lib/allSettings.ts`（+ `.test.ts`，15 条） | `groupCatalog`（顺序照上游、未归组放最后、空组不渲染）、`filterCatalog`（四档打分 + 稳定排序）、`choiceOptions`（enum 取值表 / string 运行时表两条来源 + `OPTION_LABELS` 翻译；空表退化成文本输入）、`parseNumberDraft`、`jsonDraftFrom` / `parseJsonDraft`、`jsonPreview`、`SECTION_LABEL_KEYS`（`sg_` 字典键；未知分组回退机器名） |
| 界面 | `src/components/settings/GeneralSettingsPanel.tsx`、`src/components/SettingsPage.tsx`、`src/lib/locale.ts` | 「常用设置」页（唯一设置面；挂载时并行拉 catalog 与 `list_omp_themes`，主题列表失败静默）；设置页 8 个页签（omp 组 5 个 + 本应用组 3 个）；中英文案（`allSettings*` / `sg_*` / `sv*` / `ompSettingsTuiOnly` / `ompSettingsDefault`） |

## 4. 验证

**沿革仍有效部分：**

- **Rust**：`cargo test settings` 8 项全过（catalog 合并 / 回退 / 防御、`value_arg` 容器序列化、
  `trailing_options` 只认 `|` 表、`valid_key`）；`cargo test -- --ignored settings_catalog`
  真实 omp 慢测试：`sections=11 items=519 enums=89 redacted=1 notSet=38`。
- **控件类型全量核对**（本机 omp 18.4.4 真实 `config list` 两路）：519 项的控件与上游 schema
  类型一一对应——205 boolean → 开关、89 enum（**全部带取值表**）→ 下拉、130 number → 数字框、
  53 string → 文本框、28 array + 14 record → JSON 编辑器；文本与 JSON 两路键集完全相等。

**三稿核对：**

- **展示清单**（本机真实目录）：117 项**全部存在于 519 键目录**；三稿删掉的 33 项**不在清单里**
  （`settingsList.test.ts` 钉住）；每项都有中英短名；分组分布 appearance 23 / interaction 24 /
  files 16 / tasks 13 / model 12 / context 8 / memory 8 / tools 8 / shell 5。
- **前端**：`pnpm check`（typecheck / lint 0 警告 / vitest 333 项 / `e2e:ipc` **71 命令**双向一致）；
  `settingsList.test.ts` 8 条（117 项无重复 / 名称覆盖 / 规模 / 33 项不回流 / 翻译表 / 孤儿键 /
  标注表 / `runtimeChoiceValues`）、`allSettings.test.ts` 选项用例、`GeneralSettingsPanel.test.tsx`
  组件用例（失败重试 / 搜索 / 枚举浮层）全绿。
- **主题与形态**：`cargo test themes` 3 项（102 内置表 / 自定义目录合并排序 / 去重容错）。
- **真浏览器 + Tauri mock 走查**（`pnpm build` + `pnpm preview` + 真 Chromium，目录数据 =
  本机真实 519 项合并，主题列表 = 真实 102 个）：「常用设置」单页显示 **117 项 / 9 个分组**
  （`internal` 组不出现——两项已归位）；行内标注显示（`plan.enabled` → 「仅 TUI 生效」）；
  枚举下拉带翻译（`tools.approvalMode` → 「每次询问 / 写入时询问 / 全部自动通过」）；
  主题下拉 102 项、形态下拉八个中文形态；搜索 / 全展开收起正常。

## 5. 边界（不做）

- **只显示展示清单**（117 项）：完整清单在终端 `omp config list` 看（页内文案里明说）；
  上游升级后的新键不进本页，除非手工核对后加进 `settingsList.ts`（先看它在不在 TUI
  `/settings` 面板里）。
- **不做项目级写入**：`config set` 只落全局层；项目 `.omp/config.yml` 的覆盖优先于它。
- **不检测「显式设置过」**：上游 `list` / `get` 只给合并后的有效值——「未设置」只表示
  **上游没有值**（schema 默认兜底）。
- **脱敏键不给编辑器**：令牌 / 凭证类键（`redacted`）值读不到，盲写等于覆盖凭证；
  只留「恢复默认」与去终端 `omp config set` 的提示（展示清单里已无此类键）。
- **不做**导入 / 导出、配置 diff、按键导航、虚拟滚动（分组折叠 + 搜索已够快）。
- 不动 omp 自己的 TUI 白名单语义（`enabledModels` 等仍由上游解释，见 `docs/v12-schedule.md` §6）——
  它们在展示清单之外，壳侧不代偿。
