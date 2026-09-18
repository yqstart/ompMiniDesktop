# ompMiniDesktop 十三期（V13）：快速切换环（`cycleOrder`）可视化

> 基线：V12 已交付（自定义模型接入 + 供应商合并弹窗，见 `docs/v12-schedule.md` 与 `CHANGELOG.md`）；本文只排十三期。
> 目标：把 omp 的 **Ctrl+P 轮换序（`cycleOrder`）** 搬进设置界面——此前它只能手改
> `~/.omp/agent/config.yml`，或在 omp TUI 的 `/model` 面板里按 `c` 逐个切换。
> 约束不变：真相在 omp 的配置里；壳侧不存副本，读的是「正在改的那一层」（全局 agentDir）。

## 0. 范围与口径

用户口径：「我在模型角色里设置了很多模型，但 Ctrl+P 只有 default 和 smol。」

**根因**（§1）：Ctrl+P 轮换的不是「全部已配置角色」，而是 `cycleOrder` 这个**显式列表**；
omp 不会因为某角色配了 `modelRoles` 就自动把它加进环。本批把该列表的读 / 写搬进设置页。

|位置|区块|映射的上游物|写入什么|
|---|---|---|---|
|设置 › 模型（「模型角色」与「失败转移」之间）|「快速切换环」|`omp config get/set cycleOrder`（array）|omp 全局配置 `~/.omp/agent/config.yml`|

**范围外**：

- **不改 Ctrl+P 的语义**（不把它扩展成「全部角色」或「全部模型」——那是 omp 的设计）：
  「切换任意模型」的入口是 TUI 的 `/model` / Alt+M 选择器，不是本区块。
- **`enabledModels`**（omp 侧 `/model` 的白名单）维持 V12 的决策**不做**（见 `docs/v12-schedule.md` §6）。
- TUI 内部的 `c` 键 / `[` `]` 排序等交互仍由 omp 自带，壳侧只做配置的读写面。

## 1. 上游事实（omp 18.2.4 二进制逐段核对 + 真实 TUI 实测）

**① Ctrl+P 的处理链**（键位表 `app.model.cycleForward`，帮助文本 "Cycle to next model"；
`Shift+Ctrl+P` = `cycleBackward`）：

```text
cycleRoleModel()
  → session.cycleRoleModels(settings.get("cycleOrder"))
  → getRoleModelCycle(cycleOrder)：逐角色解析模型
  → applyRoleModel(next)：切换会话当前模型 + 状态栏 track（label = cycleOrder 原样列表）
```

**② `cycleOrder` 条目是「角色 id」，解析规则**（`getRoleModelCycle`）：

- 环里每个条目 `a`：`default` 角色 → `modelRoles.default`，没配则回退当前模型；其余角色
  → `modelRoles[a]`，**没有配置就 `continue`（跳过）**；
- 解析出的模型不在可用目录（供应商无凭证）也跳过；
- 全部条目解析后 ≤ 1 个时，TUI 提示 "Only one role model available"（不切换）；
- **不去重相同模型**——`default` 与 `smol` 指向同一模型时环仍可轮换（角色标签会变，模型不变）。

**③ 出厂默认与用户现状**：上游默认 `["smol","default","slow"]`（帮助文档写
"Cycle role models (slow/default/smol)"）；本机实际值 `["default","smol"]`（少 `slow`）——
即用户当前「只有两个」的直接原因。TUI 内管理入口：`/model` 面板角色行上按 `c` toggle、
`[` / `]` 排序，面板底栏实时预览 `${ctrl+p} cycle: …`（空环提示 "press c on a role to add it"）。

**④ CLI 契约（隔离 agentDir 实测）**：

```text
$ PI_CODING_AGENT_DIR=<tmp> omp config set cycleOrder '["default","smol","slow"]'
✔ Set cycleOrder = ["default","smol","slow"]
$ PI_CODING_AGENT_DIR=<tmp> omp config get cycleOrder --json
{ "key": "cycleOrder", "value": [ ... ], "type": "array", "description": "" }
```

空数组 `[]` 合法（= 清空环，落盘 `cycleOrder:\n  []`）；写回是**整组覆盖**（不是读-改-写）。

**⑤ 生效范围（本批实测的关键边界）**：运行中的 TUI 用的是**进程内 settings 快照**——
外部进程改写 config.yml 后，已打开的会话**不会热读**。实测：TUI 运行中从外部删掉
`modelRoles.slow`，重开 `/model` 面板，muse-spark 行的 `● slow` 标记仍在；源码侧核对：
`reloadFromDisk` 只在少数时点被调（cwd 变化、agent spawn 前 preflight 等），没有 config.yml
文件监听。**结论：壳侧写入对「新起的终端」立即生效；对已打开的终端，重开即可**——属于上游
行为，壳侧不代偿（UI 文案只描述「omp 终端里 Ctrl+P 按这个环轮换」，不承诺热更新）。

## 2. 实现

**后端（`providers.rs`，2 个命令 + 2 个纯函数）**

|命令|干什么|
|---|---|
|`get_cycle_order`|`config_get_global("cycleOrder")` → 解析（钉住 agentDir 与写入同层，同 retry 系的读法）|
|`set_cycle_order(order)`|归一 → `omp config set cycleOrder <JSON 数组>` → 回读确认|

- `parse_cycle_order`（读容错）：非数组 / 标量 → 空环；非字符串条目丢弃；名字合法性走
  `validate_role_name`（空白 / 控制字符拒绝）；**重复保序去重**。
- `normalize_cycle_order`（写前归一）：同上的过滤 + 去重——界面只会从候选里选，这里防的是
  手写 / 并发产生的脏值。
- 与 `set_model_role` **共用 `roles_edit` 锁**：两者都是对同一份 config.yml 的 `omp config set`，
  串行化避免两次写入并发互相覆盖（`cycleOrder` 是单值覆盖写，无需读-改-写）。
- 4 项单测：解析容错 / 去重、写归一 / 序列化（含空数组 `[]` 与自定义角色名）。

**前端（`src/components/settings/CycleOrderSection.tsx`）**

- 区块 = 头部（`Repeat` 图标 + 标题 + `Ctrl+P` kbd + 刷新按钮）+ 口径文案 + 行列表 + 添加按钮；
  行 = 序号 + 角色名（自定义角色带 id 子标签）+ 当前 selector（未配置显示「未配置」）+
  上移 / 下移 / 移出（图标按钮，行内二次操作无确认——单步操作直接写回，移除可再加回）。
- 添加 = 内联展开候选 chips（`roleKeys` 里尚未入环的；全在环内时按钮禁用 + title 说明）。
- **每次增删 / 移动立即写回**（`set_cycle_order` → 回读真值 → `setCycleOrder`），与角色行同款；
  写入经 `ModelsPanel.saveCycleOrder` 统一串行化（`cycleWriting` / `cycleRevision` 防旧读覆盖）。
- 加载并入 `ModelsPanel.load()` 的 `Promise.allSettled`（第 3 路），**设置标签重新激活时随
  角色 / 转移链一起重读**；模型目录仍走 `get_models` 的 5 分钟缓存。
- 字典新增 `cycle*` 9 键 × 2 语言（`cycleHint` 写明「条目是角色不是模型 / 未配置会被 omp 跳过」）。

## 3. 完成口径（已达成）

- `pnpm check` 全绿：typecheck / lint / **98 单测**（`ModelsPanel.test.tsx` +1：添加 / 上移 /
  移除都按当前顺序整组写回）/ `e2e:ipc` **45 命令** × 双向一致（`ipc.ts` ↔ `main.rs` ↔ 实现）。
- `cargo test` 全绿（providers 模块 +2：`cycle_order_parses_leniently_and_dedupes` /
  `cycle_order_write_normalizes_to_json_array`）。
- 界面核对（静态构建 `dist/` + 注入 IPC mock，中文与英文两遍）：
  - 初始 `["default","smol"]` 渲染两行（label + id + selector + 序号 + ↑↓×）与 `Ctrl+P` kbd；
  - 添加「深思」→ `["default","smol","slow"]`；上移 → `["default","slow","smol"]`；移出「默认」
    → `["slow","smol"]`；全部移出 → 空态文案；从空环再加回「深思」→ `["slow"]`；
  - 英文界面：`Quick-switch cycle` / `Add role` / 未配置角色行显示 `Not set`；
  - 截图核对（深色主题、中英两套）。
- 隔离 agentDir 的 CLI 契约实测（用户真实配置零改动，见 §1④）；真实 TUI 的生效范围实测
  （见 §1⑤，副本 agentDir + PTY）。
- 未实测：原生 Tauri WebView（界面核对走静态构建 + 注入 IPC mock，与既有口径一致）。

## 4. 边界与风险

|#|事项|状态|说明|
|---|---|---|---|
|1|环里的未知角色名（手写配置）|容错保留|合法（无空白 / 控制字符）的名字照常显示、可单独移除；非法名字读时丢弃|
|2|与 TUI 的并发编辑|后写者胜|环是单值覆盖写，无合并语义；壳侧设置标签激活即重读，不造第二份状态|
|3|跨键并发（如与 `set_fallback_chain`）|既有边界|两把锁（`roles_edit` / `retry_edit`）互不阻塞，与 V12 前一致，未扩大|
|4|对已打开会话的生效|**上游行为**|见 §1⑤：不热读，重开终端生效；文档与文案如实描述，不代偿|

## 5. 后续候选（需用户确认再开工）

- 候选排序的拖拽交互（现在只有 ↑ / ↓ 按钮）。
- 若上游未来给 `cycleOrder` 增加非角色条目（如模型 selector）的语义，界面候选要跟着扩。
- `enabledModels`（omp 侧 `/model` 白名单）——维持「不做」，除非用户明确要。
