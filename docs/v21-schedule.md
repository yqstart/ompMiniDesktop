# ompMiniDesktop 二十一期（V21）：工作区重定义（多项目容器 + 全自动协作根）

> 基线：V20 已交付（左栏精简 / 移除项目 / 活动项目文件夹标识）。
> 用户口径（两轮确认）：「左侧工作区的概念要进行重新定义：1. 工作区可以包含多个项目，多个项目可以进行协作，类似 Cursor 的工作区；
> 2. 一个工作区内的多个项目怎么协作需要你设计——场景：一个工作区内一个前端项目、一个后端项目，我给需求，前端和后端可以一起开发」。
> 形态确认：**工作区 → 项目 → 目录行**（未分组兜底平铺）；协作触发选**全自动挂载**。
> 本稿记录上游实测、概念定义、数据模型、交互与完成口径；改左栏 / 终端这块前先读它。

## 0. 结论先行

| 项 | 之前（V20） | 现在（V21） |
|---|---|---|
| 左栏顶层 | 项目（平铺） | **工作区**（自定义分组）→ 项目 → 目录行；无自定义工作区时平铺项目；存在自定义工作区时未分组项目收进「未分组」区 |
| 代码里的 `WorkspaceView` | 目录行（主目录 / worktree） | **改名 `CheckoutView`**（目录行）；`WorkspaceView` 让位给工作区（容器） |
| 左栏选中 | `activeWorkspacePath`（目录） | **`selection`**：`{kind:"group", id}`（工作区视图，含 `id:null` = 未分组）或 `{kind:"checkout", path}`（目录视图） |
| 终端过滤 | cwd 精确匹配选中目录 | 选中项**范围**（工作区 = 组内全部项目的目录；目录 = 该目录；null = 不过滤） |
| 终端 spawn | `omp --cwd <dir> [--resume id]` | **全自动**：cwd 所属项目在某个多成员工作区时，追加 `--add-dir <其余成员项目主目录>…` 与 `--append-system-prompt <工作区拓扑说明>` |
| 命令面 | `list_workspaces`（目录行） | `list_checkouts`（目录行）+ `list_workspaces` / `create_workspace` / `update_workspace` / `delete_workspace`（工作区容器） |

## 1. 上游实测（omp 18.3.0，2026-09-24）

三组真实 `omp -p` 探测（临时目录自建自清，`/tmp/omp-v21-probe`）：

1. **`--add-dir` 是可用的多根机制**（`omp --help`：`Add a workspace directory beyond the working directory (repeatable)`）。
   `omp -p --cwd front --add-dir back` 下，agent 用 write 在 `back/` 里成功建文件、read 成功读回——**附加根读写皆通**（不只是只读）。
   配置面另有 `workspace.additionalDirectories`（全局数组，`/add-dir`、`/remove-dir` 运行时管理）——**壳侧不用它**（避免影响用户在终端里自己跑的所有会话），
   per-spawn 的 `--add-dir` 已足够且无全局副作用。
2. **跨根 AGENTS.md 会被发现**：`back/AGENTS.md` 里的「端口固定 8099」被会话准确读出——
   每个成员项目自己的规则文件在会话里自动生效，无需壳侧代劳。
3. **`--append-system-prompt=<多行文本>` 有效**：注入的 `[WORKSPACE-NOTE]…` 段被模型逐字引用——
   壳侧可以把「工作区拓扑」注入会话，让 agent 开局就知道协作关系。

结论：协作地基全部由 omp 原生能力承担，壳侧只做「**把正确参数喂给 spawn**」这一件事。

## 2. 概念与数据模型

### 2.1 三层概念（命名定稿）

| 概念 | 说明 | 代码载体 |
|---|---|---|
| **工作区（Workspace）** | 多项目容器：有名字、有一组成员项目；协作的边界 | `overlay.workspaces: Vec<Workspace{id,name,created_at}>` + `Project.workspace_id: Option<String>` |
| **项目（Project）** | 一个本地目录（git 仓库），全局唯一归属 | `overlay.projects`（现状，加 `workspace_id`） |
| **目录行（Checkout）** | 项目主目录 / 它的一个 git worktree（**只读展示**，V20 口径不变） | `list_checkouts`（原 `list_workspaces`，纯改名） |

- **一个项目最多属于一个工作区**（`workspace_id`；`null` = 未分组）。唯一归属让「终端挂载哪些根」「右栏范围」都有唯一答案。
- 工作区**允许为空**（先建组后加项目）；项目加入 / 移出工作区只改覆盖层，**不碰任何文件**。
- 迁移：旧 `overlay.json` 无 `workspaces` 字段 → 反序列化默认空数组；全部项目 `workspace_id=null`（未分组）→ 左栏退回平铺形态，**零破坏**。
- `normalize()` 新增清理：去重工作区 id；清掉指向不存在工作区的 `workspace_id`（悬空引用置 null）。

### 2.2 选中模型（前端）

```ts
type SidebarSelection =
  | { kind: "group"; id: string | null }   // 工作区视图（null = 未分组区）
  | { kind: "checkout"; path: string };    // 目录视图
// store: selection: SidebarSelection | null（null = 无可用目录，终端不过滤）
```

- **范围**（scope）= 选中项覆盖的目录集合：工作区 = 组内全部项目的全部目录（主目录 + worktree）；目录 = 自身；null = 不过滤。
- 不变式：`activeTerminalId` 要么 null，要么落在 scope 内。`openTerminal` / `focusTerminal` / `closeTerminal` / 刷新收敛四处维持。
  - `openTerminal`：新终端 cwd 落在当前工作区范围 → 保持工作区视图；否则切到目录视图。
  - `focusTerminal`：终端已在 scope 内 → 只切激活（**不缩窄视图**，从工作区视图点组内终端不会丢掉别的终端）；不在 → 切到它的目录视图（⌘⇧K 跨组跳转的落点）。
  - `closeTerminal`：在同 scope 内收敛到相邻终端。
  - 刷新（`loadCheckouts`）：selection 失效（工作区被删 / 目录不见）→ 回退第一个可用目录；`activeTerminalId` 收敛到 scope 内最近的终端。

## 3. 交互与协作机制（本次设计的核心）

### 3.1 左栏

- 有自定义工作区时：`[工作区头] → 成员项目（ProjectGroup，与现状同款）→ 目录行`；其后是「未分组」区。
  没有自定义工作区时：项目平铺（与现状完全一致，单项目用户无感）。
- **工作区头**：折叠箭头 + 名字（点击 = 选中工作区视图）；hover：`＋`（在组内首项目主目录开新终端）、`PenLine`（打开工作区编辑对话框）。
- **新建工作区**入口 = 左栏「终端工作区」标题行的 `Layers` 按钮（与「添加项目」并列）。
- **工作区编辑对话框**（新建 / 编辑共用）：名字输入 + 项目勾选列表 + 「添加本地目录」（区头右侧；走 `pickAndAddProject`——与左栏「添加项目」同一实现，新项目立刻进列表并**自动勾选**为成员，不必先退出对话框去左栏加项目）+（编辑时）删除工作区。
  失败**就地显示在对话框里**（模态遮着侧栏，错误条放到外面会看不见）；用户取消目录选择不算错误。
  删除工作区 = 成员回到未分组（danger 二次确认；不删项目、不删文件）。

### 3.2 全自动协作根（用户选定口径）

终端 spawn 时（`TerminalPane` → `pty_spawn`）：

1. 由 cwd 找到所属项目 → 所属工作区；**工作区成员项目数 ≥ 2** 时生效；
2. `--add-dir <其余成员项目的主目录>`（逐个；**只加其他项目的主目录**，不加它们的 worktree——worktree 是分支工作态，不进协作集）；
3. `--append-system-prompt <工作区说明>`（界面语言；内容 = 工作区名 + 成员项目名/路径 + 「这些目录都已挂入、可读写」+ 「跨项目改动同时验证、需要并行时用 task 子代理」）。

- 未分组项目、单成员工作区：**不追加任何参数**（与现状一致）。
- 提示词注入文本以固定前缀开头（中：`【ompMiniDesktop 工作区】`、英：`[ompMiniDesktop workspace]`），不会被误判成文件路径。
- 终端 tab 悬停显示「工作区协作根」快照（spawn 时实际生效的 `addDirs`，写回 store 的 `TerminalView.collab`）。
- resume / 重启：每次 spawn 都按**当时**的工作区成员重算（用户改了分组，重启即生效）。

### 3.3 协作机制全貌（回答「怎么协作」）

| 层 | 机制 | 承载 |
|---|---|---|
| 空间 | 一个会话挂多个项目根，跨项目 read/grep/edit/write/跑命令 | `--add-dir`（实测读写皆通） |
| 认知 | 会话开局就知道「这是多项目工作区、成员是谁、在哪」 | `--append-system-prompt`（实测多行有效） |
| 规则 | 每个成员项目自己的 `AGENTS.md` 规则自动生效 | omp 多根规则发现（实测） |
| 并行 | 需要同时推进两端时，agent 自己用 task 子代理并行 | omp 原生，提示词里点一句 |
| 隔离 | 想只动一个项目：把项目移出工作区（或建单成员工作区） | 覆盖层归属 |

## 4. 命令面变化（IPC）

| 命令 | 变化 |
|---|---|
| `list_workspaces` | **改名 `list_checkouts`**（返回 `CheckoutView`，内容与 V20 一致） |
| `list_workspaces`（复用名） | 新增：工作区列表（`WorkspaceView {id,name,createdAt,projectIds}`） |
| `create_workspace` | 新增：`name` + `projectIds` → 落盘并返回新工作区 |
| `update_workspace` | 新增：`id` + `name` + `projectIds`（一次写全：改名 + 成员重设，成员移出者回归未分组） |
| `delete_workspace` | 新增：删组，成员回归未分组（不删项目） |
| `list_projects` | `ProjectView` 增加 `workspaceId` |
| `pty_spawn` | `PtySpawnOpts` 增加 `addDirs: string[]`（默认空）与 `appendSystemPrompt: string \| null`（默认无） |

校验：工作区名 trim 后非空；`projectIds` 里不存在的 id 忽略；`update` / `delete` 的 id 不存在时报 `NOT_FOUND`。

## 5. 源码结构变化

- `src-tauri/src/overlay.rs`：`Project.workspace_id`、`Overlay.workspaces`、`normalize` 清理（含单测）。
- `src-tauri/src/commands/mod.rs`：`WorkspaceView` → `CheckoutView`、`list_workspaces` → `list_checkouts`；
  新增工作区四命令 + `WorkspaceView`（容器）与 `workspace_views()` 组装。
- `src-tauri/src/pty.rs`：`PtySpawnOpts.add_dirs / append_system_prompt` → args 拼装（`--add-dir` 逐个、`--append-system-prompt=<文本>`）。
- `src/shared/types.ts`：`CheckoutView`（改名）/ `WorkspaceView`（容器）/ `SidebarSelection` / `PtySpawnOpts` 扩展。
- `src/lib/workspaces.ts` → **`src/lib/checkouts.ts`**（目录行取数 / 显示名 / 打开聚焦 / 新终端目标 / resume）+ **`src/lib/workspaceGroups.ts`**（工作区取数、scope 计算、协作上下文构造——纯函数，含单测）。
- `src/lib/terminalScope.ts`：按 scope 过滤（`terminalsInScope`）。
- `src/stores/app.ts`：`checkouts` / `workspaceGroups` / `selection`；终端操作三入口与收敛逻辑更新。
- 组件：`WorkspaceSidebar`（工作区区段渲染 + 新建入口）、`WorkspaceGroupSection.tsx`（新：组头 + 成员 + 选中/＋终端/编辑入口）、`WorkspaceGroupDialog.tsx`（新：新建 / 编辑对话框）、`ProjectGroup`（适配）、`TerminalPane`（spawn 参数）、`TerminalTabs` / `TerminalView` / `QuickSwitcher` / `App`（scope 过滤与热键）。

## 6. 完成口径（已达成）

- 左栏：新建工作区（勾选项目）→ 组头下出现成员项目；「未分组」区收纳其余项目；无自定义工作区时与 V20 形态一致。
- 选中组 → 右栏显示组内全部终端；选中目录行 → 只显示该目录终端；⌘1..9 与标签栏跟随同一范围。
- 多成员工作区里开终端（任意目录行或组头＋）→ `omp` 参数含其余成员项目主目录的 `--add-dir` 与工作区说明注入；单成员 / 未分组 → 参数与 V20 一致。
- 无残留旧概念（`activeWorkspacePath` 与 `detachTerminalProject` 已删；`WorkspaceView` 只指容器；`list_workspaces` 只剩容器语义）。
- `pnpm check`（typecheck + lint + vitest 228 项 + e2e:ipc 56 命令双向一致）与 `cargo test --locked`（137 项，7 ignored）全绿。

## 7. 实测记录（2026-09-24）

**上游三项**（真实 `omp -p` 探测，临时目录自建自清，见 §1）：

1. `--add-dir` 的额外根**可写可读**（write 建文件成功、read 读回一致）；
2. 跨根 `AGENTS.md` 被自动发现（「端口固定 8099」被准确读出）；
3. `--append-system-prompt=<多行文本>` 注入段被模型逐字引用。

**壳侧真实界面核对**（`pnpm build` + `vite preview` + Chromium 注入 `__TAURI_INTERNALS__` mock，1320×860）：

1. 左栏渲染：组头（`全栈电商` + 成员计数 + hover `＋`/`PenLine`）→ 成员项目（frontend 主目录 + login worktree / backend）→「未分组」区（infra）；
2. 点组头 → `aria-current="location"` 落在组头；
3. 组视图里点标签栏 `＋` → `pty_spawn` 实测参数：`cwd=/tmp/demo/frontend`、`addDirs=["/tmp/demo/backend"]`、`appendSystemPrompt` = 工作区拓扑说明；标签悬停提示出现「Collaboration roots: /tmp/demo/backend」（spawn 写回的 `TerminalView.collab` 生效）；
4. 单成员工作区（`数据平台` = infra）开终端 → `addDirs: []`、`appendSystemPrompt: null`（与 V20 行为一致）；
5. 新建 / 编辑工作区对话框：名字 + 成员勾选（已在别的组里的项目行尾标出组名）+「创建」→ `create_workspace {name, projectIds}` 参数正确；编辑回填名字与勾选；「删除工作区」→ 二次确认（成员回归未分组）；
6. 快速切换（⌘⇧K）三分组：已打开的终端 / 工作区（含成员名）/ 工作区目录（4 个目录行）；
7. 范围过滤：目录视图只显示该目录的终端、组视图显示组内终端，标签栏与 `⌘1..9` 同源。
