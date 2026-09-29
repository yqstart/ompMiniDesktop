# ompMiniDesktop 二十三期（V23）：设置页「插件」与「技能」两个面板

> 目标：设置页补上 omp 的**插件面板**与**技能面板**——插件（`omp plugin`）的清单 / 启停 / 可选特性 /
> 安装 / 卸载 / 体检，技能（`omp skill list`）的范围发现 / SKILL.md 预览 / 逐项启停。
> 上游口径全部实测（omp 18.3.5，2026-09-28），实测方法与结论见 §1 / §5。
> 这是 V11 范围边界里明确列为「不做」的两块（`插件 / Skill / MCP / Hook 管理`）的**部分收回**：
> **插件与技能进场，MCP / Hook 仍在范围外**。

## 0. 结论先行

- **两个新页签挂在设置页「omp」组**（常用设置 / 模型 / **插件** / **技能** / 记忆 / 供应商用量，
  2026-09-29 起「供应商用量」不再占页签、入口挪到标签栏右上角 `Gauge` 键，omp 组剩五项），
  与既有页签同壳同款：单个 `section` 卡片 + 页首说明 + 右上角操作组（范围选择 / 主操作 / 刷新）。
- **两页都有「范围」选择器（全局 / 某个项目）**——这不是壳侧的选择，而是 omp 的口径：
  `omp plugin list` 与 `omp skill list` 的**项目级可见范围都由 cwd 决定**（项目 `package.json` 里的
  插件、项目级市场安装、`.omp/skills` 等项目技能）。全局档 = 用户级（插件钉 agentDir、技能钉家目录）。
- **插件特性是「整组覆盖写」**：`enabledFeatures: null` 表示按每个特性自己的 `default` 生效，
  逐项 `--enable/--disable` 会从 `[]` 出发把默认开启的特性一起丢掉（实测）——壳侧算当前生效集合、
  走 `--set` 整组写，并在写过之后标「特性已自定义」。
- **不做「安装预览」**：`--dry-run` 只对 npm / git / 本地路径可靠，**对市场条目上游会照装**
  （官方文档明写不适用）——一个会真装的「预览」按钮是谎言，所以改成信任提示 + 二次确认 + 结果提示。
- **技能的逐项启停写的是 omp 全局配置**（`disabledExtensions: ["skill:<名字>"]`，与 TUI `/extensions`
  的开关同一个键），**按名字对所有项目生效**；被停用的技能**上游在发现阶段就过滤掉了**，
  所以「已停用」行只能从这份配置读——没有描述与路径（上游行为，界面照实说）。
- 后端只经 `omp` CLI（`plugin` / `skill` / `config`），**不直接读 / 写 omp 的插件目录、lock 文件与
  注册表**；写操作（安装 / 卸载 / 启停 / 特性）共用一把 `extensions_edit` 锁串行。
- 前端纯逻辑（特性集合换算、体检汇总、来源标签、分组、范围选项）在 `lib/plugins.ts` /
  `lib/skills.ts` / `lib/panelScope.ts`，都有单测；两个面板本身走真实数据形状的界面核对（§5）。

## 1. 上游实测（omp 18.3.5，2026-09-28）

### 1.1 插件面：`omp plugin` 的形状与三个陷阱

**形状**（`omp plugin list --json`）：

```json
{
  "npm": [
    { "name": "@oh-my-pi/exa", "version": "1.3.3710", "path": "…/plugins/node_modules/@oh-my-pi/exa",
      "manifest": { "description": "…", "features": { "search": { "default": true, "description": "…" } } },
      "enabledFeatures": null, "enabled": true }
  ],
  "marketplace": [
    { "id": "name@market", "scope": "user", "entries": [{ "version": "2.0.0", "enabled": true, "installPath": "…" }],
      "shadowedBy": "project" }
  ]
}
```

- npm / link 条目 = 包名 + 版本 + 安装路径 + manifest（`omp` / `pi` 字段，含可选特性）+ **运行态**
  （`enabledFeatures` / `enabled`）；结构坏掉的条目（没有 name）**跳过单条**，不整页报错。
- 市场条目按 scope 一条：`entries[0].version` 是装的版本，`enabled` 在注册表的每条记录上，
  `shadowedBy: "project"` = 用户级那份被项目级同名安装遮住。
- 插件目录实测：默认 `~/.omp/plugins`（`omp plugin doctor` 会打印路径）；`--profile <p>` 下是
  `~/.omp/profiles/<p>/plugins`——**这是本次实测能把副作用完全隔离的原因**（§1.3）。

**陷阱 1：`enabledFeatures: null` 不是「全关」，是「按 default」**。实测 `@oh-my-pi/exa`（默认开
`search`、关其它），`omp plugin features <p> --enable web` 之后回读是 `["web"]`——**默认开启的
`search` 被丢掉了**（上游从 `?? []` 出发）。所以壳侧不逐项 enable / disable，而是算「当前生效集合」
（`enabledFeatures ?? 各特性的 default`）再 `--set` 整组。

**陷阱 2：空集合写不进去**。`--set` 的值在上游是真值判断：`--set ""` 会走「只读」分支不写任何东西，
所以「关掉最后一个特性」需要 `--set " "`（一个空格经 `split(",").map(trim).filter(Boolean)` 解析成
空集合，实测回读 `[]`）。`set_plugin_features` 里对空的处理就这一行，有单测。

**陷阱 3：`--dry-run` 对市场条目无效**。官方文档：`--dry-run` 「previews npm, Git, and local-path
installs … It does not apply to marketplace installs」，而 CLI 实现里市场分支 dry-run 之后仍会走到
install（`if (a) continue` 在上游返回 undefined 时不生效）。壳侧因此**不暴露预览**。

**其余口径**：

- `omp plugin enable|disable <name> [--scope user|project]`：npm / link 插件不认 scope；
  `名字@市场名` 双份安装时**必须给 scope**（不给上游直接报错）。
- `omp plugin install <source> [--scope user|project]`：源可以是 npm 包（可带版本）、git 简写
  （`github:` / `gitlab:` / …）、完整 URL、本地目录（软链进来）、市场条目；**`--scope` 只对市场条目
  有效**（npm / git / 本地路径会被忽略并告警），项目级走的是「**当前 cwd** 最近的项目」的
  `.omp/plugins/installed_plugins.json` —— 所以壳侧在 scope=project 时**强制要求一个项目目录**，
  不猜。
- `omp plugin doctor [--fix] --json` → `[{name, status: ok|warning|error, message, fixed?}]`；
  人读模式在有 error 时 `exit 1`，**带 `--json` 时退出码 0**（所以体检走「不看退出码」的捕获口径）。

### 1.2 技能面：发现按 cwd、启停按名字

**形状**（`omp skill list [dir] --json`）：

```json
{ "skills": [ { "name": "web-search", "description": "…", "filePath": "…/SKILL.md", "baseDir": "…",
                "source": "agents:user", "hide": false } ],
  "warnings": [ { "skillPath": "…", "message": "name collision: …" } ] }
```

- `source` = `<provider>:<level>`，实测出现过的 provider：`native`（omp 原生目录，`<agentDir>/skills`
  与 `.omp/skills`）、`agents`（`~/.agents`、`.agents`）、`claude`、`codex`、`omp-plugins`（插件内置）、
  `omp-managed`（自动学到的）、`custom`（`skills.customDirectories`）、`opencode`、`github`。
- `hide: true`（frontmatter `hide` / `disable-model-invocation`）= 不参与自动匹配、只能显式调用；
  它**照常出现在列表里**（与「已停用」不同）。
- **发现范围 = cwd**：项目级技能由 omp 从该目录向上走到仓库根逐级找；实测 `omp skill list ~ --json`
  只回用户级技能——这给了「全局档」一个干净的定义。
- 逐项启停 = `disabledExtensions` 数组里的 `skill:<名字>`（TUI `/extensions` 开关写的就是它），
  按名字匹配、不分 provider / scope。**被停用的技能不出现在 `omp skill list` 里**（上游发现阶段就
  过滤），所以「已停用」行只能来自配置，拿不到描述与路径——界面照实说明。
- 该键是 `array` 型，`omp config set disabledExtensions '<json 数组>'` 整组覆盖写（与 `cycleOrder`
  同款），`omp config list --json` 读回；壳侧一律钉 agentDir（= 全局层，与写入同层）。
- **走过的死路**：想用 `omp --config <overlay>` 覆盖 `disabledExtensions: []` 把停用项也列出来——
  实测 overlay **不覆盖数组键**（`config get` 仍回原值，技能列表也没变化），放弃。

### 1.3 实测环境：`--profile` 是干净的隔离沙箱

本次所有写操作（link / install / enable / disable / features / uninstall / `config set`）都在
`omp --profile v23probe …` 下做，实测：

- 配置层被隔离到 `~/.omp/profiles/v23probe/agent`（`omp --profile v23probe config path`）；
- 插件目录同样隔离（`plugin doctor` 报 `~/.omp/profiles/v23probe/plugins`）；
- **`~/.agents/skills` 这类用户级技能目录不被隔离**（profile 只换 agentDir），所以技能列表的
  探针仍能看到真实用户级技能——这也是核对「用户级来源」的现成样本。

跑完 `rm -rf ~/.omp/profiles/v23probe`，用户真实环境（`~/.omp/plugins/omp-plugins.lock.json` 等）
回到实测前状态。

## 2. 设计与实现

### 2.1 两个页签与「范围」选择器

- 设置页 `TAB_GROUPS` 的 **omp 组**变为：常用设置 / 模型 / **插件** / **技能** / 记忆 / 供应商用量
  （图标 `Plug` / `Puzzle`；V23 时共 9 页签，2026-09-29 起「供应商用量」退出页签面 → 8 页签）；本应用组不变。两页都是单 `section` 卡片，与记忆页同款版式。
- 页首右侧操作组：**范围下拉**（`EnumSelect`，全局 + 每个可用项目；选项值就是按钮上显示的文字，
  同名项目把路径并进 value 保证可区分）+ 主操作（插件页：体检 / 安装插件）+ 刷新。
- 范围 → cwd 的换算在 `lib/panelScope.ts`（`scopeChoices` / `scopeValue`，含单测）；项目被删或
  标记缺失时选择器自动回退全局（不把界面停在不存在的范围上）。
- 页首第二行照实写出**这次真正用的目录**（`PluginsView.cwd` / `SkillsView.cwd`），
  避免「范围是什么」只靠控件猜。

### 2.2 插件页

- **npm / 本地插件**一组：包名 + 版本 + 描述 + 安装路径 + 可选特性 chips + 启停开关 + 卸载；
  `已停用` / `特性已自定义` 是徽章，`已停用` 只在 `enabled: false` 时出现。
- **特性 chips**：每个特性一个 `aria-pressed` 按钮（颜色不作唯一信号，`title` = manifest 说明）。
  点击 → `lib/plugins.toggleFeature` 算「整组」→ `set_plugin_features` → 就地按回读的
  `enabledFeatures` 更新该行的生效值并标「已自定义」（不回读整份清单，省一次子进程）。
- **市场插件**一组：`名字@市场名` + 版本 + scope 徽章 + 被项目级遮住（`shadowedBy`）+ 启停 + 卸载；
  启停 / 卸载都把该行的 scope 原样回传（双份安装时上游要求）。
- **安装弹窗**：源输入 + 范围（用户级 / 项目级；项目级时给项目下拉，没有项目就禁用并说明）+
  信任提示（插件以你的身份运行）+ 市场提示（需要先 `omp plugin marketplace add`）；
  完成后关弹窗、用新清单替换、顶部给一行「已安装 xxx」+**生效时机**（新终端；已开会话要
  `/reload-plugins` 或重启）。
- **体检**：按钮 → `plugin_doctor(false)` → 结论块（`n 项正常 / n 项警告 / n 项错误`，已修复另计）；
  有 error 时出现「尝试修复」（`plugin_doctor(true)`）；结论块可关闭，不占常驻版面。

### 2.3 技能页

- 列表按作用域分组：**项目级（本范围发现）→ 用户级（所有项目可用）→ 其它来源**（provider 没给
  level 时原样列出）；行内按名字序（`lib/skills.groupSkills`，含单测）。
- 每行：名字 + 来源徽章（`用户级 · Agents 目录` 这类：level 走字典、provider 走字典，**未知 provider
  原样显示**）+ `仅显式调用`（`hide`）徽章 + 描述（两行截断）+ `SKILL.md` 路径，右侧是
  复制目录 / 在访达中显示 / 启停开关。
- **预览**：点行内名字展开 `SKILL.md` 正文（`read_skill_file`，后端只放行 `SKILL.md` 这个文件名、
  超 1MB 截断），Markdown 就地渲染（与记忆页同款链路，正文按不可信输入处理）。
- **已停用区**：名字 + `已停用` 徽章 + 启用开关，附一段说明（写的是全局配置、按名字生效、
  上游不再列出它所以没有描述与路径）。
- 底部**发现警告区**（同名冲突等），原样透传 `warnings`。

### 2.4 后端命令与锁

| 命令 | 上游调用 | 说明 |
|---|---|---|
| `list_plugins` | `omp plugin list --json` | `cwd` 决定项目级可见范围（缺省钉 agentDir） |
| `set_plugin_enabled` | `omp plugin enable\|disable <name> [--scope]` | 写完回读整份清单 |
| `set_plugin_features` | `omp plugin features <p> --set <a,b>` | 空集合走 `--set " "`（见 §1.1 陷阱 2），写完回读 |
| `install_plugin` | `omp plugin install <src> [--scope]` | 超时 10 分钟；`scope=project` 必须给项目 cwd |
| `uninstall_plugin` | `omp plugin uninstall <id> [--scope]` | 同上 |
| `plugin_doctor` | `omp plugin doctor [--fix] --json` | 用「不看退出码」的捕获口径，解析失败时把 stderr 尾部当 hint；**`--fix` 会动插件目录，也拿 `extensions_edit` 锁** |
| `list_skills` | `omp skill list <dir> --json` + `config list --json` | 目录校验（必须存在）+ 停用名单（全局层） |
| `set_skill_enabled` | `config set disabledExtensions '<json>'` | 读 → 改 → 整组写 → 回读；**其它条目原样保留** |
| `read_skill_file` | 直接读文件 | 只允许 `SKILL.md`、只读、1MB 上限、UTF-8 边界截断 |

- 校验：插件名 / 源 / 技能名都钉形状（长度、控制字符；特性名另拒逗号——那是上游的分隔符），
  范围目录必须存在且为绝对路径；**参数经 `Command::args` 传参、不经 shell**。
- 锁：`AppState.extensions_edit` 覆盖上表的写操作——插件 install / uninstall 会动同一个插件目录与
  lock 文件，技能的 `disabledExtensions` 是读-改-写同一份 config.yml（`--fix` 的体检也拿这把锁）。
- 技能的整组写回是「读到什么写回什么」：`plugin:` / `rule:` / `tool:` 等别人的停用项与非字符串脏项
  一律原样带走，只替换 / 删除目标那一条 `skill:<名字>`。
- 超时口径：`run_omp_capture` 一律 `kill_on_drop(true)`——超时后子进程必须跟着死，否则孤儿安装进程
  会绕过 `extensions_edit` 锁继续写插件目录（并让「失败」的提示失真）。
- `providers.rs` 顺手抽出 `run_omp_in_timeout` 与 `run_omp_capture`（原 `run_omp_in` 行为不变），
  安装类命令用它放宽到 10 分钟、体检用它容忍非零退出码。

## 3. 源码结构变化

新增：

```
src-tauri/src/plugins.rs             # 插件后端（列表 / 启停 / 特性 / 安装 / 卸载 / 体检 + 单测 + 真实 omp 慢测试）
src-tauri/src/skills.rs              # 技能后端（发现 / 逐项启停 / SKILL.md 读取 + 单测 + 真实 omp 慢测试）
src/components/settings/PluginsPanel.tsx   # 设置 ›「插件」
src/components/settings/SkillsPanel.tsx    # 设置 ›「技能」
src/lib/plugins.ts                   # 特性集合换算 + 体检汇总（含单测）
src/lib/skills.ts                    # 来源解析 / 分组 / 停用排序（含单测）
src/lib/panelScope.ts                # 两个面板共用的「全局 / 项目」范围选项（含单测）
```

改动：`shared/{ipc,api,types}.ts`（9 个新命令与类型）、`commands/mod.rs`（`extensions_edit` 锁）、
`settings.rs` 之外仍无新增写文件路径、`providers.rs`（运行器重构）、`SettingsPage.tsx`（两个页签）、
`lib/locale.ts`（中英各 ~100 键）、`scripts/e2e-ipc-selfcheck.mjs`（新模块纳入实现扫描）。

## 4. 完成口径（已达成）

- 设置页出现「插件」「技能」两个页签，都在 omp 组内；两页都能切「全局 / 项目」范围。
- 插件页：列出 npm / 本地与市场两组插件；启停、特性开关（整组写）、卸载（二次确认）、安装（源 +
  范围 + 项目选择）、体检（+ 尝试修复）全部可用；运行中锁控件，失败原样显示上游错误。
- 技能页：按作用域分组列出发现结果；逐项停用 / 启用；`SKILL.md` 展开预览；复制目录 / 在访达中显示；
  已停用区与发现警告照实呈现；停用后该行从发现列表消失（与 omp 的真实行为一致）。
- 所有写操作回读真相（插件整份清单 / 技能停用名单），不显示乐观值。
- `pnpm check`（typecheck + lint 0 警告 + 282 单测 + IPC 双向自检 66 命令）与
  `cargo test --locked`（121 单测）全绿；两个新模块另有 `--ignored` 的真实 omp 冒烟（只读解析）。

## 5. 实测记录（2026-09-28）

**上游 CLI 探针**（全部在 `--profile v23probe` 下，探针插件与探针项目自建自清）：

| 探针 | 结果 |
|---|---|
| `plugin link` + `list --json` | npm 条目形状如 §1.1（`enabledFeatures: null`） |
| `plugin features <p> --json` | `{plugin, enabledFeatures, availableFeatures}`；`--set web` 覆盖默认项 |
| `plugin features <p> --set " "` | 回读 `[]`（空集合可写，见陷阱 2） |
| `plugin disable/enable` | `✔ Disabled/Enabled`，`list --json` 的 `enabled` 跟着变 |
| `plugin install @oh-my-pi/exa --json` | 回包就是 npm 条目形状（带 manifest.features） |
| `plugin install <本地目录> --dry-run --json` | `{dryRun: true, action: "link", path}` |
| `plugin uninstall <name> --json` | `{uninstalled: "…"}` |
| `plugin doctor --json` | 数组；有 error 时退出码仍是 0 |
| `skill list <探针项目> --json` | 项目技能 `native:project` + 用户级 `agents:user` + 插件技能 `omp-plugins:user` 同时在列 |
| `skill list ~ --json` | 只剩用户级（全局档的定义） |
| `config set disabledExtensions '["skill:web-search"]'` | 写入成功；随后 `skill list` 里该技能**消失** |
| `--config <overlay disabledExtensions: []>` | **不生效**（数组键不被 overlay 覆盖），该路线放弃 |

**界面核对**（`pnpm build` + `vite preview` + Chromium 注入 `window.__TAURI_INTERNALS__` mock，
`evaluateOnNewDocument` 注入 + 导航；mock 覆盖启动引导与两个面板的全部命令，调用日志镜像到
`document.documentElement[data-mock-calls]`——isolated world 读不到 main world 的 JS 属性，DOM 是共享的）：

- 页签面：设置页 9 个页签（当时口径；2026-09-29 起 8 个），omp 组顺序为 常用设置 / 模型 / 插件 / 技能 / 记忆 / 供应商用量。
- 插件页：两段列表渲染正确（含 `已停用`）；特性 chip 点击 → `set_plugin_features {plugin:"@oh-my-pi/exa",
  features:["search","web"]}`（**保住了默认开启的 search**）且行上出现「特性已自定义」；体检 →
  `plugin_doctor {fix:false}`，结论块显示 `3 项正常 / 1 项警告 / 1 项错误` 与逐条明细，出现「尝试修复」
  →`{fix:true}`；市场行开关 → `set_plugin_enabled {name:"foobar@acme-market", enabled:false, scope:"user"}`；
  卸载 → 确认浮层（标题带插件名 + 不可撤销说明）→ `uninstall_plugin {id:"@oh-my-pi/exa", scope:null}`；
  安装弹窗：用户级 → `{source, scope:null, cwd:null}`，切项目级自动带出项目下拉 →
  `{source:"./local-plugin", scope:"project", cwd:"/Users/yanqi/Desktop/WorkSpace/ompMiniDesktop"}`，
  完成后弹窗关闭 + 「已安装 …」提示；中英双语截图核对版式。
- 技能页：范围默认全局（`list_skills {cwd:null}`）→ 显示 `用户级` 分组 + 已停用名单 + 发现警告；
  展开 `proj-skill` → `read_skill_file {path:"…/proj-skill/SKILL.md"}` 且标题与代码块渲染出来；
  停用 `web-search` → `set_skill_enabled {name:"web-search", enabled:false}`，该行从发现列表消失、
  已停用区变 2 项；启用 `old-skill` → `{enabled:true}` 并触发一次重新发现（`list_skills` 第二次）。
- **桌面权限限制**：本机 omp 进程的屏幕录制 / 辅助功能权限均未授予（`computer.capabilities()` 全
  `denied`），所以界面核对走上面这条浏览器 mock 路线（与 V16 / V21 / V22 记录同一条路线）。

### 5.1 二轮修订（同日，按两轮代码评审反馈）

评审（后端 + 前端各一轮）提出的问题全部处理，改动后重跑了同一套界面核对：

| 级别 | 问题 | 修法 |
|---|---|---|
| P1 | `run_omp_capture` 超时不杀子进程（`timeout` 只 drop future）——孤儿安装进程会绕过 `extensions_edit` 锁继续写插件目录，且「失败」提示失真 | 加 `kill_on_drop(true)`（与仓里其它 spawn 同口径） |
| P1 | 安装到**另一个范围**后整份替换清单 → 列表与范围选择器对不上 | 装完若目标范围 ≠ 当前范围就**把范围切过去**（`setScopePath`）再重拉；同范围才用回读结果 |
| P1 | `SKILL.md` / 记忆正文里的 `<a href>` 会把 webview 导航走（应用被顶掉） | 新增共享 `MarkdownLink`（渲染成按钮 + `openUrl` 交系统浏览器），**技能页 / 记忆页 / 更新说明**三处一并换掉 |
| P2 | `install_plugin` 与在用初始加载交错时新装插件被旧响应抹掉 | 安装也参与 `loadVersion` 协议（开始时 +1、落地前校验） |
| P2 | 启用技能后的重拉可能被下一次启停顶掉 → 刚启用的技能从两区同时消失 | 启用后 `setRefreshing` + `setReloadKey`（重拉期间写控件锁住，串行到底） |
| P2 | 预览乱序（先点慢的再点快的）会让展开区永久空白 | `openKeyRef` 校验：响应落地前确认「当前展开的还是这个 key」 |
| P2 | 安装中弹窗完全关不掉（最坏 10 分钟） | 允许关闭（安装继续在后台跑，完成时页面给结果 + 明确提示） |
| P2 | 复制目录的成功反馈只有颜色 | 图标换对勾（形状信号）+ 可访问名跟着换 |
| P2 | enable / disable 缺「项目级必须给项目目录」守卫 | 与 install / uninstall 同款守卫（宁可报错不猜） |
| P2 | `plugin doctor --fix` 是写操作却不拿锁 | `--fix` 时拿 `extensions_edit` |
| P2 | 技能整组写回会丢掉 `disabledExtensions` 里的非字符串脏项 | 改成在原始 JSON 数组上增删（只替换/删除目标那一条，其余原样带走） |
| P2 | `read_skill_file` 先整读再截断（病态大文件吃内存） | 先看大小、只读「上限 + 1」字节（`read_text_prefix`，含单测） |
| P2 | 读取在途时放行写 → 读的旧结果覆盖写后的新清单 | 统一互斥：`lock = busy \|\| refreshing`，读在途时行内写控件锁住（实测：在途点击开关不产生任何写请求） |
| P3 | 插件名不拒首尾空白；市场条目 `entries: []` 与缺省口径不一致；特性名无长度 / 数量上限 | 三者都钉死（空白即非法、空数组与缺省一律按「启用」显示、特性名 ≤256 且 ≤200 个）；`--fix` 成功后重拉清单 |
| P3 | 项目被移除后范围选择器显示「全局」但请求仍用旧路径 | 引入「有效范围」`activeScope`：选项里没有就按全局处理（选择器 / 请求 / 安装默认值同源） |
| P3 | 切界面语言会白跑一次 omp 子进程（effect 依赖了本地化文案） | 失败值改成「原始消息 / 空串」，本地化兜底在渲染时取 |
| P3 | `EnumSelect` 触发按钮缺可访问名与 listbox 语义 | 触发按钮 `aria-label` + `aria-haspopup="listbox"`，面板 `role="listbox"`、选项 `role="option"` + `aria-selected` |
| P3 | 特性 chip 开关状态只有颜色 | 启用态加对勾图标（形状信号），`aria-pressed` 不变 |

**二轮界面复核**（同一套 mock 路线，改后重跑；中英双语各一遍）：

- 插件页：项目级安装 → `install_plugin {scope:"project", cwd:<项目>}`；安装后面板**范围切到该项目**、`list_plugins` 用该项目 cwd 重拉、顶部给「已安装 …」；
- 读取在途（mock 延迟 700ms）：行内开关与卸载按钮 `disabled`，**点击开关不产生任何写请求**，读取结束后自动解锁；
- 特性 chip：`aria-pressed=true` 且有对勾图标（形状 + 状态双信号）；
- 技能页：启用后重拉期间写控件锁住、结束解锁；预览乱序（先慢后快）只显示**当前**展开项的正文；正文里的链接渲染成按钮（`<a>` 计数 0），不会把应用导航走；
- 记忆页 / 更新说明的链接同样换成按钮型链接。

## 6. 边界

- **不做**：市场管理（`omp plugin marketplace add/remove/update`、`discover` 浏览）、插件升级
  （`omp plugin upgrade`）、`omp plugin config`（插件自定义设置项）、`omp skill` 的注册表面
  （`install` / `update` / `uninstall` / `search` / `publish` 与 `skills.json`）、技能目录的删除、
  MCP / Hook 面板。
- **不做「安装预览」**：理由见 §0 / §1.1 陷阱 3（对市场条目会真装）。
- 技能停用是**名字级全局**的（上游语义）：同名技能在不同项目 / 不同 provider 下会一起停用；
  壳侧不代偿、不做「按项目停用」。provider 级开关（`skills.enableClaudeUser` 等）与
  `ignoredSkills` / `includeSkills` / `customDirectories` 仍在「常用设置」的既有键里，本页不动。
- 项目级插件（项目 `package.json` 依赖、项目级市场安装）只有**把范围切到那个项目**才看得到——
  与上游一致（cwd 决定一切）；壳侧不做「全项目插件总览」。
- 写操作**只碰 omp 的 CLI 面**：不直接改 `~/.omp/plugins/*`、不动插件的 lock / 注册表文件、
  不写技能目录。
- **已知并发面**：`disabledExtensions` 的读-改-写与「模型角色 / 转移链 / 常用设置」的 `omp config set`
  用的是不同的锁（`extensions_edit` vs `roles_edit` / `retry_edit`），理论上可能落在同一份
  `config.yml` 上——这是壳侧既有的分层（各页各自串行），本版未改动；实际上 omp 自己写配置也带锁，
  且这属「同一秒内两个设置页同时保存」的窄面，先按既有口径保留。
