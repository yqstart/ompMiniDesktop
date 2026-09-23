# ompMiniDesktop 十九期（V19）：git 工作流重构（提交 / 推送 / 提交信息 / worktree）

> 基线：V18 已交付（终端标签单行 / 会话标题语言，见 `docs/v18-schedule.md`）。
> 用户口径：「git 功能重构，包括提交、推送、生成提交信息、worktree；借鉴成熟产品（Orca / Cursor / ChatGPT / ZCode）；
> **生成提交信息要快**——现在太久」。
> 本稿记录上游实测、设计与完成口径；改这块代码前先读它。

## 0. 结论先行

| 指标 | 改造前（V14） | 改造后（V19） |
|---|---|---|
| 生成提交信息 | 跑完整条 `omp commit` agent 流水线，实测 **16–35s**（空跑一次也要 ~10s） | 一次 `omp -p` 单轮，**实测 p50 3.52s**（5.13 / 2.63 / 3.52） |
| 提交粒度 | 只能「全部改动」（`omp commit` 自动 `add -A`） | **文件勾选**（勾选 = 暂存哪些文件），提交前复查「暂存集合 ⊆ 勾选集合」 |
| 提交信息 | 不可改，生成即提交 | **可编辑**（生成流式进编辑框，落定后随便改再提交） |
| 推送 | 两段式（提交 → 过目 → 「推送」） | 两段式 + **一键「提交并推送」**（首次推送自动 `-u origin <branch>`） |
| worktree | 只有「新建」 | 新建（可选**基于远端最新**）+ **删除**（脏检查 + 二次确认）+ 清理失效登记 + 清理孤儿 |

## 1. 上游实测（omp 18.2.10）

### 1.1 为什么 `omp commit` 慢

二进制内嵌源码（`packages/coding-agent/src/commit/agentic/index.ts`）逐条核对，`omp commit` 的链路是：

1. `Resolving model...`——**刷新模型注册表**（本机 `omp models --json` 冷启实测 10.4s、热启 1.8s；这是空跑也要 ~10s 的主因）；
2. stage（无 staged 改动时 `add -A`，含未跟踪文件）；
3. `Detecting changelog targets...`（维护 `CHANGELOG.md`）；
4. `Discovering context files...`（AGENTS.md 等）；
5. `Starting commit agent...`——**多轮 agent**（`propose_commit` / `split_commit` / `propose_changelog` 三个工具 + 缺工具时追加提醒重试）；
6. 落盘（写 changelog → `git commit`），失败走确定性 fallback。

也就是说：**一次提交信息要付注册表刷新 + 上下文发现 + 多轮工具调用的钱**。它没有「只出信息」的快路径（`omp commit --help` 的全部开关：`--push` / `--dry-run` / `--no-changelog` / `--legacy` / `-c/--context` / `-m/--model`），仓库里也没有可以覆盖提交 agent 的配置文件。

### 1.2 快路径：`omp -p` 单轮（实测）

```bash
omp -p --no-session --no-tools --no-lsp --no-extensions --no-rules \
  --max-time 2m --cwd <repo> --model <modelRoles.commit 的模型> --thinking <档位> "<prompt>"
```

实测结论（临时仓库，2026-09-23）：

| 项 | 结果 |
|---|---|
| 墙钟 | 冷启 5.36s → 去掉规则文件后 **2.28s**（同机热启） |
| stdout | **只有助手文本**（无 `● …` 装饰行）；stderr 只有一行 `Working...` 进度 |
| 会话文件 | `--no-session` 生效：跑前跑后 `~/.omp/agent/sessions/*/*.jsonl` 计数不变（31 → 31） |
| 退出码 | 0 |

**`--no-rules` 是必需的**：带用户级规则时模型会连「每次回复首行写 XXX」这类规则一起执行（实测输出第一行是规则里的开场白）——提交信息必须是干净的一段文本。格式约定因此写在壳侧提示词里（`commit_msg::build_commit_prompt`），不依赖外部规则文件。

模型与思考档取自 `omp config get modelRoles` 的 `commit` 项（本机是 `commandcode/deepseek/deepseek-v4.1-flash:low`）：按最后一个 `:` 拆成 `--model commandcode/deepseek/deepseek-v4.1-flash` + `--thinking low`（读不到就都不传，跟随 omp 默认）。

### 1.3 完整轨（`omp commit`）仍然保留，并且**尊重预置的暂存区**

实测（临时仓库，未勾选的文件是 `left.txt`、勾选的是 `picked.txt`）：

```
完整轨提交内容：picked.txt
```

即：先由壳侧把勾选同步进暂存区，上游见到非空暂存区就不再 `add -A`——**完整轨也遵守勾选**（不需要退回「提交全部改动」语义）。代价仍是那条流水线的耗时（该次实测 23s）。

## 2. 设计

### 2.1 两轨并存

| 轨道 | 入口 | 链路 | 代价 / 取舍 |
|---|---|---|---|
| **快速**（默认） | 「生成提交信息」→「提交」/「提交并推送」 | 勾选 → 暂存 → `git diff --cached` → **一次 `omp -p`** → 编辑框过目 → `git commit` →（可选）`git push` | 秒级；**不**维护 `CHANGELOG.md`、不做 AI 拆分提交 |
| **完整**（可选） | 浮层里切「完整（含 CHANGELOG）」→「完整提交」 | 勾选 → 暂存 → `omp commit`（AI 信息 + changelog 维护 + 校验器）→ 日志流式 | 慢（数十秒）；保留 changelog 自动维护与 split |

两轨共用同一套「任务表 + Channel 事件 + 取消」骨架（`git_commit.rs`），只有执行器不同。

### 2.2 勾选语义（两轨一致）

- 勾选 = **本次提交包含哪些文件**；面板打开时默认勾选「已暂存的文件」，一个都没暂存则**全选**（与 Cursor 同口径）；
- 「生成」与「提交」都会先把勾选同步进 git 暂存区（`git_ops::apply_selection`）：未选中的 `restore --staged`（空仓库用 `rm --cached --force`，因为没有 HEAD）、选中的 `add -A -- <paths>`；
- 提交前**复查**「暂存集合 ⊆ 勾选集合」——出现勾选之外的文件就报 `STAGE_MISMATCH` 并中止（宁可不提交，也不能提交用户没勾的东西）；
- 生成用的 diff 就是暂存区的内容（`git diff --cached`），所以「看到的 == 提交的」。

### 2.3 命令面（IPC）

| 命令 | 干什么 |
|---|---|
| `get_change_set(cwd)` | 面板打开时读一次：文件清单（porcelain `-z` + numstat 增删行数）+ 分支 / 上游 / ahead / behind（**只读**） |
| `generate_commit_message(cwd, paths, language, on_event)` | 快速轨第一步：同步勾选 → 取 `--stat` 与 diff（上限 6 万字符，按行截断）→ `omp -p` → 流式 `delta` → `message` → `exit{phase:"generated", message}`（**不提交**） |
| `commit_selected(cwd, paths, message, push, on_event)` | 快速轨第二步：再同步一次勾选 → `git commit --cleanup=strip -F -`（消息走 stdin）→ `push` 为真则接推送段 |
| `start_full_commit(cwd, paths, language, on_event)` | 完整轨：同步勾选 → `omp commit [--context=…]` |
| `push_workspace(cwd, on_event)` | 只推送：有上游 `git push`；没有上游 `git push -u origin <branch>`（唯一 remote 时用它；多个且无 origin 则报错不猜） |
| `cancel_commit_task(cwd)` | 取消：置取消位 + 打当前子进程的进程组 |
| `get_workspace_git_state(paths)` | 行徽章的批量快照（V14 起，不变） |

事件（`CommitEvent`）：`line`（日志）/ `delta`（生成流，直接进编辑框）/ `message`（解析后的提交信息）/ `phase` / `exit{outcome}`。
阶段（`CommitPhase`）：`idle`（前端本地态）/ `checking` / `generating` / `generated` / `committing` / `pushing` / `committed` / `pushed` / `noop` / `failed` / `canceled`。

### 2.4 取消与并发

- 任务按 **cwd** 建表：不同工作区可并行，同一工作区 `BUSY` 拒绝；
- 取消走 `CancelToken`（标志位 + 通知）而不是 oneshot：**一次任务要跑多个子进程**（暂存 → 生成 → 提交 → 推送），oneshot 被 await 一次就失效；
- 子进程都是新进程组（取消打 `-pid` 覆盖 git / 模型子进程）+ `kill_on_drop` + 各自超时（生成 180s / 提交 120s / 推送 120s / 完整轨 600s）；
- 壳侧的 git 子进程统一带 `GIT_TERMINAL_PROMPT=0`：没有 TTY 时让 git 直接失败，而不是等一个永远不来的输入（凭证不可用时给出「终端里先手动 push 一次」的 hint）。

### 2.5 错误码 → 人话 hint

`failure_hint` 覆盖：无上游 / 认证失败（含 `could not read Username`）/ 非快进或推送被拒 / 钩子拒绝 / 分支未合并 / 暂存区为空。壳侧自有错误码：`NO_CHANGES`、`NO_SELECTION`、`STAGE_MISMATCH`、`MESSAGE_EMPTY`、`DETACHED_HEAD`、`NO_REMOTE`、`GEN_EMPTY`、`BUSY`、`NOT_REPO`、`WORKTREE_DIRTY`、`WORKTREE_BUSY`、`WORKTREE_MAIN`、`UNKNOWN_DEFAULT_BRANCH`。

### 2.6 worktree 生命周期

| 动作 | 实现 |
|---|---|
| 新建 | 仍走 `omp worktree add`（clone-first 与 `~/.omp/wt/<repo>-<slug>` 是 omp 的既有约定）；`new_branch` 时可选**基于远端最新**：先 `git fetch <remote> <默认分支>`，再以 `<remote>/<默认分支>` 为 base |
| 删除 | `git worktree remove [--force] <path>` + `git worktree prune`；**先探脏**：脏目录（`status --porcelain -uall` 非空）返回 `WORKTREE_DIRTY`（消息带变更文件数），前端用后端那句话做二次确认后再带 `force` 重试；目录已被手工删掉则只跑 `prune`（清登记不报错） |
| 终端占用 | 有终端开在该目录时**拒绝**（终端表只在前端，所以这项检查在组件里）；有提交任务在跑时 Rust 侧拒绝（`WORKTREE_BUSY`） |
| 清理失效登记 | `git worktree prune -v`（目录被手工删掉、git 还记着的那些），返回被清掉的条目原文 |
| 清理孤儿 | `omp worktree list --json` 里带 `orphanReason` 的条目 → 确认框（写明是 **`~/.omp/wt` 全域**、不限于本项目）→ `omp worktree clear --json`（**不带** `--all`：上游语义 = 只清孤儿） |

## 3. 源码结构

**后端**

| 文件 | 内容 |
|---|---|
| `src-tauri/src/git_ops.rs`（新） | 变更集读取（`parse_status_porcelain_z` / `parse_numstat_z` / `split_status_header_z`）、勾选 → 暂存的计划（`stage_plan` / `unstage_args` / `add_args`）、`commit_model_args` / `push_args` / `worktree_add_args`、远端默认分支解析（`pick_remote` / `remote_default_branch` / `resolve_remote_base`）、孤儿解析（`parse_orphan_worktrees` / `parse_clear_result`）、命令：`get_change_set` / `remove_worktree` / `prune_worktrees` / `list_orphan_worktrees` / `clear_orphan_worktrees` |
| `src-tauri/src/commit_msg.rs`（新） | 快路径生成器：`generate_args`（固定参数序列）、`truncate_diff`（6 万字符、行边界）、`build_commit_prompt`（格式约定写死在提示词里）、`parse_commit_message`（去围栏 / 去标签行 / 压空行 / 4 千字符上限）、`read_commit_role`、`spawn_generate` |
| `src-tauri/src/git_commit.rs`（重写） | 任务编排（任务表 / 事件 / 取消 / 子进程泵）、`run_git_commit` / `run_git_push` / `spawn_omp_commit` / `classify_full`、`failure_hint`、行徽章快照（`get_workspace_git_state` 不变） |
| `src-tauri/src/git_info.rs` | 只读查询 + `GitInfo.remoteDefault`（`origin/HEAD` 的短名，供「基于远端最新」用）；`run_git_timeout`（fetch / 大仓库操作要更宽的超时） |
| `src-tauri/src/commands/mod.rs` | `create_worktree(project_id, branch, new_branch, base)`（只加 `base`，其余幂等命中 / 分支名校验 / 路径约定不动） |

**前端**

| 文件 | 内容 |
|---|---|
| `src/lib/commitTasks.ts` | 编排：`openCommitPanel` / `loadChangeSet` / 勾选与消息编辑 / `generateMessage` / `commitAndMaybePush` / `fullCommit` / `pushWorkspace` / `cancelCommitTask` / `closeCommitPanel`（+ 行徽章的快照刷新与 30s 兜底轮询，V14 口径不变） |
| `src/components/git/CommitTaskPanel.tsx` | 浮层：轨道切换（快速 / 完整）+ 文件勾选 + 可编辑信息 + 语言三档与「记住选择」+ 结果 / 错误 / hint；完整轨多一块流式日志 |
| `src/components/sidebar/ProjectGroup.tsx` | 行 hover「提交…」（打开面板）/ ahead 徽章一键推送 / worktree 行「删除」+ 脏确认框；项目头「…」（`Broom`）→ 维护面板（清理失效登记 / 清理孤儿）；新建 worktree 面板加基线两档 |

## 4. 完成口径（已达成）

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **211 前端单测** + `e2e:ipc` **58 命令** × 双向一致（`ipc.ts` ↔ `main.rs` ↔ 实现；`rsFiles` 已含新模块）。
- `cargo test` 全绿：**144（bin）+ 114（lib）**；新增 `git_ops` 15 项、`commit_msg` 6 项、`git_commit` 纯函数若干 + **真实仓库**（只用 git，快）集成测试 5 项（`git_commit` 4 + `git_ops` 1）：
  - 勾选 3 个文件里的 1 个 → 提交后 `git show --name-only` 只有那 1 个、另 2 个仍是未提交；
  - 取消勾选会把已暂存的退回（含未跟踪文件）；
  - 推送：无上游自动 `-u`；远端被别的克隆推了新提交 → 拒绝 + hint；
  - worktree：脏目录拒绝（且不删目录）→ `force` 删掉且 `git worktree list` 不再列出；目录已删 → 走 prune 不报错；
  - 远端基线解析：`origin/HEAD` 符号引用、回退 `origin/main`、无远端报 `NO_REMOTE`。
- **真实 omp 慢测试**（`--ignored`）：
  - `real_repo_fast_commit_message`：三次生成 **5.13s / 2.63s / 3.52s（p50 3.52s，验收线 ≤ 6s）**，产出示例 `feat: Added f1.txt 初始内容` + 中文正文；
  - `real_repo_full_commit_honors_selection`：完整轨产出 `picked.txt` 单文件提交（尊重勾选），未勾选的 `left.txt` 未被顺带提交。
- **界面核对**（`pnpm build` + `pnpm preview` + `evaluateOnNewDocument` 注入 IPC mock，命令清单一次补齐 20+ 条）：
  - 行 hover 出现「提交…」/「删除 worktree」；点开面板默认只勾已暂存文件、chip（`M` / `A` / `??`）与 `+N −M` 正确；
  - 「生成提交信息」→ 后端收到的 `paths` 与 `language` 与界面一致，流式 delta 进编辑框、阶段变「已生成，可编辑后提交」、消息为空时「提交」禁用；
  - 勾选变化 → 「提交并推送」把 `paths` / 编辑后的 `message` / `push:true` 原样发出；结果区列出 `abc1234`；
  - 切「完整（含 CHANGELOG）」→ 勾选区与编辑框退场、日志区出现，点「完整提交」后端收到 `start_full_commit`，日志两行 + `def5678` 结果 + 「推送」按钮出现；
  - worktree 删除：首次调用（`force:false`）→ 后端 `WORKTREE_DIRTY` → 确认框显示「worktree 里有未提交改动（3 个文件），删除会永久丢失」→ 确认后带 `force:true` 重发；
  - 维护面板：`清理孤儿 worktree（1）` + 孤儿路径与原因；「清理失效登记」→「清理了 1 条失效登记」；孤儿确认框写明「全部位于 ~/.omp/wt，不限于本项目」→「清理了 1 个孤儿 worktree」；
  - 深色皮肤与英文界面（Fast / Full (with CHANGELOG) / Commit & push / Files in this commit）各截图核对。
- 未单独实测：真实仓库里「推送失败（非快进）」在界面上的完整往返（Rust 侧已有真实仓库测试 + hint 断言）；应用退出瞬间的提交任务清理（与 V14 同口径：`kill_all` 置取消位 + 杀进程组）。

## 5. 与 V14 口径的差异（读老文档时注意）

| 主题 | V14 | V19 |
|---|---|---|
| 谁写 git index | 只有 `omp commit`（壳不碰） | 壳侧 `git add/restore/commit/push`；完整轨仍交给 `omp commit`（但先由壳预置暂存区） |
| 提交范围 | 全部改动（`add -A`） | 勾选的文件（默认 = 已暂存；都没暂存则全选） |
| 提交信息 | `omp commit` 生成、不可改 | 默认壳侧单轮生成 + **可编辑**；完整轨仍由 `omp commit` 生成 |
| 推送 | `omp commit --push` | `git push`（无上游自动 `-u`）；完整轨推送也走它 |
| 行徽章入口 | 点按钮直接开任务 | 点「提交…」**打开面板**（ahead 徽章仍是一键推送）；后端预检 `decide` 随之删除，改由面板的变更集 + 暂存校验裁决 |

## 6. 后续候选（需用户确认再开工）

- 「附加说明」自由输入（`omp commit -c`，或在快路径提示词里加一行用户要求）；
- 提交前的**只读 diff 预览**（点文件看改动，向 Cursor 看齐——当前明确不做 diff 渲染）；
- 「同步远端」（behind 时 `pull --rebase` 再推）与「创建 PR」（`gh pr create`）；
- 每工作区的提交历史（现在结果只列本次任务产生的提交）。
