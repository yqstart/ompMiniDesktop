## 目标

把输入框的 `/` 从「纯文本直发」升级为**补全浮层**（对标你给的参考图）：打 `/` 弹出 omp 真实命令面，可搜索、可键盘导航、选中即补全，再按 Enter 发送。

## 实测口径（本机 omp 18.2.1，已跑通）

命令面共 **52 条**：`builtin` 41 / `skill` 7 / `extension` 1 / `custom` 2 / `file` 1，形状 `{name, aliases?, description, input:{hint?}, subcommands?, source}`。

- **技能已经混在命令面里**：`name = "skill:<技能名>"`、`source = "skill"`、`hint = "arguments"`（本机 7 个：code-simplifier / dependency-audit / find-skills / frontend-design / tailwind-v4-shadcn / ui-ux-pro-max / vue-best-practices）。所以**不另扫技能目录**——扫了会与命令面重复，而且 omp 的供应商优先级 / shadow 规则（native 100 → 插件 90 → claude 80 → agents/codex 70 → opencode 55）复刻成本高、必然漂移。
- **子智能体按你的决定不做**（RPC 命令面里没有，输入框没有触发路径）。

## 数据通路：后端零改动

omp 在 spawn 握手期就推 `available_commands_update`（实测早于 negotiate 回包），后端 `runtime.rs:686` 已把它缓存进 `SessionMeta.commands` 并原样透传到 `omp-event://<id>`；`get_session_runtime` 返回整个 `SessionMeta`（含 `commands`）——**`currentRuntime.commands` 其实已经躺在 store 里，只是前端没人读**。`syncSessionRuntime` 已在「订阅建立」与「`open_session` 返回后」两处补拉，覆盖新建与 resume 两个方向。

前端只需补一处：`useSessionEvents` 消费 `available_commands_update` 帧（技能 / 扩展变化时即时刷新；现在它会落进「未知帧告警一次」分支刷日志）。

## 交互设计

```
        ┌─ 卡片上方浮层：absolute bottom-full，max-h-[min(340px,45vh)] 内部滚动 ─┐
        │ /compact    Compact the conversation     [soft|remote|snapcompact]… │ ← 选中行 bg-hover
        │ /computer   Toggle computer use          [on|off|status]             │
        │ /context    Show context usage                                       │
        │ 技能                                                                 │
        │   code-simplifier   Simplify unnecessarily complex code…             │
        └──────────────────────────────────────────────────────────────────────┘
   ┌─ 输入框卡片 ─────────────────────────────────────────────────────────┐
   │ /co                                                                   │
   └───────────────────────────────────────────────────────────────────────┘
```

- **触发**：光标前的草稿匹配 `^/(\S*)$`（即 `/` 开头、首个 token 内）。`running`（流式中）**不弹**——那时 Enter 走 `follow_up` 排队，`/xxx` 是当文本发出去的，弹了就是暗示它能当命令跑。无会话 / 命令面未到时整块不渲染。
- **过滤排序**：空查询全列（omp 原序）；非空按 `name` 前缀 > `name` 子串 > `alias` > `description` 子串打分，同分保持原序（稳定排序，可预测）。
- **分组**：命令组在前（无标题），技能组（`source:"skill"`）在后带「技能」标题，显示名去掉 `skill:` 前缀（对应参考图里 `$code-simplifier` 的观感），**插入时补全成完整 `/skill:xxx`**。
- **键盘**：↑↓ 导航、Tab / Enter 选中、Esc 关闭（与 `@` 补全同款键位）；**打全即发**——草稿首 token 已是某个候选的完整命令名（含别名）时，Enter 直接发送、补全不拦截。
- **选中**：把 `/` + 完整命令名写进草稿并追加一个空格（后续可继续打参数），面板随之关闭。
- **与 `@` 补全互斥**：`/` 补全打开时 `@` 补全让位（草稿 `/@foo` 只出命令面板）。
- **浮层而非挤压布局**：绝对定位在卡片上方 + 限高内部滚动。上一版被撤掉的正是「48 条列表把输入框顶出屏幕」，这个形态从根上解决它，也贴合参考图。

## 改动清单

**前端**
1. `src/shared/types.ts` — `AvailableCommand` 补 `source` / `subcommands`，修正 `hint`（omp 实际给的是 `input.hint`，现有类型写成了扁平的 `hint`）。
2. `src/lib/slashCommands.ts`（新）— 归一（`input.hint` → `hint`、丢缺 name 的坏项）/ 过滤打分 / 分组 / 插入文本，纯函数。
3. `src/lib/slashCommands.test.ts`（新）— 单测：归一容错、前缀与描述命中、技能组降级 `skill:` 前缀、打全判定、别名命中。
4. `src/components/composer/SlashMenu.tsx`（新）— 浮层：`role="listbox"` + 分组 `role="group"`、`aria-selected`、选中项 `scrollIntoView({block:"nearest"})`，样式沿用 `border-border` / `bg-elevated` / `shadow-pop`。
5. `src/components/composer/Composer.tsx` — 触发 / 键盘（含与 `@` 补全的优先级）/ 选中接入。
6. `src/lib/useSessionEvents.ts` — `available_commands_update` 帧写入 `currentRuntime.commands`；`frameToViewMsgs` 里加静默分支不再告警。
7. `src/lib/locale.ts` — 新增字典键（「命令」/「技能」/「无匹配命令」/ 列表 aria / 面板提示），中英双语。

**文档**（架构级变更需同步）
8. `design-system/MASTER.md` §8 — `Composer` 条目里那句「**没有 `/` 命令列表浮层**」改为如实描述，并把 `SlashMenu` 加进命名速查表。
9. `AGENTS.md` — 源码结构里 `components/composer/` 与 `lib/` 两处条目更新。
10. `CHANGELOG.md` — Unreleased 加一条。
11. `docs/v10-schedule.md`（新）— 本期实测口径与完成口径，按 v9 的结构写。

## 验证

`pnpm check`（typecheck + lint + test + e2e:ipc + e2e:rpc）全绿，再在真机 dev 里看一眼：打 `/` 弹面板、输入过滤、↑↓/Tab/Enter、打全 `/usage` 后 Enter 直发、技能组选中补成 `/skill:xxx`。

## 明确不做

子智能体组（omp RPC 无触发路径，你已确认）；`subcommands` 二级补全（本期只在一行里显示 `input.hint`）；流式中的 `/` 补全；命令使用频率排序。