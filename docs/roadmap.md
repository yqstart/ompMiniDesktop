# 版本规划（重构起点）

> 2026-10-14：仓库重置为 **0.1.0** 起点（历史版本与发版记录已清除）。本文件是版本总纲；对标依据见 `benchmark-codex-desktop.md` / `benchmark-zcode-desktop.md`，各版本明细见对应排期文档。
> 改代码前先读：`AGENTS.md`（工程导航）→ 本文件 → 对应版本排期。

## 方向（三条，来自重构决策）

1. **只保留聊天形态**——终端形态整体退场，聊天成为唯一形态；
2. **聊天形态对标 Codex Desktop、Zcode Desktop**——样式、布局、流式对话、聊天框；
3. **设置重构**——现有设置功能全量保留，操作方式与展现形式重新设计。

## 版本安排

| 版本 | 主题 | 一句话目标 | 明细 |
|---|---|---|---|
| **0.1.0** | 形态收敛 | 终端形态代码与概念整体下线；聊天形态承接全部有效能力 | [`v1-schedule.md`](v1-schedule.md) |
| **0.2.0** | 聊天对标 | 三栏布局、消息流表达、Composer、命令面按 Codex / ZCode 范式重做 | [`v2-schedule.md`](v2-schedule.md) |
| **0.3.0** | 设置重构 | 设置从「标签页」改为独立视图：分组导航 + 搜索 + 行式控件 | [`v3-schedule.md`](v3-schedule.md) |

## 版本号与发版约定

- 0.x 系列、语义化版本；`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml` 三处同步。
- 发版：打 `v*` tag 推送 → `.github/workflows/release.yml` 四平台打包并生成 `latest.json`（应用内更新数据源）。
- `CHANGELOG.md` 按 Keep a Changelog；版本节即 Release 说明（`scripts/changelog-notes.mjs` 抽取，缺失会挡发版）。

## 现状交代（0.1.0 起点）

- 代码库当前是**双形态并存**：终端形态（PTY + xterm + 工作区树）与聊天形态（`omp --mode rpc-ui` + 流式渲染管线）两套完整实现，左栏顶栏有形态切换。
- 0.1.0 是**做减法**：按 `v1-schedule.md` 的清单删除终端形态，聊天形态成为唯一形态。
- 聊天侧已有相当完整的底座（会话运行 / 流式 / 队列 / 审批 / fork / 归档 / 设置面），v1 之后各版本是**在其上重做界面与交互**，不是重写数据层。
