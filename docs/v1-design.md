# ompMiniDesktop V1 产品设计

> 版本：v1.0（第一版冻结稿）| 日期：2026-09-15 | 技术栈：Tauri v2 + React + TS + Tailwind v4 + Zustand
> 风格锚点：DeepSeek Harness 主界面式极简。设计 token 以 `design-system/MASTER.md` 为准，本文只讲结构与行为。
> 范围：只做最小单元——添加项目、移除项目、新建会话、归档会话、删除会话、切换模型、切换思考等级、agent 输出渲染、权限。设置只留入口不做功能。不做自动化、插件管理。

---

## 1. 背景与目标

### 1.1 一句话

给 `omp`（oh-my-pi）做一个极简桌面壳：把终端里的 agent 会话装进一个安静的两栏界面，让用户只管「选项目 → 开会话 → 提问 → 审批 → 切模型再问」。

### 1.2 V1 成功标准

用户能不看文档走通这条链路：添加项目 → 新建会话 → 提问 → 看到流式思考 / 工具 / 文本 → 审批写操作 → 中途切换模型与思考档 → 归档 / 删除会话。杀进程、删目录、切不支持的思考档时有明确错误态，无白屏、无假死、无伪实时感。

### 1.3 非目标（V1 明确不做）

自动化任务、定时任务、插件 / Skill / MCP / Hook 管理、主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器、用量统计页。设置页只留入口（§8）。

---

## 2. 设计原则

1. **DSH 式克制**：安静底色 + 单一强调色 + 细边框。装饰只允许出现在一个地方——工具调用卡的时间线，其余全部留白。
2. **真相在 omp**：会话真相永远是 `~/.omp/agent/sessions/<slug>/*.jsonl`，app 只存一层轻量覆盖（项目列表、归档标记、备注、会话级权限）。app 可删可重装，不丢用户会话。
3. **流式即真相**：所有进行中的输出走 RPC 事件流，不轮询文件。文件只用于列表与历史回放。
4. **审批是最高优先级 UI**：任何等待审批的时刻，全界面只有一个焦点——审批卡。
5. **空态即引导**：每个空位置都告诉用户下一步点哪里，不说正确的废话。

---

## 3. 总体布局

### 3.1 两栏结构

```
┌──────────────┬─────────────────────────────────────────────┐
│ 左栏 264px   │ 中央流式列（居中 max-w-3xl）                  │
│              │ ┌─────────────────────────────────────────┐ │
│ 项目组       │ │ 顶栏 48px：标题/模型/思考档/权限/状态点  │ │
│ ───────────  │ ├─────────────────────────────────────────┤ │
│ 会话组       │ │                                         │ │
│  进行中      │ │            消息流（虚拟化）              │ │
│  已归档(折叠) │ │                                         │ │
│ ───────────  │ ├─────────────────────────────────────────┤ │
│ ＋添加项目   │ │ 状态条（token/耗时/上下文占比）          │ │
│ 设置（占位） │ │ Composer（输入+发送/停止）              │ │
└──────────────┴─────────────────────────────────────────────┘
```

右侧栏 V1 不做。窄窗（≤768px）左栏收成抽屉，中央占满。

### 3.2 左栏

- **上段·项目**：每行 = 项目名（目录 basename）+ 路径尾段（12px muted）+ 会话数角标。点击切换当前项目。hover 出「…」菜单：打开目录（系统文件管理器）、重定位（目录被删后用）、移除项目。
- **下段·会话**：顶部「＋ 新建会话」按钮（accent 描边）。分组「进行中 / 已归档」（已归档默认折叠，只显示计数）。会话行 = 标题（取 jsonl `title`/`title_change` 最新值，超长省略）+ 第二行（时间 + 模型短名角标 + 运行中圆点）。hover 出归档 / 取消归档 / 删除图标按钮。右键同菜单。
- **底部固定**：「添加项目」「设置」两项。设置带「V1 未开放」小角标也行，但不要 disable 到点不开——点开给占位页（§8），让用户知道去哪配。

### 3.3 中央顶栏（48px，极简）

从左到右：会话标题（可点击改备注名，不改 omp 原标题）｜ 模型选择器 ｜ 思考档选择器 ｜ 权限徽标（盾牌 + 三档文字）｜ 运行状态点（运行中 accent 脉冲 / 等待审批 warn 常亮 / 空闲隐藏）。

### 3.4 空态

- **无项目**：大标题「先添加一个项目」+ 文案「选择一个本地目录作为项目，会话会绑定到它启动」+ 主按钮「选择目录」。
- **无会话**：大标题 + 当前项目路径 + 「新建会话」按钮 + 3 个示例问题（点击填入 composer，不直接发送）+ 快捷键提示（Enter 发送 / Shift+Enter 换行 / Esc 停止）。
- **归档会话打开态**：顶部横幅「已归档，只读——取消归档后可继续对话」+ 按钮。composer 禁用。

---

## 4. 项目管理

### 4.1 添加项目

- 入口：左栏底「添加项目」。
- 交互：调 Tauri `dialog.open({directory:true})` 选目录 → 校验（存在、可读、非 `$HOME` 根——omp 默认拒绝 home 启动，`--allow-home` 也不鼓励）→ 写入覆盖层 `projects` → 自动选中并提示新建会话。
- 重复添加同一目录：直接选中已有项目并 toast「已在列表中」，不建重复项。
- 存储：`{id, path, addedAt, lastModel, lastThinking}`。`id` 用自增短 id（如 `p1`），不复用目录名做 key（目录可改名）。

### 4.2 移除项目

- 语义：**仅解绑，不删文件**。删覆盖层条目 + 该项目会话的归档/备注/权限覆盖（或保留？V1 选择级联清，并明确告诉用户）。
- 流式中移除：先 `abort` + kill 子进程，再移除，确认框写清「该项目有 N 个运行中的会话，将先停止」。
- 目录缺失：项目行标 warn「目录缺失」，禁止新建会话，只能「重定位 / 移除」。会话历史仍可回放（文件还在）。

---

## 5. 会话管理

会话真相 = jsonl。列表 = 后端扫描 `sessions/` 下全部 `*.jsonl` → 读头部 `session` 行（`id/cwd/timestamp/title`）→ 按 `cwd` 归属到项目（**按真实路径前缀匹配，不猜 slug 算法**）→ 叠加覆盖层归档标记。`PI_CODING_AGENT_DIR` 覆盖时同样可用（后端读 env）。

| 操作 | 行为 |
|---|---|
| 新建会话 | 用项目 `lastModel/lastThinking`（无则用全局 `modelRoles.default` / `defaultThinkingLevel`）spawn 新 RPC 进程，不带 `--resume`。`get_state` 返回 `sessionFile/sessionId` 后落覆盖层并选中。失败（模型不可用等）留在空态 + 内联错误条 |
| 打开会话 | 若已有子进程直接聚焦；否则 spawn 带 `--resume <id前缀> --cwd <项目dir>`，成功后 `switch_session` 兜底 + `get_messages_page` 回放历史 |
| 归档会话 | 只写覆盖层 `archived[sessionId]=true`。流式中归档：先停止再归档。归档后进程可杀掉（重开再 spawn）。归档会话只读 |
| 取消归档 | 删标记，回到进行中 |
| 删除会话 | 二次确认框（标题 + 「不可恢复」红字）。步骤：kill 子进程 → 删 `<ts>_<id>.jsonl` **及同名前缀目录**（实测两者并存，rfc：`2026-..-.._01a0..` 文件 + 同名无后缀目录）→ 清覆盖层相关键。流式中删除同归档：先停再删 |

标题规则：显示 `title_change` 最新值，无则 `session.title`，无则「未命名会话 + 日期」。用户在顶栏改名只改覆盖层 `notes`（显示优先用 notes），不写回 omp（`set_session_name` 会影响远端标题，V1 不用，避免惊喜）。

---

## 6. 模型切换

### 6.1 数据源

`omp models --json` 拉取并缓存 5 分钟 + 手动刷新按钮。字段：`provider/id/selector/name/contextWindow/maxTokens/reasoning/thinking/input/cost`（已实测，见 `docs/rpc-memo.md`）。`get_available_models`（RPC）作运行时校验源。

### 6.2 选择器交互

- 顶栏模型按钮显示短名（如 `Muse Spark 1.3` / `Haiku 4.5`），过长省略。
- 下拉：搜索框（模糊，同 CLI `--model` 语义）+ 按 provider 分组 + 每行右端角标（context 如 `1M`、thinking 档数、images 有无）。当前模型高亮。
- 会话中切换：发 RPC `set_model {provider, modelId}` → 成功收 `model_changed` 事件 → 中央插入系统分隔线「已切换到 Claude Haiku 4.5」→ 更新覆盖层 `lastModel`。失败（`Model not found`）内联错误条 + 保留旧模型，不闪切。
- 新建会话：选择器即默认值，直接影响下一次 `create_session`。

---

## 7. 思考等级切换

档位全集：`off / minimal / low / medium / high / xhigh / max / auto`。可用档 = 当前模型 `thinking` 数组（`null` = 不支持思考，只允许 `off`；如 `deepseek-flash` 无 thinking 列）。选择器置灰不支持档并 tooltip 说明原因。

- 会话中切换：`set_thinking_level {level}` → `thinking_level_changed` 事件 → 系统分隔线「思考等级已设为 high」。
- 显示：顶栏思考档按钮 + 状态条可展开「上下文占比 / 档位」。
- 规则：切到不支持档**禁止提交**（按钮 disabled + 提示可用档列表），而不是先发再报错。

---

## 8. Agent 输出渲染（核心）

### 8.1 参考了谁、学了什么

| 产品 | 学到的具体做法 | 在 V1 的落地 |
|---|---|---|
| Claude Code（TUI + VSCode 紧凑模式） | 工具调用默认折叠为一行「图标 + 工具名 + 一句话意图 + 状态点」，thinking 默认折叠，失败红边 | `ToolCard` 标题行 + `ThinkingFold`，完全照搬语义 |
| Codex 桌面/app | 左 Projects + Recents 浏览、draft 发送前不落盘 | 左栏分组 + composer draft 常驻内存 |
| DSH transcript（`message_update` delta 流） | `text/thinking/toolcall` 三类 delta 独立通道、同一 assistant 内追加合并 | 前端按 `contentIndex` 合并，不每 token 建消息 |
| `omp gallery` 各工具 renderer | 每个工具有 streaming / in-progress / done / failed 四态，进参展示规则各异（`read` 给 path+行号、`bash` 给 command） | `ToolCard` 四态 + 按工具名定制参数摘要行 |
| omp TUI transcript | 系统事件（切模型、改标题、退出）走居中灰字分隔线，不进消息流 | `SystemDivider` |

### 8.2 事件 → 组件映射

RPC 流（stdout JSONL）与 jsonl 文件是同一套语义的两面，V1 统一成 `ViewMsg` 再渲染：

| 上游事件 | 组件 | 渲染规则 |
|---|---|---|
| `message_start/end role=user`（含 `fileMention`） | `UserBubble` | 右对齐浅底；`@文件` 显示为芯片（名 + 路径尾段），图片显示缩略图占位（V1 不内联原图大图） |
| `message_update.text_start/delta/end` | `AssistantText` | 左列 Markdown 流式追加；同一 assistant 的文本块合并；代码块高亮 + skeleton 占位；token 级追加节流到 30ms 一刷 |
| `message_update.thinking_start/delta/end` | `ThinkingFold` | 默认折叠「已思考 N 秒…」；流式中显示「思考中…」+ 旋转指示；`prefers-reduced-motion` 时静态文案 |
| `message_update.toolcall_start/delta/end` + `tool_execution_start/update/end` | `ToolCard` | 见 §8.3；按 `toolCallId` 把 call 与 result 关联，多工具并行按 `streamIndex` 同组堆叠 |
| `extension_ui_request method=select/confirm` | `ApprovalCard` | 见 §9；内联最高优先级 + composer 锁定 |
| `toolResult`（`message role=toolResult` / `tool_execution_end.result`） | `ToolCard` 结果区 | 成功截断前 2000 字符 + 「展开全文」；失败（`isError`）红边 + 错误文案；`denied` 明确写「被用户拒绝」 |
| `model_changed / thinking_level_changed / title_change / session_exit / agent_start/end` | `SystemDivider` | 居中 12px 灰字，不计入消息计数 |
| `get_state.contextUsage / usage` | `StatusBar` | `token / 上下文% / 耗时 / TTFT`，取 assistant 块 `usage/duration/ttft`，前端不自算 |

### 8.3 ToolCard 四态（逐字抄 gallery 语义）

```
▶ bash · 执行 echo 测试                    ●运行中
  $ echo hello-spike                       [等宽 12px]
▼ read · 读取终端渲染代码                   ✔成功
  crates/…/terminal_view.rs:1-120
  └ 22 matches · 3 files …                 [截断+展开全文]
▼ edit · packages/…/renderer.ts             ✘失败
  └ Hunk @@-177 does not match…            [红边]
```

- 标题行永远一行：状态图标 + 工具名 + `intent`（取 `custom.data.intent` / `partialArgs.i` 中文句）+ 右端状态点。
- 参数摘要按工具定制：`read`→path+行号，`bash`→command，`grep/glob`→pattern+path，`edit/write`→path+变更行数（有则显示），未知工具→JSON 首行截断。
- 默认折叠，失败与等待审批的自动展开一次（用户手动折叠后不再强展）。

### 8.4 Composer

多行输入 + 发送按钮（accent 实心）。Enter 发送 / Shift+Enter 换行 / Esc 停止流式。流式中按钮变「停止」。draft 常驻内存且按会话隔离，发送前不落盘不建消息。等待审批时 composer 锁定并提示「先处理上面的审批」。图片 `@文件` V1 只支持文本路径芯片（images 透传是 Phase 2 事项，不阻塞 V1）。

---

## 9. 权限

### 9.1 三档（全局 + 会话覆盖）

| 档 | 对应值 | 含义 | UI |
|---|---|---|---|
| 每次询问 | `always-ask` | 所有工具执行前审批 | 盾牌灰 |
| 写入时询问 | `write` | 读类直行，写类审批 | 盾牌蓝（默认建议） |
| 全部自动通过 | `yolo` | 跳过所有确认 | 盾牌红 + 「跳过所有确认」警告文案 |

- 全局档：读 `config.yml` / `config list --json` 初值，修改走 `omp config set tools.approvalMode <值>`。
- 会话覆盖：会话菜单「本会话权限」→ spawn 时以 `--approval-mode` 传入 → 存覆盖层 `sessionApproval[sessionId]`。会话关闭后覆盖即失效（不污染全局）。

### 9.2 审批卡（内联，最高优先级）

实测线序（见 `docs/rpc-memo.md` §4）：`toolcall_end` → `tool_execution_start`（`toolCallId/toolName/args/intent`）→ `extension_ui_request{method:select, title:"Allow tool: bash\nCommand: …", options:["Approve","Deny"]}`。回包：`{type:extension_ui_response, id, value:"Approve"}` 通过 / `{cancelled:true}` 或 `value:"Deny"` 拒绝；`confirm` 类用 `{confirmed:true/false}`。

```
┌  需要你的确认 ──────────────────────┐
│ bash · echo hello-spike             │
│ 将在 /tmp/omp-spike-test 执行       │
│ [允许一次] [总是允许(本会话)] [拒绝] │
└─────────────────────────────────────┘
```

- 「允许一次」→ 回 `value:"Approve"`。
- 「总是允许（本会话）」→ 回 `value:"Approve"` + 写覆盖层（本会话此工具类免审——V1 用「会话级 yolo 意向」实现，远端无逐工具 API，不伪装成真逐工具记住）。
- 「拒绝」→ 回 `cancelled:true` → 渲染 `tool_execution_end{isError:true, "Tool call denied by user"}` + assistant 照常总结「执行被拒绝」。
- 等待审批时：composer 锁定、状态点 warn 常亮、审批卡滚动到可视区首屏、按钮键盘可达。

---

## 10. 设置（V1 占位，不做功能）

- 入口保留：左栏底「设置」可点。
- 页面内容：一句说明「V1 暂不在此提供设置。Provider Key、模型目录等请用 `omp` CLI 管理」+ 只读展示 `config path`（调 `omp config path`）+ 复制按钮。**不做任何写入**，避免与 CLI 配置打架。

---

## 11. 数据与接口

### 11.1 覆盖层 `overlay.json`（v1，`$APPDATA/omp-mini/overlay.json`，tauri-plugin-store）

```jsonc
{
  "version": 1,
  "projects": [{ "id": "p1", "path": "/path/to/your/project",
                 "addedAt": 1789455000000, "lastModel": "commandcode/claude-haiku-4-5-20251001",
                 "lastThinking": "off" }],
  "archived":   { "<sessionId>": true },
  "notes":      { "<sessionId>": "用户备注名" },
  "sessionApproval": { "<sessionId>": "always-ask|write|yolo" }
}
```

V1 不引入 sqlite。key 全部用 `session.id`（jsonl `session` 行的 uuid），不用文件名前缀（文件可改名）。

### 11.2 Rust 后端（Tauri commands + per-会话子进程表）

- 进程表：`HashMap<SessionId, Child>`，子进程 = `omp --mode rpc --cwd <项目dir> [--resume <id前缀>] [--model …] [--thinking …] [--approval-mode …]`，stdin 写 JSONL 命令，stdout 按行解析 → 转发 `omp-event://<sessionId>`；状态机转发 `omp-status://<sessionId>`（running/idle/awaiting-approval/error/exited）。
- commands：`list_projects / add_project / remove_project / list_sessions / create_session / open_session / archive_session / unarchive_session / delete_session / send_message / stop / approve / set_model / set_thinking / set_session_approval / get_models / refresh_models / get_global_approval / set_global_approval / locate_omp`。
- 前端 store（Zustand）：`projects / sessions(active,archived) / activeSessionId / eventsBySession / composerDraft / pickers`。事件先落 `eventsBySession` 再渲染，历史回放与实时流同一入口合并。

### 11.3 omp 定位与自检

omp 定位策略：登录 shell `command -v omp` → `which` → 已知前缀（`/opt/homebrew/bin/omp` 等）→ 手动指定。启动自检 `omp --version` + `models --json` 探针，失败给横幅 + 安装提示，不白屏。

---

## 12. 边界与失败模式

- omp 不存在 / 版本过旧 → 启动横幅 + 诊断，不白屏。
- 项目目录被删 → 项目标「目录缺失」，禁新建，可重定位/移除/回放历史。
- jsonl 损坏 → 该会话标「损坏，可删除」，不阻塞列表；超大会话虚拟化 + 结果截断。
- 同一会话被 omp TUI 与本 app 双开 → V1 以文档警告 + 「后开只读提示」处理（文件锁检测放 Phase 3）。
- 删除/归档流式中的会话 → 先 `abort`/kill 再执行。
- 切不支持的思考档 → 禁止提交 + 可用档提示（§7）。
- stdin 关闭 = 进程退出（code 0），后端必须能重建（`open_session` 即重建）。

---

## 13. 验收清单（DoD）

- [ ] §1.2 全链路走通（含审批拒绝与通过两条分支）。
- [ ] kill -9 子进程后重开会话可恢复历史（`switch_session` + 分页回放）。
- [ ] 无 omp 二进制时有引导横幅而非白屏。
- [ ] 浅/深色 + 375px 窄窗无横向滚动（代码块内部滚除外）。
- [ ] 审批按钮键盘可达；`prefers-reduced-motion` 下无打字机/旋转动画。
- [ ] `omp render --plain` 对拍：同一会话文本一致。

## 14. 分期

- **Phase 0（已完成，见 `docs/rpc-memo.md`）**：RPC 协议 spike——握手 / prompt / 审批 / 切模型 / 切思考档 / resume 回放全部实测通过。
- **Phase 1**：项目/会话 CRUD + 覆盖层 + 列表/空态 + 历史回放（`render --plain` / `get_messages_page`）。
- **Phase 2**：长驻 spawn + 流式渲染 + composer/停止 + 审批卡。
- **Phase 3**：模型/思考/权限切换 + 状态条 + 打磨（虚拟化、快捷键、深浅色、诊断页）。

显式假设：① `~/.omp/agent` 可被 `PI_CODING_AGENT_DIR` 覆盖；② 标题以 `title_change` 最新值为准；③ token/耗时以后端透传为准，前端不自算；④ V1 单机单用户。
