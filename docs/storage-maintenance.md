# 存储维护（2026-10-22）

设置 ›「存储维护」：清理 omp 侧与应用自己的缓存 / 临时文件，并回收壳侧闲置会话进程。
本文是唯一口径：数据面、清理范围、安全边界、深度优化的风险与验收。

## 1. 背景

omp 把图片实体外置在 `~/.omp/agent/blobs/<sha256>`（jsonl 只留 `blob:sha256:` 引用）；
工具调用一多，blobs、会话 jsonl、`~/.omp/logs` 与会话子文件都会持续增长。本机实测
（2026-10-22）：blobs 1333 个文件 / 48MB（`du`，含硬链接去重）、sessions 25MB、logs 5.8MB（1198 个文件）、
`omp gc --blobs` 判定 2556 个文件（1278 个 blob / 77MB）已无任何会话引用。

壳侧另一块是内存：每个打开过的会话常驻一个 `omp --mode rpc-ui` 进程（闲置 30 分钟由
`runtime.rs` 的定时回收 kill）。手动入口让用户能立刻释放，而不必等回收循环。

## 2. 数据面（`src-tauri/src/storage.rs`）

| 命令 | 语义 |
|---|---|
| `get_storage_stats` | 只读目录统计（快）：omp 图片缓存 / 会话记录 / 日志 / 数据库、壳侧粘贴临时文件 / 设置备份 / 用量账本，以及当前常驻会话进程数。**不跑 `omp gc`**，进页面不扫全部 jsonl。 |
| `preview_storage_cleanup(olderDays)` | 清理前读数：`omp gc --json`（dry-run）的 blob 候选字节 / 文件数、可归档会话、WAL 字节；壳侧按 `olderDays` 与 mtime 统计可删字节。 |
| `clean_storage(plan)` | 执行（`plan.dryRun=true` 只算不删）。 |
| `reclaim_idle_sessions` | 立即回收闲置（≥30 分钟、已落盘、`ACT_IDLE`）的会话进程，复用 `runtime::reclaim_idle_now`。运行中 / 等审批 / 等后台投递不碰。 |

`StorageItem.key` 是前端文案键（后端不掺文案）：`ompImages` / `ompSessions` / `ompLogs` /
`ompDatabases` / `shellPaste` / `shellBackups` / `shellLedger`。

统计口径：
- blobs 只统计**无扩展名**的主文件（omp 另有一份同 inode 的 `<hash>.<ext>` 硬链接，
  按主文件计一次，避免 `du` 式重复）；
- 递归上限 8 层 / 20 万文件，跳过符号链接；
- 数据库三项（`history.db` / `models.db` / `agent.db`）与其 `-wal` / `-shm` 合并成一项。

## 3. 清理范围与安全边界

### 安全清理（默认全选）

| 项 | 实现 | 安全依据 |
|---|---|---|
| 图片缓存 | `omp gc --blobs --apply --json` | 上游扫描**全部会话 jsonl** 的引用；壳侧不猜哪些图还在用。实测引用数与壳侧 `grep blob:sha256` 一致（55 vs 56）。 |
| 数据库 WAL | `omp gc --wal --apply --json` | SQLite checkpoint，只合并 WAL 不删数据。 |
| omp 日志 | 删除 `~/.omp/logs` 下 mtime 早于阈值的普通文件 | 跳过最近 1 小时内改过的文件（omp 正在写），不删目录、不跟随符号链接。 |
| 粘贴临时文件 | 删除 `<appData>/omp-mini/paste/` 下过期文件 | 只由本应用写入（大段粘贴转 `@文件`），过期即无引用。 |
| 设置备份 | 删除 `<appData>/omp-mini/backups/` 下过期文件 | `constraints.rs` / `models_config.rs` 的原子写备份；保留最近 N 天。 |

**永远不动**：会话 jsonl、项目文件、`~/.omp/agent/config.yml`、`models.yml`、`AGENTS.md` / `RULES.md`、`rules/*.md`、用量账本。

### 深度优化（默认不勾）

| 项 | 实现 | 风险 |
|---|---|---|
| 归档冷会话 | `omp gc --archive --apply --json` | 会话从活跃目录归档（保留内容），列表里的「已归档」状态会变化；其他 omp 客户端（TUI）会看到同一结果。 |
| 压缩空闲会话 | `omp gc --compress --apply --json` | APFS / NTFS 上的文件系统压缩；不支持的文件系统上 `omp gc` 会报错，错误原文回传到面板。 |

清理计划里的 `olderDays` 由面板的「保留最近 7 / 14 / 30 天」决定，夹在 `1..=365`。

### 执行顺序

1. 面板先调 `preview_storage_cleanup` 给读数；
2. 用户点「执行清理」→ `ConfirmDialog`（深度项会追加一条风险说明）；
3. `clean_storage`：先删壳侧文件（按阈值），再跑一次合并的 `omp gc`（勾选的 flags，`--apply`）；
4. 返回 `freedBytes` / `deletedFiles` / `archivedSessions` / `errors`，面板提示并刷新读数。

任何一项失败不阻断其他项：错误进 `errors`，面板逐行显示原文。

## 4. UI（`components/settings/StoragePanel.tsx`）

- 条目：设置 › 数据组 ›「存储维护」（`SettingsTab = "storage"`），图标 `HardDrive`。
- 三段：磁盘占用（读数列表 / 路径 / 文件数）、内存（常驻进程数 + 回收）、清理（安全项 /
  深度项 / 保留天数 / 预览 / 执行）。
- 搜索：`settingsSearch` 的静态关键词组（条目名、各清理项、回收动作）命中即跳转到该条目。
- 手机 PWA 不暴露这些命令：`read_blob_image` 在远程白名单里（历史图片要显示），
  `get_storage_stats` / `clean_storage` / `reclaim_idle_sessions` 不在。

## 5. 验收

1. `cargo test storage::`：目录统计（含硬链接跳过）、过期文件清理（保留新文件）、`omp gc` 结果解析。
2. `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm e2e:ipc`（新增命令已进 IPC 契约）。
3. 真机：设置 › 存储维护显示各项目字节；「预览」给出与 `omp gc --json` 一致的候选字节；
   执行安全清理后 `omp gc --json` 的 `wouldDelete` 归零；`reclaim_idle_sessions` 只回收
   闲置会话（运行中不回收，列表不转圈）。
4. 深度优化只在用户显式勾选 + 确认后执行；未勾选时 `omp gc` 不带 `--archive` / `--compress`。

## 6. 已知边界

- `omp gc` 的引用扫描以「当前 agent 目录」为准；多台机器共享同一 `~/.omp`（例如同步盘）时
  以本机文件为准。
- Windows 上 `--compress` 依赖 NTFS 压缩属性；不支持时错误原文直接展示。
- 统计是快照；面板不自动轮询（进入页面时读一次，清理后刷新）。
