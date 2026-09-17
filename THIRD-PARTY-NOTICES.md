# 第三方开源软件声明

本产品（ompMiniDesktop）以 MIT 许可证开源，并包含来自以下开源社区的代码与资源。
完整版权与许可证文本以各上游项目仓库为准。

---

## 前端依赖

### React
- 仓库：https://github.com/facebook/react
- 许可证：MIT

### Zustand
- 仓库：https://github.com/pmndrs/zustand
- 许可证：MIT

### Xterm.js（@xterm/xterm、@xterm/addon-fit）
- 仓库：https://github.com/xtermjs/xterm.js
- 许可证：MIT
- 说明：终端工作区的终端模拟器与尺寸自适应（V11 起，右侧面板 = PTY 里跑的 omp TUI）。

### Vite（@vitejs/plugin-react）
- 仓库：https://github.com/vitejs/vite
- 许可证：MIT

### Tailwind CSS（tailwindcss、@tailwindcss/vite）
- 仓库：https://github.com/tailwindlabs/tailwindcss
- 许可证：MIT

### YAML（yaml）
- 仓库：https://github.com/eemeli/yaml
- 许可证：ISC
- 说明：设置 ›「供应商」页「自定义模型」区块的 `models.yml` 保真编辑——只改被编辑的节点，用户的注释与格式原样保留（零修改往返逐字节一致）。

### Reicon（reicon-react）
- 仓库：https://github.com/dqev/reicon
- 许可证：MIT
- 说明：界面图标（Outline 权重，填充路径）。每个图标按需具名导入，构建期 tree-shake；图标映射表见 `design-system/MASTER.md` §8。

### Markdown 渲染（react-markdown、remark-gfm、rehype-highlight）
- 仓库：https://github.com/remarkjs/react-markdown · https://github.com/remarkjs/remark-gfm · https://github.com/rehypejs/rehype-highlight
- 许可证：MIT
- 说明：设置 ›「记忆」页里记忆文件的 Markdown 预览（底层 highlight.js/lowlight）。`react-markdown` 默认不渲染原始 HTML，正文内容不做 `dangerouslySetInnerHTML` 注入。

### Tauri 前端插件（@tauri-apps/api、plugin-dialog/opener/process/updater）
- 仓库：https://github.com/tauri-apps/tauri
- 许可证：Apache-2.0 / MIT（双许可）

### TypeScript / Vitest / ESLint（eslint、typescript-eslint、@eslint/js、eslint-plugin-react-hooks、eslint-plugin-react-refresh、globals）
- 仓库：https://github.com/microsoft/TypeScript · https://github.com/vitest-dev/vitest · https://github.com/eslint/eslint · https://github.com/typescript-eslint/typescript-eslint
- 许可证：Apache-2.0 / MIT / MIT

### jsdom（测试环境）
- 仓库：https://github.com/jsdom/jsdom
- 许可证：MIT
- 说明：纯逻辑单测的 DOM 环境（如 `localStorage` 依赖），仅测试期使用，不进构建产物。

## Rust 依赖

### Tauri（tauri、tauri-build、tauri-plugin-dialog/opener/process/updater）
- 仓库：https://github.com/tauri-apps/tauri
- 许可证：Apache-2.0 / MIT（双许可）

### Tokio
- 仓库：https://github.com/tokio-rs/tokio
- 许可证：MIT

### portable-pty
- 仓库：https://github.com/wezterm/wezterm（portable-pty crate）
- 许可证：MIT
- 说明：终端工作区的 PTY 进程管理（V11 起；每个终端 = 一个跑在 PTY 里的 `omp` TUI）。

### serde / serde_json / chrono / walkdir
- 仓库：https://github.com/serde-rs/serde · https://github.com/serde-rs/json · https://github.com/chronotope/chrono · https://github.com/BurntSushi/walkdir
- 许可证：MIT / Apache-2.0（双许可）

## 上游运行时（不随本仓库分发，需用户另行安装）

### oh-my-pi（omp）
- 仓库：https://github.com/ldx/oh-my-pi
- 本 app 在 PTY 里直接运行 `omp`（交互式 TUI，V11 起；工作区创建走 `omp worktree add`，
  供应商登录 / 登出走 `omp auth-broker`，设置读写走 `omp config`，用量统计走 `omp usage`）。
  `docs/rpc-memo.md` 保留了 RPC 协议时代的实测备忘（历史存档）。
