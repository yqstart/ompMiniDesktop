# ompMiniDesktop

oh-my-pi（`omp`）的极简桌面端。Tauri v2 + React + Tailwind v4 + Zustand。

## 安装要求

- `omp` 18.x（已验证 18.1.22）：`which omp` 必须可用；GUI 启动时 PATH 可能不含 `/opt/homebrew/bin`，app 会问登录 shell(`command -v omp`)、再试已知前缀，仍找不到可手动指定路径（存 overlay）。
- Node 22 + pnpm 11；Rust 1.97 + `cargo-tauri`。

## 开发

```bash
pnpm install
pnpm dev            # 纯前端
pnpm tauri:dev      # 桌面壳联调
pnpm typecheck && pnpm test && pnpm e2e:ipc
```

## 排障

| 现象 | 修复 |
|---|---|
| 启动横幅「未找到可用的 omp」 | 装 oh-my-pi，或把 `omp` 放到 PATH/`/opt/homebrew/bin`，或设置页指定路径 |
| 「模型目录加载失败」 | 点模型选择器刷新按钮；检查网络 |
| 项目「目录缺失」 | 重定位到新路径，或移除项目（会话历史仍可回放） |
| 会话「已损坏，可删除」 | jsonl 头部解析失败，不阻塞列表，直接删除 |
| 协议漂移（omp 大版本升级后事件对不上） | app 记录 `omp --version`；未知事件只告警不崩，先降级用历史回放 |

## 范围

V1 只做：添加/移除项目、新建/归档/删除会话、切换模型/思考档、agent 输出渲染、权限三档。设置页为占位（只读 config path）。不做自动化、插件管理。
