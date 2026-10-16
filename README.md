# ompMiniDesktop

[oh-my-pi（`omp`）](https://github.com/ldx/oh-my-pi) 的桌面端：**聊天形态的 omp 工作台**。

把 omp 的编码代理会话带进一个专注的桌面聊天界面——项目与会话管理、流式对话、工具与审批、队列与插话、归档与统计，全部在聊天形态内完成。**不做终端仿真**。

> **状态（2026-10-14）**：首个版本 **v0.1.0** 已发布，三部分一体交付：
> 1. **只保留聊天形态**——终端形态（PTY / xterm / 工作区树）整体退场；
> 2. **聊天形态对标 Codex Desktop、Zcode Desktop**——样式、布局、流式对话、聊天框；
> 3. **设置重构**——功能全量保留，操作方式与展现形式重新设计。
>
> 变更记录见 [`CHANGELOG.md`](CHANGELOG.md) 的 `0.1.0` 节；规划见 [`docs/roadmap.md`](docs/roadmap.md)。

## 它长什么样

- **左栏**：工作区 → 项目 → 会话树（搜索 / 归档 / 拖拽排序 / git 徽章）；
- **中列**：会话消息流（Markdown / 工具卡 / 审批卡 / 子代理 / 流式渲染）＋ 输入卡（模型 / 思考档 / 执行模式 / 队列）；
- **设置**：常用设置（`omp config` 目录）/ 模型与供应商 / 插件 / 技能 / 记忆 / 使用统计 / 已归档对话；
- **周边**：应用与 omp 运行时更新、供应商用量、跨项目文件引用、命令中心（⌘K）、提交与推送。

（界面视觉与布局按 [`design-system/MASTER.md`](design-system/MASTER.md) 对齐 Codex / ZCode 范式。）

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri v2（Rust） |
| 前端 | React 19 + TypeScript + Vite + Tailwind v4 + Zustand |
| 后端 | Rust + tokio + serde；`reqwest`（供应商用量补充探针） |
| 运行时 | `omp` 18.x（用户自行安装，不随仓库分发） |
| 工具链 | Node 22 + pnpm 11；Rust stable |

## 开发

```bash
pnpm install
pnpm tauri:dev        # 桌面壳联调（推荐）
pnpm dev              # 纯前端

pnpm check            # 提交前全过：typecheck + lint + test + e2e:ipc
pnpm build            # tsc + vite 构建

cargo test --manifest-path src-tauri/Cargo.toml
```

前置条件见 [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)；开发约定见 [`CONTRIBUTING.md`](CONTRIBUTING.md) 与 [`AGENTS.md`](AGENTS.md)。

## 打包与发版

```bash
pnpm tauri:build      # 本机发布构建（产物见 src-tauri/target/release/bundle/）
pnpm icon             # 从 design-system/icon/omp-mini-icon.svg 重生成应用图标
pnpm file-icons       # 从 material-icon-theme 重新生成右栏文件树的图标子集
```

发布：更新 `CHANGELOG.md` 并升四处版本号（`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` / `Cargo.lock`）→ 打 `v*` tag 推送 → GitHub Actions 四平台打包并生成 `latest.json`（应用内更新的数据源）。macOS 签名证书见 `scripts/make-signing-cert.sh`。

## 文档

| 文档 | 内容 |
|---|---|
| [`docs/roadmap.md`](docs/roadmap.md) | 版本规划总纲 |
| [`docs/v1-schedule.md`](docs/v1-schedule.md) | 排期 1：形态收敛（终端形态下线）|
| [`docs/v2-schedule.md`](docs/v2-schedule.md) | 排期 2：聊天对标（Codex / ZCode）|
| [`docs/v3-schedule.md`](docs/v3-schedule.md) | 排期 3：设置重构 |
| [`docs/benchmark-codex-desktop.md`](docs/benchmark-codex-desktop.md) / [`benchmark-zcode-desktop.md`](docs/benchmark-zcode-desktop.md) | 对标调研 |
| [`design-system/MASTER.md`](design-system/MASTER.md) | 设计系统 |

## 许可

[MIT](LICENSE)
