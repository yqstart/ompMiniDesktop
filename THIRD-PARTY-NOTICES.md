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

### Vite（@vitejs/plugin-react）
- 仓库：https://github.com/vitejs/vite
- 许可证：MIT

### Tailwind CSS（tailwindcss、@tailwindcss/vite）
- 仓库：https://github.com/tailwindlabs/tailwindcss
- 许可证：MIT

### Lucide（lucide-react）
- 仓库：https://github.com/lucide-icons/lucide
- 许可证：ISC

### TypeScript / Vitest / ESLint
- 仓库：https://github.com/microsoft/TypeScript · https://github.com/vitest-dev/vitest · https://github.com/eslint/eslint
- 许可证：Apache-2.0 / MIT / MIT

## Rust 依赖

### Tauri（tauri、tauri-build、tauri-plugin-dialog/opener/store/shell）
- 仓库：https://github.com/tauri-apps/tauri
- 许可证：Apache-2.0 / MIT（双许可）

### Tokio
- 仓库：https://github.com/tokio-rs/tokio
- 许可证：MIT

### serde / serde_json / chrono / walkdir
- 仓库：https://github.com/serde-rs/serde · https://github.com/serde-rs/json · https://github.com/chronotope/chrono · https://github.com/BurntSushi/walkdir
- 许可证：MIT / Apache-2.0（双许可）

## 上游运行时（不随本仓库分发，需用户另行安装）

### oh-my-pi（omp）
- 仓库：https://github.com/ldx/oh-my-pi
- 本 app 通过 `omp --mode rpc` 子进程驱动它；`docs/rpc-memo.md` 记录了实测协议要点。
