# ompMiniDesktop 二十期（V20）：左栏精简（去 worktree 管理 / 移除项目 / 活动项目文件夹标识）

> 基线：V19 已交付（git 工作流重构：提交 / 推送 / 提交信息 / worktree，见 `docs/v19-schedule.md`）。
> 用户口径：「左侧项目列表上去除 worktree 和分支相关的代码，添加移除项目的按钮；项目文件夹打开时文件夹要有颜色标识」。
> 澄清（两轮）：去掉的是**项目头上新建分支 / worktree 的按钮**，**项目下的分支行要保留**；另外两个 worktree 管理入口
> （项目头的「项目操作」、工作区行的「删除 worktree」）一并去掉；文件夹颜色 = **当前选中的项目**（右栏正在显示它的终端）。
> 本稿记录改动范围、决策与完成口径；改左栏 / git 这块前先读它。

## 0. 结论先行

| 项 | 之前（V19） | 现在（V20） |
|---|---|---|
| 项目头 hover 按钮 | 会话 / 新建 worktree（`Nodes`）/ 项目操作（`Broom`） | 会话 / **移除项目**（`Trash2`，危险色） |
| 工作区行 hover 按钮 | 提交… + worktree 行的删除（`Trash2`，探脏二次确认 + `force` 重删） | 提交… |
| 新建 worktree | 项目头面板：过滤本地分支 + 新建分支 + 基线两档（当前 HEAD / 远端最新） | **无**（走 `omp worktree add`） |
| 清理 worktree | 维护面板：清理失效登记（`prune -v`）+ 清理孤儿（`omp worktree clear`） | **无**（走 git / omp CLI） |
| 移除项目 | 后端 `remove_project` 存在，但**没有任何 UI 入口** | 项目行 hover 的 `Trash2` + 二次确认 |
| 项目文件夹图标 | 恒灰（`missing` 时 warn） | **当前打开的项目**（活动工作区落在本项目）→ accent |
| 后端命令面 | 含 `create_worktree` / `remove_worktree` / `prune_worktrees` / `list_orphan_worktrees` / `clear_orphan_worktrees` / `get_git_info` | 6 个命令全删（IPC / api / 类型 / Rust 实现与单测同步） |

## 1. 决策与边界

- **只读展示保留（用户明确要求）**：`list_workspaces` 仍列出每个项目的全部 git worktree（真相 = `git worktree list --porcelain`，手工建的也在）；
  工作区行仍显示分支名 / worktree 徽章 / git 状态徽章（改动点 / 领先·落后 / 上游缺失）与「提交…」入口——V19 的提交、推送、
  提交信息语言偏好整套不动。
- **为什么删 `get_git_info`**：它唯一的前端使用者是「新建 worktree」面板（拉本地分支清单 + 远端默认分支做基线）。
  面板退场后命令与 `GitInfo` 类型成为死代码；`lib/` 侧同样不再有 `gitInfo` 调用。`git_info.rs` 于是只剩三件事：
  git 子命令执行（`run_git` / `run_git_timeout`）、git 路径探测缓存（`git_bin`）、worktree 列表解析
  （`parse_worktrees` / `list_worktrees`）——后两者仍被 `list_workspaces` 与会话归属（`ownership_scope`）使用。
- **会话归属保持 worktree 扩展**：`ownership_scope` 仍把各项目的 worktree 路径纳入归属匹配集——用户在别处用
  `omp worktree add` 建的 worktree 里跑的会话照常归到所属项目，不会掉「未归属」。这是正确性保障，不在本次删除范围。
- **worktree 仍完全可用**：壳侧只是不再创建 / 删除；worktree 出现在左栏、可开终端、可提交推送、会话可 resume。
- **移除项目后的终端**：移除项目不删目录、不杀进程——仍在跑的终端继续工作（经 ⌘⇧K 快速切换仍可跳过去），
  只是不再出现在左栏（`activeWorkspacePath` 失效后由 `loadWorkspaces` 回退到第一个可用工作区）。
- **「移除项目」语义 = 后端 `remove_project` 原样**：解绑覆盖层 + 该项目下的会话标记归档（`session_ids_for` 按 jsonl 头 cwd 匹配），
  **不删任何文件**；重新添加同一目录即可恢复（会话需在「已归档对话」里取消归档）。
- **文件夹颜色 = 活动项目**：`projectActive = items.some((ws) => ws.path === activeWorkspacePath)`——右栏正在显示它的终端。
  缺失目录仍优先显示 warn（`project.missing` 分支在前）。

## 2. 命令面变化（IPC）

| 命令 | 变化 |
|---|---|
| `create_worktree` | 删除（含 `omp worktree add` 调用、分支名校验、`resolve_remote_base` 基线解析） |
| `remove_worktree` | 删除（含 `remove_worktree_core`：主目录拒绝 / 探脏 / prune 回退） |
| `prune_worktrees` | 删除 |
| `list_orphan_worktrees` | 删除（含 `parse_orphan_worktrees`） |
| `clear_orphan_worktrees` | 删除（含 `parse_clear_result`） |
| `get_git_info` | 删除（`git_info.rs` 的 `GitInfo` / `read_git_info` / 分支解析全部退场） |
| `remove_project` | 保留；本次接上 UI（项目行 hover 按钮） |

`scripts/e2e-ipc-selfcheck.mjs`（ipc.ts ↔ main.rs ↔ 实现，双向）覆盖这些删除：命令面 58 → 52。

## 3. 源码结构（相对 V19 的变化）

- `src/components/sidebar/ProjectGroup.tsx`：项目头（折叠 / 会话 / 移除项目）+ 工作区行；
  `WorktreePanel` 与 `MaintenancePanel` 两个浮层组件、行内删除按钮与其确认框全套退场（文件 635 → 307 行）。
- `src/shared/ipc.ts` / `api.ts` / `types.ts`：6 个命令常量与 `GitInfo` / `OrphanWorktree` / `OrphanClearResult` 类型退场。
- `src-tauri/src/git_ops.rs`：只剩变更集读取、勾选 → 暂存区同步、提交 / 推送参数构造（860 → 447 行）。
- `src-tauri/src/git_info.rs`：只剩 git 执行 / 探测 / worktree 列表解析（465 → 244 行）。
- `src-tauri/src/commands/mod.rs`：`create_worktree` 与 `get_git_info` 退场（1249 → 1145 行）。
- 字典（`src/lib/locale.ts`，中英同键）：删除 27 键——`wsNewWorktree` / `wsNewWorktreeTitle` / `wsBranchPlaceholder` /
  `wsBranchNew` / `wsCreateFailed` / `gitWorktreeRemove` / `gitWorktreeRemoveTitle` / `gitWorktreeDirtyConfirm` /
  `gitWorktreeBusy` / `gitWorktreeRemoveFailed` / `gitProjectMenu` / `gitPrune` / `gitPruneNone` / `gitPruneDone` /
  `gitOrphans` / `gitOrphansLoading` / `gitOrphansNone` / `gitOrphansConfirm` / `gitOrphansDone` / `gitOrphansFailed` /
  `gitBaseLabel` / `gitBaseHead` / `gitBaseRemote` / `gitConfirmTitle` / `gitConfirmCancel` / `gitConfirmDelete` /
  `noBranches`；新增 `projRemove` / `projRemoveTitle` / `projRemoveBody` / `projRemoveConfirm` / `projRemoveCancel` /
  `projRemoveFailed`。

## 4. 完成口径（已达成）

- 项目头只有「会话」与「移除项目」两个 hover 按钮（后者 hover 变 `danger` 色）；
- 工作区行（主目录 + worktree）显示与 git 状态徽章、提交入口不变，行上不再有删除按钮；
- 「移除项目」→ `ConfirmDialog`（danger；标题带项目名，正文写明「只解除绑定，不删文件；会话标记归档」）→
  `api.removeProject` → `onChanged()` 刷新左栏（`loadWorkspaces` 失效选中项回退）；
- 当前打开项目的 `Folder` 图标用 `accent`（缺失目录仍 `warn`）；
- `pnpm check`（typecheck + lint + vitest 212 项 + e2e:ipc）与 `cargo test --locked`（133 项）全绿；
- 无任何命令 / 类型 / 字典键残留（IPC 自检双向核对 + 全仓 grep 均无命中）。

## 5. 后续候选（需用户确认再开工）

- 项目重命名 / 手动排序；
- 项目头的溢出菜单（hover 槽位目前两个按钮，再加动作就该收进菜单）；
- 若将来要恢复壳内 worktree 创建，按 V19 文档与 git 历史取回（`create_worktree` 的基线两档与 `resolve_remote_base` 都有单测）。
