# 手机远程控制（omp 会话）

> 状态：**0.3.0（P0 已实施）**。手机端是浏览器 PWA；桌面端在 Tauri 进程内嵌 HTTP/WS 服务。
> 本文是调研、协议、安全模型与验收的唯一口径；排期与后续见文末「分期」。

## 1. 调研结论

同类产品分两条路：

| 产品 | 做法 | 借鉴 | 不采用 |
|---|---|---|---|
| [Claude Code Remote Control](https://code.claude.com/docs/en/remote-control) | 本地会话只**出站**连 Anthropic，经云端中继路由给手机/网页；二维码/会话 URL；审批与模型控制；Trusted Devices | 扫码即用、桌面不开入站端口、审批同步、断线重连 | 依赖账号与云端中继，转录存服务端 |
| [Happy Coder](https://happy.engineering/docs/how-it-works/) | CLI + 手机 App + 中继；二维码交换公钥，端到端加密；中继只存加密 blob；推送 | 二维码配对、设备撤销、推送、离线补历史 | 需要中继服务和原生 App |
| [VibeTunnel](https://docs.vibetunnel.sh/docs/core/architecture) | 本机 HTTP/WS 服务 + Web/iOS 客户端；密码/SSH key 认证；[Tailscale Serve 集成](https://docs.vibetunnel.sh/docs/authentication)（只绑 localhost，HTTPS 由 Tailscale 提供） | 内嵌本地服务、Tailscale Serve、只绑 localhost 的安全模式 | 终端形态、系统密码认证 |
| [BedCode](https://github.com/7ZAI/BedCode) | Tauri 2 + Rust（Actix Web）局域网远程终端；二维码/6 位码/mDNS 配对；JWT + 链路加密 | Tauri 内嵌 Rust 服务、扫码配对、设备信任 | 终端与插件体系 |
| [Qwen Code `serve`](https://github.com/QwenLM/qwen-code/pull/11172) | 一条命令启动远程 Web Shell，自动生成 bearer、打印二维码、同源策略、HTTP 明文警告 | 二维码含密钥、同源校验、安全警告 | 通用 Web Shell 暴露面 |

补充事实：

- iOS Web Push 要求 **iOS 16.4+、HTTPS、manifest、添加到主屏幕**（[OneSignal 文档](https://documentation.onesignal.com/docs/cn/web-push-for-ios)），因此推送只能作为 Tailscale HTTPS 模式的增强（P1）。
- [Tailscale Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) 是带自动证书的 HTTPS 反向代理，可代理 WebSocket；适合把只监听 `127.0.0.1` 的服务安全地暴露给 tailnet。
- 本项目没有云端后端、强调本地优先与隐私，**不做中继/账号**；用「内嵌服务 + 扫码 + 局域网直连 + Tailscale HTTPS」最贴合。协议按可接中继的形态设计，但本期不实现中继。

## 2. 目标与非目标

**能做**：会话列表 / 打开 / 历史 / 实时流；发消息、转向（steer）、排队（follow_up）、`/` 命令；工具审批（**允许一次 / 拒绝**）；停止；新建会话（已有项目）；断线重连；设备撤销；Tailscale HTTPS。

**不能做**：文件树、终端、git、设置、项目增删、归档删除、导出、子代理消息展开、diff、目标/计划编辑、审批「总是允许」、远程桌面/屏幕镜像、公网中继、原生 App。

**前提**：桌面应用必须运行、机器不睡；手机是现代浏览器（iOS 16.4+ / Android Chrome）；外网访问需手机装 Tailscale。

## 3. 架构

```
桌面 Tauri 进程
  ├─ 现有 commands / runtime（omp --mode rpc-ui）
  │     └─ 事件（omp-event / omp-status / omp-state）──► RemoteHub（镜像 + 待审批缓存）
  ├─ RemoteManager（开关 / 配对 / 设备 / 限流 / Tailscale）
  ├─ axum HTTP + WS（127.0.0.1 或 0.0.0.0）
  └─ 设置 ›「远程控制」面板（Tauri 命令：状态 / 启动 / 停止 / 二维码 / 撤销 / Tailscale）

手机 PWA ── LAN HTTP 或 Tailscale HTTPS ──► axum ──► 白名单 RPC ──► 现有 command 函数
                                     └──► WS 事件 ──► 复用 useSessionEvents / Thread
```

关键决策：

1. **内嵌 axum**，不引入 Node sidecar、不加 Tauri 插件；静态资源走 Tauri `asset_resolver`（生产内嵌，开发读 `dist`，debug 可反代 Vite）。
2. **复用桌面数据层与消息渲染**：`stores/app`、`useSessionEvents`、`openSessionWithHistory`、`Thread`/`ApprovalCard`/`PlanCard`/`AssistantText`；移动壳只重做列表 / 页头 / 输入卡。传输切换在 `src/shared/remote.ts`，桌面仍走 Tauri `invoke`/`listen`。
3. **扫码换设备令牌**：一次性 256-bit 配对密钥放 URL fragment，换 HttpOnly 设备 Cookie；设备令牌只存哈希，可撤销。
4. **只做白名单 RPC**：不做通用 Tauri 桥；远程不能读任意文件 / 开终端 / 改设置 / 删项目。
5. **事件镜像 + 待审批缓存**：运行时每处 `emit` 同时进 hub；审批帧即使手机离线也缓存 30 分钟，重连可处理。
6. **默认关闭**：每次启动不自动开；端口/访问方式持久化，设备持久化。

## 4. 协议

### 4.1 配对

1. 桌面点「生成二维码」→ 32 字节随机密钥（base64url），TTL 120s，单次有效；同一时刻只保留一个。
2. QR：`<baseUrl>/#pair=<secret>`（secret 只在 fragment，不进服务端日志 / Referer）。
3. 手机 PWA 读 fragment、`history.replaceState` 清掉 → `POST /api/v1/pair {secret,name}`。
4. 成功：生成 32 字节设备 token → 存 `sha256(salt || token)`（`remote-devices.json`，0600）→
   `Set-Cookie: omp_remote=<token>; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`；
   HTTPS（可信 loopback 代理的 `X-Forwarded-Proto=https`）时加 `Secure`。
5. 已配对的浏览器再次配对 = 轮换同一设备 token（沿用 id / 创建时间）；撤销后重新配对 = 新设备。

### 4.2 HTTP

| 方法 | 路径 | 认证 | 说明 |
|---|---|---|---|
| GET | `/` | 否 | `mobile.html`（PWA 壳） |
| GET | `/assets/*`、`/manifest.webmanifest`、`/icons/*` | 否 | 静态资源（路径净化后走 `asset_resolver`） |
| GET | `/healthz` | 否 | 仅 `{ok:true}` |
| GET | `/api/v1/me` | Cookie | `{device, protocol:1}` |
| POST | `/api/v1/pair` | 一次性 secret | 配对；设置 Cookie |
| POST | `/api/v1/logout` | Cookie | 撤销当前设备并清 Cookie |
| GET | `/api/v1/overview?limit=200` | Cookie | 会话列表 + 各会话状态 + 待审批数 |
| GET | `/api/v1/pending?sid=<uuid>` | Cookie | 该会话待处理的审批 / ask 帧 |
| POST | `/api/v1/rpc` | Cookie | `{cmd,args}` → `{ok:true,result}` / `{ok:false,code,message,hint}` |
| GET | `/api/v1/events` | Cookie | WebSocket，帧 `{seq,channel,payload}`，channel 与 Tauri 事件同名 |

所有 API 响应 `Cache-Control: no-store`；静态 HTML `no-store`，带 hash 的 `assets/*` 长缓存。

### 4.3 WebSocket

- 握手前完成 Host / Origin / Cookie 校验；连接后先发 `remote://hello {protocol,device}`。
- 转发 `omp-event://<sid>`、`omp-status://<sid>`、`omp-state://<sid>`；每 25s Ping。
- 广播积压（`Lagged`）→ `remote://lagged` 后关闭，手机重连补历史。
- 撤销设备 → Close 4401（手机立即回配对页）；服务停止 → 正常关闭，手机重连。
- 手机侧 `remoteListen` 与 Tauri `listen` 同形；`onRemoteReconnected` 触发历史 / 待审批补拉。

### 4.4 RPC 白名单（P0）

`get_health`、`get_session_runtime`、`get_history`、`open_session`、`send_message`、`steer_message`、
`follow_up_message`、`run_slash`、`stop_session`、`approve`（仅 once / deny）、`respond_ui`、
`compact_session`、`list_projects`、`create_session`（cwd 必须是已登记项目根/子目录）、`get_subagents`。

禁止：`read_image_file` / `run_bash` / `list_dir` / `search_paths` / `complete_path` / `check_paths` /
`terminal_*` / `git_*` / 设置 / 插件 / 技能 / 记忆 / 用量 / 归档删除 / 项目增删 / 导出。

参数校验：会话 id 必须是**完整 uuid**（36 字符）；消息 ≤64k 字符；命令 ≤2k；图片最多 4 张、单张 base64
≤14MiB；`answers` ≤128KiB；会话 id / UI id 长度上限；`create_session` cwd 先 canonicalize，再按路径
组件边界校验属于某个项目根。

## 5. 安全模型

| 威胁 | 对策 | 残余风险 |
|---|---|---|
| 局域网嗅探 | 默认 HTTP 明文，UI 明确警告；推荐 Tailscale HTTPS | 公共 Wi-Fi 上仍可能被嗅探 |
| CSRF / DNS rebinding | SameSite=Strict + 自定义头 `X-OMP-Remote` + JSON Content-Type + Origin 校验 + Host 允许列表（私网/本机/`*.ts.net`，拒公网域名） | 本机恶意进程 |
| 未授权 API | 设备 Cookie（哈希存储、常量时间比较）、限流、撤销即断开 | 已配对设备被盗 |
| 路径穿越 | 静态资源只允许常规路径组件，拒绝 `..`/`%`/反斜杠；dev 也不信任 `asset_resolver` 的 join | — |
| 文件 / 终端 / 设置越权 | RPC 白名单 + `create_session` cwd 校验 | 会话内 agent 本身仍可执行工具（这是产品能力） |
| 审批升级 | 手机只允许 once / deny；`always` 后端 403；UI 不渲染按钮 | 会话原本已是 yolo 时仍自主执行 |
| 暴力配对 | 256-bit secret、120s、单次、5 次/分钟/IP | 屏幕被拍 / 二维码外泄 |
| 请求体炸弹 | 16MiB 上限；单图 10MiB 后端再校验；RPC 并发/频率限制 | — |
| 日志泄密 | 不记录 token / 消息 / 审批内容；secret 只在 fragment | — |

不防：本机同用户恶意进程、已 root 的设备、物理偷看屏幕、桌面端本身被攻破。

## 6. 实现位置

- 后端：`src-tauri/src/remote/`（`mod.rs` 生命周期/命令/类型、`auth.rs` 配对与校验、`bus.rs` 事件/待审批、
  `rpc.rs` 白名单、`server.rs` 路由/WS、`store.rs` 持久化、`assets.rs` 静态资源、`net.rs` 地址/Tailscale）。
- 事件镜像：`runtime.rs` 与 `commands/mod.rs` 的统一出口 `remote::emit_event` / `emit_serializable`。
- 前端：`src/shared/remote.ts`（transport）、`src/mobile/`（入口/配对/列表/输入卡）、`mobile.html`、
  `src/components/settings/RemotePanel.tsx`、设置 tab `remote`。
- 构建：Vite 多入口（`index.html` + `mobile.html`）；PWA manifest / icons 在 `public/`。

开发联调：`OMP_REMOTE_AUTOSTART=1 pnpm tauri:dev` 会以 `lan` 模式自动起服务并打印配对 URL（仅 debug）。

## 7. 验收

- 同 Wi-Fi 扫码 → 配对 → 列表 → 打开会话 → 历史 + 实时流 → 发消息 / 转向 / 排队 / 停止。
- 工具审批手机 1s 内出现，允许一次 / 拒绝生效；不出现「总是允许」；桌面端状态同步。
- 手机锁屏/切后台 2 分钟再回：自动重连，历史不重复，错过的审批仍可处理。
- 撤销设备：WS 4401 / 后续 401，手机回配对页；旧 Cookie 失效。
- 二维码过期 / 复用：410，重新生成。
- 安全：未配对 401；未白名单 403；伪造 Host 421；超大 body 413；端口占用明确错误。
- Tailscale：启用后手机切 5G 访问 HTTPS；关闭后 LAN 仍可用；Serve 失败不影响 LAN。
- 应用退出/重启：服务关闭；重启默认不自动开；设备列表仍在。

## 8. 分期

- **P0（0.3.0，已实施）**：上述全部；新建会话；PWA manifest/图标；设置面板；设备撤销；Tailscale 启停。
- **P1**：Web Push（VAPID；iOS 需 HTTPS + A2HS）；模型/思考档、队列芯片撤回/提升、改名、压缩、统计、
  子代理消息、斜杠命令面板；设备空闲过期；审计日志；启动自动开启（默认关）；事件环形缓冲。
- **P2**：公网中继 + E2E；原生 App；文件树/终端（不建议）；远程桌面（独立能力）。

## 9. 已知边界

- 局域网 HTTP 不加密；不要在公共 Wi-Fi 使用，改用 Tailscale HTTPS。
- iOS 推送依赖 HTTPS + 添加到主屏幕；HTTP 模式只能当网页用。
- 端口被其他进程占用时启动失败；换端口或关闭占用实例（安装版 + dev 同时开是常见冲突源）。两个实例共用同一份 `remote-devices.json`，不要同时开启远程控制（后写覆盖）。
- 同一手机在 LAN 与 Tailscale 两个 origin 上需要分别配对（Cookie 按主机）。
- 换端口不影响 Cookie（Cookie 不按端口隔离），但已安装 PWA 的 origin 变了要重新打开新地址。
- 首次以 `0.0.0.0` 启动时，macOS / Windows 会弹防火墙授权（需允许「专用 / 私有网络」）；拒绝后手机连不上，但本机仍可访问。
- 桌面应用退出 / 机器睡眠后手机不可用；重连依赖桌面重新开启。Tailscale Serve 不随应用启动恢复，重启后需在面板里重新「启用 HTTPS 访问」。
- 手机端审批只支持 once / deny；需要「总是允许」请回电脑。
- 发送超时不会自动重试（避免重复 prompt）；先刷新确认再手动重发。
