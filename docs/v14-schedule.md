# ompMiniDesktop 十四期（V14）：工作区「提交并推送」（omp commit 集成）——设计稿

> 基线：V13 已交付（快速切换环，见 `docs/v13-schedule.md`）。
> 目标：给左栏每个工作区（项目主目录 / 各 git worktree）一个**提交并推送**入口，底部走上游
> `omp commit`（AI 生成提交信息 + changelog 维护 + push）——不自己拼提交信息、不自己动 git index 语义。
> 用户口径：「快捷的 commit && push，调用 omp commit 等命令实现」「Cursor 那种：多个任务一起跑但可以分别提交」。
> 本稿只排 V14；实现落地后同步 `AGENTS.md`、`CHANGELOG.md`、`MASTER.md`。

## 0. 范围与口径（本批已定）

|#|决策|选择|
|---|---|---|
|1|交互|**两段式**：先提交（AI 生成信息，~20s）→ 浮层展示提交信息 → 确认后推送（~2s 快路径）。不点推送直接关 = 只提交不推送（本地可改）|
|2|入口|**左栏工作区行**：hover 出现动作按钮 + 行尾常驻状态徽章。每个工作区（主目录 / worktree）独立、**可并行**、结果互不干扰|
|3|等待|**可后台**：浮层运行中可关闭，任务继续；行徽章持续指示，点徽章重开浮层|

**范围外**：

- 不做文件级 stage / unstage / 逐文件选择提交（`omp commit` 是「全部改动」语义；要精细控制在 `omp git` 或终端里做）。
- 不做 diff 展示、不做提交历史浏览器。
- 不引入文件监听 / 轮询做实时变更数（状态刷新时机见 §2.5；要实时变更列表属于另一个功能）。
- 不传 `-c` 附加说明（保持与用户既有 omp commit 工作流一致；能力已实测，见 §1，可选增强在 §6）。
- 不做「撤销提交」：commit 后可关闭浮层、在终端里自有处理；壳侧不造回退语义。

## 1. 上游事实（omp 18.2.4 实测，隔离临时仓库）

**① `omp commit` 是 AI 流水线**：`Resolving model...`（用 `modelRoles.commit` 角色，实测
`opencode-go/deepseek-v4.1-flash:high`）→ `Detecting changelog targets...`（维护 `CHANGELOG.md`，
受 `startup.changelogMode` 控制）→ `Discovering context files...`（AGENTS.md 等）→ commit agent
（GitOverview / GitFileDiff / RecentCommits / ProposeCommit 工具）→ `Creating commit...`。

**② 行为矩阵（退出码取真实重定向值，非管道）**：

|场景|链路|退出码|耗时|
|---|---|---|---|
|有改动|stage 全部 → AI → commit（`--push` 时再 push）|0|16–35s|
|无改动 + 有未推送提交|**跳过 AI**：`No changes to commit; pushing existing commits...` → push|0|~2s|
|无改动 + 已同步|同上（空推）|0|~10s|
|push 失败（无 remote）|commit 已成立、push 报错|**1**|~19s|
|push 失败（分支无 upstream）|`✗ Push failed: fatal: ... no upstream branch`（git 原文）|**1**|~2s|
|非 git 仓库|`VcsError: not a repository` + **JS 堆栈**|1|0.2s|

要点与壳侧结论：

- **stage 语义**：无 staged 改动时自动 `staging all changes...`，**含未跟踪文件**（实测
  `?? untracked.txt` → `A  untracked.txt`）——UI 文案必须写「提交全部改动（含新文件）」。
- **可能拆分为多个提交**：无关改动会走 `SplitCommit`（实测两个无关新文件 → `Commit 1` / `Commit 2`）
  ——结果展示要支持多条提交信息。
- **`--push` 的快路径**（无改动 + 有未推送提交 → 直接 push，~2s）是 §2 第二段「推送」按钮的复用路径；
  **有未提交改动时 `--push` 会先 commit 再 push**（即重跑也安全）。
- **退出码可信**：0 = 全链路成功；1 = 失败。**部分成功**（commit 成立、push 失败）需要壳侧用
  「运行前后 HEAD 对比」判定——退出码本身分不出「commit 失败」与「push 失败」。
- **非仓库输出是堆栈**：不能直接进 UI——预检必须先挡（§2.5）。
- 输出含少量 ANSI 颜色码（`ESC[38;2;...m`）；进度在 stdout，git 错误混在 stderr——两路都要读、都要去 ANSI。
- `-c/--context` 可传额外要求（实测中文：正文中文、**摘要仍必须英文过去式动词开头**——上游校验器硬约束，
  不承诺全中文）。
- 相关配置：`modelRoles.commit`、`commit.*`（map-reduce / cache）、`startup.changelogMode`。

## 2. 设计

### 2.1 状态机（两段式）

```text
点击动作按钮
  ├─ 有改动      → checking → committing(--AI ~20s) → committed（待推送）
  │                                                      └─ 点「推送」→ pushing(~2s 快路径) → pushed
  ├─ 无改动 + ahead → pushing（直接第二段）
  └─ 无改动 + 同步  → noop（「没有可提交或推送的改动」，不跑 omp）
任一运行段失败 → failed（错误 + hint；HEAD 已变的 push 失败标注「已提交，推送失败」）
运行中用户取消 → canceled（进程组杀掉；staged 状态保留）
```

- 第二段推送 == `omp commit --push`：无改动时走 2s 快路径；若用户在等待期间又改了文件，
  它会**先提交新改动再推送**（语义自洽，符合「提交并推送」按钮的含义）。
- 「推送」失败（无 upstream）错误透传 git 原文 + hint（`git push -u origin <branch>`）。

### 2.2 入口（左栏工作区行）

行尾右侧 = **状态区**（常驻，与 worktree 徽章并列）+ **hover 动作按钮**：

|行上状态|来源|表现|点击|
|---|---|---|---|
|有未提交改动|git 快照|分支名左侧小实心点 + hover 动作按钮（`ArrowUpCircle`，title「提交并推送」）|开始第一段|
|无改动 + ahead|git 快照|`BranchUp` 徽章（accent 色，常驻）|开始第二段（推送）|
|都没有|git 快照|无徽章；hover 按钮禁用（title「没有可提交的改动」）|—|
|任务运行中|任务记录|`Loader` 旋转徽章（常驻）|打开浮层|
|任务失败|任务记录|`AlertTriangle` 徽章（danger，常驻直到重试/关闭浮层）|打开浮层|
|任务成功|任务记录|关闭浮层后清除（此时 git 快照接管：若有 ahead 自然显示推送徽章）|—|

**真相边界**：行徽章的「有无改动 / ahead」来自 **git 快照**（§2.5），只有「运行中 / 失败」来自任务记录
——任务记录不复制 git 状态，两者不打架（`committed` 后关闭浮层，git 快照立刻变成「ahead → 推送徽章」）。

**增补（2026-09-18）：行上补全与远程分支的差异**——`status --porcelain -b` 的头部本来就有全部信息，
不需要新的命令或轮询，快照投影补两态即可：

|行上状态|来源|表现|点击|
|---|---|---|---|
|behind（落后远程）|git 快照|`BranchDown` 徽章（warn 色 + 数量；只读——壳侧不做 pull）|—|
|无上游 / 上游已被删除（`[gone]`）|git 快照|`LinkOff` 淡色标记（title 分「还没有上游」/「上游分支 x 已被删除」）|—|
|与远程一致|git 快照|无标记（留白 = 已同步；上游缺失有专门标记，不会被误读成同步）|—|

detached（没有分支名）与非仓库不标上游缺失；ahead / behind 可并存（分叉时 `↑n ↓m` 并列）。
`WorkspaceGitState` 增 `behind` / `upstreamGone` 两个字段，`decide` 的预检结论不变（behind 不影响第一、二段的选择）。

### 2.3 浮层 `CommitTaskPanel`

- 单例浮层（同一时刻显示一个任务），内容 = 当前查看任务（`activeCommitCwd`）。
- 结构：标题（`提交并推送 · 项目名 · 分支`）→ 阶段行 → **日志区**（等宽、已去 ANSI、自动滚底、
  上限 1000 行）→ 结果区（`committed` / `pushed` 时列出本次提交：短 sha + subject，多条即多行）→ 底部按钮。
- 底部按钮随阶段：运行中 `取消`；`committed` `推送`（主按钮）+ `关闭`；`failed` `重试` + `关闭`
  （push 段失败且 HEAD 已变时 `重试推送`）；终态 `关闭`。
- **关闭 ≠ 取消**：运行中关闭 = 转后台（按钮语义写明）；取消只走 `取消` 按钮。
- 关闭后任务继续；行徽章指示；点徽章重开（日志与结果都还在——见 §2.4 的 store 结构）。

### 2.4 数据流与后端

```text
WorkspaceRow 按钮 → api.startCommitPush(cwd, channel) / api.pushCommits(cwd, channel) / api.cancelCommitPush(cwd)
git_commit.rs：预检 → spawn omp commit [--push]（新进程组、kill_on_drop）
  → 读两路输出（按行、去 ANSI）→ Channel 事件 → 前端 store（任务记录）→ 浮层渲染
```

**后端（新模块 `src-tauri/src/git_commit.rs`）**：

|命令|干什么|
|---|---|
|`start_commit_push(cwd, channel)`|预检 → 有改动走 `omp commit`（第一段）；无改动 + ahead 走 `omp commit --push`（第二段）|
|`push_commits(cwd, channel)`|`omp commit --push`（第二段 / 重试 / 直接推送）|
|`cancel_commit_push(cwd)`|杀进程组；任务置 canceled|

- **Channel 事件**：`{type:"line", text}`（已去 ANSI）/ `{type:"phase", phase}` / `{type:"exit", outcome}`；
  `outcome = { phase, commits: [{sha, subject}], error, hint }`——`commits` 由**运行前后 HEAD 对比 +
  `git log` 读得**（不回解析 omp 的人类输出，稳）。
- **任务表**：`AppState` 增加 `commit_tasks: Arc<Mutex<HashMap<cwd, TaskHandle>>>`；同一 cwd 已有任务 →
  `BUSY` 拒绝（前端按钮态 + 后端双保险）；不同 cwd 允许并发（Cursor 式「多个任务一起跑」）。
- **取消 / 退出清理**：spawn 时建新进程组（`process_group(0)`），取消与应用退出（`lib.rs` 的
  `RunEvent::Exit`）沿 PTY 的强杀口径打整个进程组，防 git 子进程残留。
- **去 ANSI**：Rust 侧纯函数（状态机，覆盖 CSI 序列），带单测。

**前端**：

- `src/lib/commitTasks.ts`（新）：任务编排（`startCommitPush` / `pushCommits` / `cancelCommitPush` / 状态刷新
  触发），Channel 回调写 store。
- `src/stores/app.ts`：`commitTasks: Record<cwd, CommitTaskView>`（`log` 行数组有上限）、
  `activeCommitCwd: string | null`（浮层显示哪个）。
- `src/components/git/CommitTaskPanel.tsx`（新，沿用 `ConfirmDialog` 的对话框层级与 `useDialogFocus`；
  z-index 30 同对话框层——与确认框并存时用户不会同时开两个）。
- `ProjectGroup.tsx` 的 `WorkspaceRow`：状态区 + hover 按钮 + 徽章（复用现有 hover 语言）。

### 2.5 预检与状态刷新（不轮询）

**预检（后端，运行前第一步）**：

1. 目录存在 + `git rev-parse --is-inside-work-tree` → 否则「不是 git 仓库」（挡掉 omp 的 JS 堆栈）。
2. `git status --porcelain -b`（一条命令同时给变更列表与 `## branch...upstream [ahead N]` 头）
   → `dirty` / `ahead` / `upstream` 三值（解析为纯函数 + 单测；无 upstream 时头部无 `...` 段）。
3. 决策：`dirty` → 第一段；`!dirty && ahead > 0` → 第二段；`!dirty && ahead == 0` → noop（不跑 omp，省 10s）。

**行徽章的 git 快照刷新时机**（`get_workspace_git_state(paths[])` 批量命令，落 store；不轮询、不监听）：

- 应用启动（`loadWorkspaces()` 之后）；
- 任何 commit 任务结束后（该行）；
- 窗口 `visibilitychange` 转可见时；
- **任一终端的 π 状态从工作态转入就绪 / 等待确认时**（防抖 2s）——omp 刚干完活是最可能有改动的时点，
  零轮询成本的「聪明时机」。

终端里手工改文件后徽章可能滞后（到下次触发点），但**后端预检是最终裁决**：点按钮时重查，不会误导执行。

## 3. 实现清单

**后端**：`src-tauri/src/git_commit.rs`（3 命令 + 任务表 + 预检 + ANSI strip + 单测）；`main.rs`
（`generate_handler!` 注册）；`lib.rs`（Exit 清理并入）；`commands/mod.rs`（`AppState` 加 `commit_tasks`）。

**前端**：`shared/ipc.ts`（3 命令常量）+ `shared/api.ts` + `shared/types.ts`（`CommitPhase` /
`CommitTaskView` / `CommitEvent` / `WorkspaceGitState`）；`lib/commitTasks.ts`；`stores/app.ts`；
`components/git/CommitTaskPanel.tsx`；`components/sidebar/ProjectGroup.tsx`（`WorkspaceRow`）；
`lib/locale.ts`（约 20 键 × 2 语言）。

**契约与脚本**：`scripts/e2e-ipc-selfcheck.mjs` 的 `rsFiles` 数组要加 `git_commit.rs`
（否则「后端实现」核对会失败）。

**文档**：本稿；实现后 `AGENTS.md`（源码结构 + 核心数据流）、`CHANGELOG.md`、`design-system/MASTER.md`
（若新增浮层模式需要登记）。

**依赖**：无新增。

## 4. 边界与风险

|#|事项|决策 / 说明|
|---|---|---|
|1|omp commit 自动 stage 全部（含未跟踪）|UI 文案写明「提交全部改动（含新文件）」；不做部分提交|
|2|一次任务可能拆出多个提交（SplitCommit）|结果区按条列出；「推送」一并推|
|3|push 失败但 commit 已成立|以 HEAD 对比判定部分成功，文案「已提交，推送失败」+ 重试|
|4|分支无 upstream|错误透传 git 原文 + hint（`git push -u`）；壳侧不代设 upstream|
|5|非仓库 / omp 缺失|预检挡非仓库；`HealthBanner` 已覆盖 omp 缺失（按钮随之禁用）|
|6|取消时机|omp 先 `add -A`，取消后 staged 保留（本来就是要提交的内容）；文案说明|
|7|同一工作区并发|BUSY 拒绝；不同工作区允许并行|
|8|任务中应用退出|进程组强杀（跟随 PTY 收尾口径）；已生成的本地 commit 保留|
|9|日志体积|行数 / 字节双减（保尾），防异常输出撑爆 store|
|10|老版本 omp 无 `--push`|错误原样透传，不查版本|
|11|状态快照滞后|不引入轮询；预检为最终裁决（§2.5）|

## 5. 完成口径（已达成）

- `pnpm check` 全绿：typecheck / lint（0 警告）/ **103 单测** / `e2e:ipc` **49 命令** × 双向一致
  （`ipc.ts` ↔ `main.rs` ↔ 实现；新模块已进 `rsFiles` 清单）。
- `cargo test` 全绿：**98 项**（`git_commit` 新增 7 项——`strip_ansi`（CSI / OSC / 未终止）、
  `status --porcelain -b` 解析（dirty / ahead / behind-only / 无上游 / detached）、`decide` 三路 +
  无上游走 Push、`classify`（committed / noop / pushed / canceled / 部分成功）、`failure_hint`）。
- **真实仓库两段式慢测试**（`cargo test -- --ignored real_repo_two_stage_flow`，~25s，临时仓库自建自清）：
  有改动 → 预检 `Commit` → AI 提交成功（`commits_in_range` 读到新提交、subject 非空）→ 预检转 `Push`
  → 快路径推送（**远端 HEAD 与本地一致**）→ 新分支无上游 → 推送失败（退出码 1）+ hint。
- 界面核对（静态构建 + 注入 IPC mock，中英双语）：行徽章——dirty 点 / `BranchUp` + 数量（点击推送）/
  运行中 `Loader` / 失败 `AlertTriangle`（点击重开浮层，错误 + hint + 重试）与关闭即清；浮层两段式流转——
  运行中（取消 / 后台运行）→ committed（提交列表 + 「推送」）→ pushed（「已提交并推送」）；
  「后台运行」关闭后任务在后台完成、成功即清记录、hover 按钮回归；取消按钮触发 `cancel_commit_push` IPC；
  每次任务结束都触发 `get_workspace_git_state` 快照刷新；深浅两套皮肤截图核对。
- 应用退出路径：`RunEvent::Exit` 里 `git_commit::kill_all`（与 PTY 同口径；未单独实测退出瞬间的进程组清理——
  与既有 PTY 收尾共用 `force_kill_group`）。
- 未单独实测：两个工作区同时提交的真实并发（代码层保证：任务按 cwd 建表、不同 cwd 互不阻塞）；
  前端按钮态的 BUSY 撞车（后端拒绝 + 错误展示）。

## 6. 后续候选（需用户确认再开工）

- 浮层内可选「附加说明」（`omp commit -c <text>`）输入框。
- 「只提交不推送」的独立入口（当前：两段式里不点推送即只提交）。
- 顶栏快捷键（如 ⌘⇧K 对当前工作区开一个提交任务）。
- 常驻变更数（需要文件监听或轮询）。（ahead / behind 差异徽章已于 2026-09-18 实现——数据本来就在快照里，见 §2.2 增补）
- 多仓库汇总面板（Cursor 的 Source Control 式一览）——工作区树 + 行徽章已覆盖主要动线，
  是否值得独立面板待验证。
