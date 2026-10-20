# 安全政策

## 支持范围

当前维护版本：

| 版本 | 支持 |
|---|---|
| `0.3.x`（默认分支） | ✅ 接受安全报告 |
| 更早版本 / 未发布的实验分支 | ❌ 仅尽力处理 |

## 报告漏洞

请**不要**在公开 Issue 中披露可利用的安全漏洞。

优先使用 GitHub 私有漏洞报告：

1. 打开仓库 **Security → Advisories → Report a vulnerability**
2. 或访问：https://github.com/yqstart/ompMiniDesktop/security/advisories/new

若无法使用上述渠道，可通过仓库维护者 GitHub 主页私信，主题注明「ompMiniDesktop Security」。

报告请尽量包含：

- 影响版本 / 提交
- 复现步骤或 PoC（概念验证）
- 预期影响（本地文件越权、命令注入、凭据泄露等）
- 是否已有公开讨论或利用

## 处理承诺

- 收到报告后，维护者会尽快确认（通常数个工作日内）
- 确认有效后会私下协调修复与披露时间
- 修复发布后，可在 Release / Advisory 中致谢（除非你要求匿名）

## 安全相关约定

- 不在仓库中提交密钥、Token、私钥、签名证书
- 本 app 不写入、不回显任何凭据明文；设置页为占位，只读展示 `config path`
- 审批通过的命令经 `omp --mode rpc` 子进程执行：`yolo` 档会跳过所有确认，请确认理解风险后再用
- 删除会话不可恢复（删 `*.jsonl` 及同名前缀目录）；移除项目仅解绑，不删用户文件
- 示例路径、session id 一律用占位符，不得出现真实用户目录
- **手机远程控制（0.3.0）**：默认关闭；只暴露会话控制白名单 RPC；设备 token 只存哈希、可撤销；审批仅 once / deny；局域网 HTTP 明文有 UI 警告，外网建议 Tailscale HTTPS。完整威胁模型与验收见 [`docs/remote-control.md`](docs/remote-control.md)
