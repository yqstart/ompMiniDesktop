# 贡献指南

感谢关注 ompMiniDesktop。欢迎 Issue、讨论与 Pull Request。

## 开发环境

| 工具 | 建议版本 |
|---|---|
| Node.js | 22 及以上 |
| pnpm | 11 及以上 |
| Rust | stable（已验证 1.97）+ `cargo-tauri` |
| `omp` | 18.x（已验证 18.1.22） |
| 系统 | macOS arm64（首发；Windows / Linux 打包延后） |

额外依赖见 [Tauri 前置条件](https://v2.tauri.app/start/prerequisites/)。

## 本地运行

```bash
git clone https://github.com/yqstart/ompMiniDesktop.git
cd ompMiniDesktop
pnpm install
pnpm tauri:dev
```

仅检查前端类型与打包（无需完整桌面壳）：

```bash
pnpm build
```

常用检查（提交前请全过）：

```bash
pnpm typecheck && pnpm test && pnpm e2e:ipc
```

仅检查 Rust 侧（含单测）：

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

联调无需真实 LLM：`scripts/fake-omp.mjs` 是 canned RPC 事件脚本
（`OMP_FAKE_SCENARIO=approve|deny|history|multi`），覆盖审批通过/拒绝双分支与多工具并行。

## 贡献方向

- V1 范围内的 bug 修复与体验打磨（对照 [`docs/v1-design.md`](docs/v1-design.md) §13 验收清单）
- `confirm`/`input` 类 UI 请求的通用框补齐（备忘 [`docs/rpc-memo.md`](docs/rpc-memo.md) §6）
- Windows / Linux 打包验证
- 文档与翻译

V1 明确不做（请勿提交）：自动化/定时任务、插件/Skill/MCP/Hook 管理、
主题市场、云同步、多窗口协作、终端 PTY 仿真、diff 合并编辑器、用量统计。

## 提交约定

- 中文描述，一事一 PR；UI 变更请附截图；架构变更请同步 `docs/`。
- 禁止事项：不轮询文件做伪实时；前端不自算 token；不写回 omp 标题（改名只写覆盖层 `notes`）；设置页零写入。
- 组件命名以 [`design-system/MASTER.md`](design-system/MASTER.md) §8 速查表为准，禁止同义重复组件。
- 不得提交密钥、Token、私钥、签名证书与个人路径（见 [SECURITY.md](SECURITY.md)）。

## 行为准则

请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)（Contributor Covenant 2.1 中文简述版）。
