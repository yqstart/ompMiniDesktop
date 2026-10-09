# V30 应用更新入口迁到左栏字标行

> 目标：本应用的更新（Tauri updater → GitHub Release `latest.json`）此前只在设置 ›「关于」里——
> 「有没有新版本」没有任何常驻信号。现在入口搬到**左栏字标行右端、和 omp 的版本 chip 并排**
> （用户指定落点：截图里 omp chip 左边那块空白），点击开 `UpdateDialog`；弹窗**全状态化**
> （idle / 检查中 / 已最新也渲染，检查更新在弹窗里点），设置 ›「关于」只剩 omp 运行环境诊断，
> 设置入口上的更新小点退场（同义入口唯一）。

## 1. 迁移口径

| 决策 | 结论 | 理由 |
|---|---|---|
| 落点 | 字标行右端两枚 chip **并排**：左 = 本应用（`AppUpdateChip`）、右 = omp（`OmpUpdateChip`，V24）。对齐交给字标行的右端容器（`ml-auto flex min-w-0 items-center gap-1.5`），`OmpUpdateChip` 自带的 `ml-auto` 随之删除。 | 用户指定「放到左侧 omp 更新处」；两个 chip 同款（`bg-surface` 描边小盒 + 状态圆点 / 转轮 + 等宽版本号），应用侧带 `v` 前缀与 omp 的裸 semver（`18.8.3`）区分，完整结论在 `aria-label` / `title` 里。 |
| 不再留「关于」区块 | 设置 ›「关于」的应用更新卡片（当前版本 / 检查更新 / 查看详情 / 来源说明）整块删除，副标题改成「omp 运行环境诊断；本应用的更新在左栏字标行的版本 chip」。 | 同义入口唯一：检查更新搬进弹窗后，卡片里没有别的信息是 chip + 弹窗没有的（版本号 chip 上有、来源说明进弹窗）。 |
| 设置入口的小点退场 | 左栏底部「设置」行上的 accent 小点（V11 顶栏 `UpdateBell` 退场后的常驻提醒）删除，`updateReady` 选择器与按钮的 `relative` 类一起退场。 | 常驻提醒改由 chip 承担（它常驻可见、还带版本号），两个信号同一件事会互相打架。 |
| 弹窗点开永远有内容 | `UpdateDialog` 从「只认 available / downloading / ready / error，其余 `return null`」改成**所有状态都渲染**：idle / checking / latest 给「当前版本 + 更新来源说明 + 关闭 / 检查更新」。 | 原来手动检查的唯一入口是被删掉的「关于」按钮；不把检查更新搬进弹窗，chip 在上面的状态点开后就是「什么也没发生」。 |
| 两条链路仍互不相干 | 应用 chip 的状态只来自 `store.update`（Tauri updater），omp chip 只来自 `store.ompUpdate`（`omp update --check`）——V24 §2.1 的「本应用有更新不该让 omp chip 变色，反之亦然」不变，V30 只把两个入口并排。 | 状态机、检查时机（启动静默 / 单飞 / 冷却）与后端一点没动。 |
| 版本号来源 | `getAppVersion()`（`plugin:app|version`）改成**单飞缓存**——chip 与弹窗都要显示「当前 v…」，一次运行里版本不变。 | 避免两处各发一次 IPC、也避免 chip 重挂载时闪「未知」。 |
| 窄栏下谁让位 | 字标行右端容器 `ml-auto flex min-w-0 items-center gap-1.5`；**omp chip 可收缩截断**（`min-w-0` + 版本号 `truncate`，cap 仍是 86px），应用 chip `shrink-0` 不截断。 | 左栏下限 292px（`SIDEBAR_MIN`）：字标 105px + 应用 chip 70px + omp chip 64px + 间距 ≈ 259px 装得下；omp 的长 canary 版本号（`18.11.0-canary.2`，cap 前 110px）会把这一行顶出容器——omp chip 收缩 + `text-overflow` 截断后一行恒不溢出，应用版本号保持完整（完整字符串仍在 `title` / `aria-label` 里）。实测见 §3。 |

## 2. 实现

- **`AppUpdateChip`（新；`src/components/sidebar/AppUpdateChip.tsx`）**：本应用版本 chip。
  显示当前版本；`available` / `downloading` / `ready` 时改显**目标版本**（与 omp chip 同口径）；
  状态圆点 / 转轮与 omp chip 同一套语义：有新版本与已就绪 `accent`、已最新 `ok`、失败 `warn`、
  还没查 `faint`、检查与下载中 = `Loader` 转轮——**颜色不作唯一信号**，`aria-label` / `title`
  是完整结论（6 个新字典键：`updateChipIdle` / `updateChipLatest` / `updateChipAvailable` /
  `updateChipDownloading` / `updateChipReady` / `updateChipError`，另加 `updateChecking`）。
  点击 = `openUpdateDialog()`（弹窗自己按状态给内容）。它是拖拽区里的 `<button>`——与 omp chip
  同样不会误拖窗口。
- **`WorkspaceSidebar`**：字标行的 omp chip 换成「右端容器（`ml-auto flex min-w-0 items-center gap-1.5`）+ 两枚 chip」；
  底部「设置」行的更新小点删除。两枚 chip 的收缩语义见 §1「窄栏下谁让位」：omp chip `min-w-0` +
  版本号 `truncate`（可收缩截断），应用 chip `shrink-0`（版本号始终完整）。
- **`UpdateDialog`**：状态行改为按状态给图标 + 标题（idle = `Download` muted + 「应用更新」、
  检查中 = 转轮 + 「正在检查更新…」、已最新 = `CheckCircle` ok + 「已是最新（v…）」、
  有新版本 = `Download` accent、下载中 = 转轮、已就绪 = `CheckCircle` ok、失败 = `TriangleWarning`
  warn）；idle / checking / latest 共用一段版式（idle 多一行「当前 v…」）+ 来源说明 + 非检查中时
  的「关闭 / 检查更新」；available / downloading / ready / error 四块**一字未改**（Release notes
  的 `.md-body` 块、进度条、重启询问、失败重试都在原样）。标题栏的 × 改成按状态给无障碍名：
  available = 「稍后更新」（`deferUpdate`，记录本轮不再弹窗），其余 = 「关闭」。
- **`SettingsPage`**：删除应用更新区块与随之无用的 `version` 状态 / `updateHint` / `checking` 与
  `checkForUpdate` / `getAppVersion` / `openUpdateDialog` 引用；「关于」只剩 omp 诊断区块。
- **字典**：`updateCurrentTo` 的「重新打开」指引从「设置 › 关于」改成「左栏字标行的版本 chip」；
  `tabAboutHint` 改成「omp 运行环境诊断；本应用的更新在左栏字标行的版本 chip」；删掉两个孤儿键
  `viewDetail` / `updateReady`（旧「关于」区块专用）。

## 3. 完成口径

- `pnpm check` 全绿：typecheck + lint（0 警告）+ **338 项前端单测**（含字典中英同键 / 无空文案 /
  英文不含中文三项校验）+ `e2e:ipc`（71 命令 × 双向一致）。
- **真实 Chromium 核对**（`pnpm build` + `pnpm preview` + `__TAURI_INTERNALS__` mock；mock 走
  `evaluateOnNewDocument`（main world）、**控制面走 DOM**（`data-check-mode` 属性）——本环境
  `page.evaluate` 在 isolated world，写 `window` 属性主世界看不见，DOM 是共享的；1440×900、深色、
  zh-CN、`plugin:updater|check` 先返回 `null` 再返回 0.9.1）：

| 场景 | 结果 |
|---|---|
| 启动 | 字标行文本 = `ompMiniDesktop \| v0.9.0 \| 18.8.3`；两枚 chip 的 `aria-label` = 「本应用 v0.9.0 · 点击检查更新」「omp 18.8.3（stable）已是最新 · 点击查看」 |
| 底部「设置」入口 | 无小点（`button > span.rounded-full` 计数 0，`relative` 类已移除） |
| 点应用 chip（无可更新） | 弹窗：「应用更新 / 当前 v0.9.0 / 更新包来自 GitHub Release… / 关闭 / 检查更新」；× 的 `aria-label` = 「关闭」 |
| 点「检查更新」（mock 返回 0.9.1） | 弹窗切「发现新版本 0.9.1 / 当前 0.9.0 → 新版 0.9.1 / 本次更新（`.md-body` 渲染 Release notes）/ 稍后更新 / 立即更新」；× 变「稍后更新」；chip 变 `v0.9.1` + accent 圆点、`aria-label` = 「本应用有新版本：0.9.0 → 0.9.1 · 点击查看」；omp chip 不受影响 |
| 点「稍后更新」 | 弹窗关闭，chip 保留 `v0.9.1` + accent（状态不丢） |
| 重开 → 点「立即更新」 | 弹窗切「更新已就绪 / 稍后重启 / 立即重启」；chip = 「应用更新已下载（0.9.1），重启后生效 · 点击查看」；点「稍后重启」关弹窗 |
| 设置 ›「关于」 | `#settings-panel` 里 `section[aria-label]` 只剩 `["omp 诊断"]`（应用更新区块已退场）；副标题 = 「omp 运行环境诊断；本应用的更新在左栏字标行的版本 chip」 |
| 292px 最小宽度（英文界面、`omp.sidebarWidth = 292`） | 常规版本（应用 `v0.10.0` + omp `18.8.3`）：字标 105px + 两枚 chip 70/64px，字标行 `scrollWidth === clientWidth === 267`、aside `291 === 291`，**无溢出**；omp 换成 canary 长版本（`18.11.0-canary.2`）后：应用 chip 仍 70px 完整（`scrollWidth 46 === clientWidth 46`），omp chip 收缩到 70px 且版本号截断（`clientWidth 46 < scrollWidth 106`，`text-overflow` 省略号），字标行与 aside 的 `scrollWidth` 仍等于 `clientWidth`（291）——**一行恒不溢出、不被 aside 的 `overflow-hidden` 切掉**（截图：`ompMiniDesktop ● v0.10.0 ● 18.11…`） |

  截图（深色）：两枚 chip 并排的字标行（`ompMiniDesktop ● v0.9.0 ● 18.8.3`）、idle 弹窗、
  available 弹窗（含 notes 块）。

## 4. 边界（明确不做）

- 不做更新历史 / 回滚 / 更新源切换——沿用 Tauri updater 的 `latest.json` 单一来源。
- 不做「上次检查时间 / 上次检查结果来自哪次启动」这类事实行：本应用链路的 `UpdateState` 没有
  时间戳（只有 omp 链路的 `OmpUpdate` 有），要加先扩状态机。
- 不做系统通知 / Dock 角标：chip 本身就是常驻提醒（沿用 V24 的「不弹系统通知」口径）。
- 启动静默检查的结论**落 chip**（2026-10-09 修订，原口径「auto 失败只 `console.warn`、成功后
  写 `idle`」作废，见文末补记）：`checking` 转轮 → 无新版本 `latest` 绿点 / 有新版本 `available`
  accent（按「稍后」记录决定弹窗与否）/ 失败 `error` 黄点（原因在弹窗里）——与 omp 链路同款；
  不弹系统通知。
- 不在「关于」保留版本号展示：应用版本在 chip 上常驻可见（`v0.9.0`），弹窗里也有「当前 v…」。

**补记（V31）：「关于」页签本身随后整页退场。** omp 的运行环境诊断（路径 / agentDir / 重新检测 / 指定路径）在 V31 搬进 `OmpUpdateDialog`（事实表下方新增「omp 诊断」块），那一页没有别的内容可放，于是连页签一起删掉（设置页八 → 七）。本节里「关于只剩 omp 运行环境诊断」的说法只描述 V30 当时的形态；迁移理由与实测见 `docs/v31-schedule.md`。

**补记（2026-10-09，启动自动检查的结论落库）**：V30 的 auto 检查在「已是最新」时写 `idle`（chip 保持灰点、`aria-label` 是「点击检查更新」——本节 §3「启动」场景记录的就是这个时点的行为），失败只 `console.warn` 不落状态。用户实测反馈「首次进来软件版本是灰色的」，与 omp 链路（`docs/v24-schedule.md`：启动即检查，转轮 → 已最新绿点 / 有新版本 accent / 失败黄点）不一致。现行口径 = **auto 与 manual 共用同一套落库**（`lib/appUpdate.ts`：`checking` → `latest` / `available` / `error`），区别只剩「auto 在有新版本时按 `updateDismissedVersion` 决定是否弹窗」；配合 `App.tsx` 启动 effect 的 `autoCheckOnBoot()`，首次进来即：转轮 → 绿点 / accent / 黄点。回归由 `src/lib/appUpdate.test.ts` 钉住（无更新写 latest、失败落 error、auto「稍后」不打扰）；顺带把该模块的动态 `import()` 改成静态导入（仓库惯例，`@tauri-apps/*` 一律顶层导入）。
