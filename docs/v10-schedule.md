# ompMiniDesktop 十期（V10）功能排期：输入框 `/` 命令补全

> 基线：V1–V9 已交付（见 `CHANGELOG.md`）；本文只排十期，不重开已冻结的口径。
> 目标：把输入框的 `/` 从「纯文本直发的暗号」升级为**补全浮层**——打 `/` 弹出 omp 自己的命令面，
> 可搜索、可键盘导航、选中即补全。
> 约束不变：真相在 omp；壳侧不摆自带清单、不复制 omp 的匹配规则、不扫 omp 自己会扫的目录。

## 0. 范围与口径

用户口径：参考图是 ZCode 的 `/` 面板（分组的「命令 / 技能 / 子智能体」列表 + 名称、描述、搜索提示）。

| 参考图里的组 | omp 侧的现实 | 本期怎么做 |
|---|---|---|
| 命令 | `available_commands_update`（RPC 命令面） | **照做**——数据就是它，一条不多一条不少 |
| 技能 | 同一份命令面里 `skill:<名>`（`source:"skill"`） | **照做，单独成组**；不另扫 `~/.agents/skills/` |
| 子智能体 | **没有输入框触发路径**（RPC 命令面不含；`/agents` hub 是终端 TUI 专属） | **不做**（用户已确认）——列出来就是点了没用的假入口 |

范围外（本批不做）：`subcommands` 二级补全（`input.hint` 只在行尾显示完整参数签名）、
流式中的 `/` 补全（见 §2 的理由）、命令使用频率排序（不做「常用置顶」，排序可预测优先）、
自定义命令的创建 / 编辑（那是一整套写 omp 配置文件的功能，不在本期）。

## 1. 上游事实（本机 omp 18.2.1 实测）

**① 命令面的形状与规模**

`{type:"get_available_commands"}` 与启动期的 `available_commands_update` 返回同一份数组，
本机实测 **52 条**：`builtin` 41 / `skill` 7 / `extension` 1 / `custom` 2 / `file` 1。
条目形状（`omp read omp://rpc.md` + 实测）：

```jsonc
{ "name": "compact", "source": "builtin", "aliases": ["models"],
  "description": "Compact the conversation",
  "input": { "hint": "[soft|remote|snapcompact] [focus]" },
  "subcommands": [{ "name": "soft", "description": "Soft compact" }] }
```

- **`hint` 的真实位置是 `input.hint`**（不是平铺的 `hint`）——前端类型此前写成了扁平形状，本期一并修正，
  归一时折平（`lib/slashCommands.ts`）。
- 规模随已装技能 / 扩展浮动（rpc-memo 记 48 条，本次复测 52 条），**所以列表必须限高滚动**。

**② 技能不是另一套数据**

omp 的 `skills.enableSkillCommands` 把技能发布成 `skill:<技能名>` 进同一份命令面
（本机 7 个：`code-simplifier` / `dependency-audit` / `find-skills` / `frontend-design` /
`tailwind-v4-shadcn` / `ui-ux-pro-max` / `vue-best-practices`），`hint` 统一是 `arguments`。

壳侧**不另扫技能目录**的理由：技能发现有一整套优先级与 shadow 规则
（native 100 → omp-plugins 90 → claude 80 → claude-plugins/agents/codex 70 → opencode 55 →
`.github/skills` 30 → omp-managed 5，`omp read omp://skills.md`），自己扫必然与命令面重复且会漂移。

**③ 子智能体确实没有输入框入口**

定义在 `~/.omp/agent/agents/*.md` 与 `<cwd>/.omp/agents/*.md`（本机 bundled 5 个：
reviewer / scout / security-reviewer / sonic / task），但：

- RPC 命令面里**没有**它们（52 条里没有任何 agent 类条目）；
- `/agents` hub 是 TUI 专属（只有 `handleTui`，与 `/plan` `/goal` 同类）；
- `get_subagents` / `get_subagent_messages` 是**运行实例**订阅，不是定义清单；
- CLI 只有 `omp agents unpack`（会把 bundled 写进磁盘，壳内不宜常跑），**没有 list**。

**④ 数据通路本来就在（后端零改动）**

omp 在 spawn 握手期就推 `available_commands_update`（实测帧序：`ready → setWidget →
advisor_cost_changed → available_commands_update → response(neg) → response(state)`），
后端 `runtime.rs` 早已缓存进 `SessionMeta.commands` 并原样透传；`get_session_runtime` 返回整个
`SessionMeta`——前端 `syncSessionRuntime` 在「订阅建立」与 `open_session` 返回后各补拉一次，
**命令面本来就已经躺在 store 的 `currentRuntime.commands` 里，只是没人读**。

## 2. 实现

**前端 6 个文件 + 字典 + 4 份文档，后端零改动。**

| 文件 | 做什么 |
|---|---|
| `src/shared/types.ts` | `AvailableCommand` 补 `source` / `subcommands`，修正 `hint`（线上是 `input.hint`） |
| `src/lib/slashCommands.ts`（新） | 归一（`input.hint` 折平、丢缺 `name` 的坏项）+ 过滤打分 + 分组 + `isCompleteCommand` + `commandInsert` |
| `src/components/composer/SlashMenu.tsx`（新） | 浮层：分组标题 + 候选行 + 底部提示行 |
| `src/components/composer/Composer.tsx` | 触发判定 / 键盘 / 选中写回 / 与 `@` 补全互斥 |
| `src/lib/useSessionEvents.ts` | 消费 `available_commands_update` 帧（**只替换 `commands` 字段**）；`frameToViewMsgs` 加静默分支 |
| `src/lib/locale.ts` | 5 键 × 2 语言 |

**关键取舍**

- **浮层形态与 `@` 补全一致**（卡片内、输入框上方、`max-h-56` 内部滚动 + 底部提示行）。
  上一版命令列表被撤掉的原因是「48 条把输入框顶出屏幕」——**限高滚动从根上解决它**，
  两条补全路径共用一套浮层语言，不再造第二种。
- **分组固定「命令 → 技能」**，组内按匹配质量排（名字前缀 > 名字子串 > 别名 > 描述子串，
  同分保持 omp 原序）。**分组优先于分数**：技能永远落在技能组、命令永远落在命令组，
  列表结构不随输入跳动。描述进搜索面是有意的——omp 的描述是英文关键词，记不住命令名的人靠它找得到。
- **技能行显示去掉 `skill:` 的名字，但行的前缀就是 `/skill:`、插入也补全成完整名**。
  显示成 `/code-simplifier` 会让人以为能那么打（实际不会命中），所见即所发优先于短。
- **打全即发**：首 token 已是某个候选的完整命令名（含别名）时 Enter 直接发送、补全不拦截——
  否则打完 `/usage` 回车只会被补成 `/usage ` 停在原地，一条命令要按两次回车。
- **流式中不弹**：那时 Enter 走 `follow_up` 排队，`/xxx` 是当文本发出去的，弹补全等于暗示它能当命令跑。
- **零命中时面板不消失**，给「没有匹配的命令」：消失会让人以为这个命令不存在。
- **与 `@` 补全互斥**：草稿以 `/` 开头时整条就是一条命令，路径候选让位。
- `useSessionEvents` 消费帧时**只替换 `commands`**，不整块覆盖 `currentRuntime`——
  `applyRuntime` 是整块覆盖，用它更新命令面会顺手抹掉同时推来的模型 / 档位 / 用量。

## 3. 完成口径

- `pnpm check` 全绿：typecheck + lint（0 警告）+ 196 项单测（其中 `slashCommands` 16 项）+
  `e2e:ipc`（60 命令 × 通道 × ViewMsg 十一型）+ `e2e:rpc`（含「可用命令面返回 commands 数组」）。
- **展示层核对**（vite 页面注入真实形状的命令面 25 条，**未占用正在跑的 dev server**）：
  - 分组标题「技能」与行结构：`/skill:` 弱化前缀 + 名字正文色 + 描述截断 + `input.hint` 右挂；
  - `max-h-56` 内部滚动（25 条超出可视区时 `scrollHeight > clientHeight`）；
  - 空查询提示行「输入内容以搜索命令或技能」、非空转「↑↓ 选择 · Tab 或 Enter 补全 · Esc 关闭」；
  - 过滤 `/co` → 命令组 `compact computer context`（前缀）+ `session init`（描述命中）+ 技能组 `code-simplifier`；
  - ↑↓ 移动高亮（↓×2 → index 2）；
  - Tab 补全写出 `/usage ` 且面板关闭；
  - 零命中给「没有匹配的命令」而**面板不消失**；
  - Esc 关面板、草稿保留（`/zzzz` 不被吞）；
  - 打全 `/usage` 后 Enter **没有被补成** `/usage `（补全未拦截，交给发送路径）。
- **未做真机端到端**（界面 → 真实 omp 命令面）：展示层走注入，真机侧只确认了「打开会话后
  `currentRuntime` 已回填」（工具行的模型 / 用量限额 / 上下文容量三处都从它读值，均正常显示）。
  命令面本身的数据通路后端未改动，且 `e2e:rpc` 覆盖了 `get_available_commands` 的回包形状。

## 4. 后续候选（需用户确认再开工）

- **`subcommands` 二级补全**：`/compact soft` 这种——omp 的 `subcommands[]` 已带 `name` 与 `description`，
  数据齐了，缺的是「第二个 token 也算补全位」的交互设计（要与「已经在打参数」区分开）。
- **命令使用频率排序**：本期刻意不做（可预测优先）。要做需要一个使用计数存储 +
  「常用置顶」的口径（会不会打乱分组？排序变了用户还能不能靠位置记忆？）。
- **子智能体入口**：omp 侧没有 RPC 触发路径，做不了——除非上游给 `/agents` 加 `handle`，
  或壳侧走 `/force task` 之类的绕行（语义不等价，需要先定口径）。
- **自定义命令的读取与创建**：`source:"custom"` / `"file"` 的那几条来自
  `~/.omp/commands/*.md` 之类的目录，omp 已经把它们发进命令面（读没问题）；
  **创建 / 编辑**要写这些文件，属于「壳侧替用户写 omp 的资产」，需要单独定边界。
