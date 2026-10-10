# ompMiniDesktop 三十六期（V36）：左栏右键菜单 + 工作区直接删除 + 全 app 禁用系统右键菜单

> 基线：V35（未发版）已交付。本文记录用户本轮的两个界面口径——**需求 → 设计 → 实现 → 核验**。
> 用户口径：「左侧工作区要支持直接删除，现在左侧工作区、项目、分支上的操作按钮太多了。我期望可以右键进行一些操作。并且 app 内全局禁用默认的右键事件。」

## 0. 结论先行

| 需求 | 落地 |
|---|---|
| 工作区支持直接删除 | 终端形态左栏**工作区组头右键 → 「删除工作区」**：就地 `ConfirmDialog` 二次确认（成员回归未分组，不删项目 / 文件）→ `delete_workspace` → `refreshSidebar` 收敛选中项与激活终端。此前删除只能进「编辑工作区」对话框，多两步。 |
| 操作按钮太多 → 右键 | **终端形态左栏树的行内操作按钮全数退场**，收进右键菜单：工作区头 =「编辑工作区…」/「删除工作区」；项目头 =「查看项目会话」/「移除项目」；目录行 =「提交…」/「推送 N 个未推送提交」（`ahead > 0` 时）。状态徽章（终端数 / 改动点 / 领先落后 / 上游缺失 / 任务态）与缺失目录的「重定位」修复条原样保留——它们是提示与修复引导，不是「按钮堆」。 |
| 全局禁用默认右键 | `main.tsx` 安装 `installNativeContextMenuOff()`：`document` 级的 `contextmenu` 一律 `preventDefault`——WebView 的「重新载入 / 检查元素 / 复制 / 拼写建议」在任何区域（终端、聊天、设置、输入框）都不再弹出。组件自己的右键动作走 React 合成事件（挂在应用根容器上，**先于** document 级监听执行），不受影响。 |

## 1. 设计

### 1.1 菜单：顶层单实例（`ContextMenuProvider` + `useContextMenu`）

- `App` 之上挂一份 Provider（`main.tsx`），管理唯一的「当前菜单」（锚点 + 条目）——同一时刻不可能出现两份菜单，也不要求每行组件自己管理开关状态；
- 菜单 portal 到 `document.body`，`z-10`（与下拉同层；`z-30` 对话框永远盖过它）。**不使用 `useDropdown` 的「挂进顶层弹窗」策略**：右键只发生在左栏，弹窗遮罩（`z-30`）盖住侧栏时右键根本到不了行上；
- 摆放：先按指针位置向右下渲染，`useLayoutEffect` 量出真实尺寸后经 `placeContextMenu` **越界翻转**（右溢出 → 向左、下溢出 → 向上）并夹进视口 `8px` 边距——布局阶段同步修正，不产生可见抖动；
- 关闭：点外部（`pointerdown` capture）/ Esc（`stopImmediatePropagation`，先于别的 Esc 处理）/ Tab / 滚动（内层容器捕获——菜单 fixed 不跟手）/ 窗口 resize / 失焦；关闭后焦点还给触发前的元素（菜单项动作若另开弹窗，弹窗稍后自行接管焦点）；
- 键盘：打开即聚焦首个可用项，↑↓ 循环（跳过禁用项）、Home / End 跳首尾；Esc 与 Tab 收菜单。

### 1.2 为什么全 app 禁用与组件右键动作可以共存

React 19 的合成事件监听挂在应用根容器（`#root`）与各 portal 容器上，**先于** `document` 上的原生监听执行；`ContextMenuProvider.open` 自己调 `preventDefault + stopPropagation`（避免行与行之间互相触发），因此在有行级菜单的区域，原生菜单在 React 阶段就被吞；在没有行级菜单的区域（终端、聊天、设置、空白），事件照常冒泡到 `document`，由全局安装器兜底吞掉。两条路径的实测见 §3（`prevented: true`）。

注意 `stopPropagation` 的副作用：行内右键时事件不再冒泡到 `document`，**验证「原生菜单被吞」不能用 document 冒泡监听的 `defaultPrevented`**——要在捕获阶段拿到事件对象、在传播结束后（`setTimeout 0`）再读 `defaultPrevented`（§3 的走查就是这么做的）。

### 1.3 菜单项映射（原按钮 → 菜单）

| 位置 | 原 UI | 现在 |
|---|---|---|
| 工作区组头 | hover `PenLine`（编辑） | 右键「编辑工作区…」 |
| 工作区组头 | 无（只能进对话框删） | 右键「删除工作区」+ `ConfirmDialog` |
| 项目头 | hover `Clock`（会话） | 右键「查看项目会话」 |
| 项目头 | hover `Trash2`（移除） | 右键「移除项目」+ 既有 `ConfirmDialog` |
| 目录行 | hover `ArrowUpCircle`（提交…） | 右键「提交…」（无改动可提时**禁用**并给出原因 title） |
| 目录行 | （无） | 右键「推送 N 个未推送提交」（`ahead > 0` 才有） |

保留：行内状态徽章（终端数 / dirty 点 / 领先徽章可点推送 / 落后 / 上游缺失 / 任务态）与缺失目录的「重定位」修复条；「未分组」段头无菜单（不可编辑 / 不可删）。

## 2. 实现位置

- `src/lib/contextMenu.ts`：`placeContextMenu` 摆放纯函数、React context（`useContextMenu`，无 Provider 时退化为「只吞原生菜单」，组件单测可直渲）、`installNativeContextMenuOff` 幂等安装器；
- `src/components/ContextMenu.tsx`：`ContextMenuProvider`（单实例菜单的渲染 / 定位 / 键盘 / 关闭 / 焦点归还）；
- `src/main.tsx`：安装全局禁用 + `<ContextMenuProvider>` 包 `App`；
- `src/components/sidebar/WorkspaceGroupSection.tsx`：组头右键菜单 + 删除工作区（`ConfirmDialog` 就地确认）；
- `src/components/sidebar/ProjectGroup.tsx`：项目头与目录行的右键菜单（`CheckoutRow` 的 `menuItems` 复用原有的 `canStart` / `ahead` 判定）；
- `src/lib/locale.ts`：新增 `wsGroupEdit`（中英），其余菜单文案复用既有键。

## 3. 实测（真实 Chromium + `__TAURI_INTERNALS__` mock，1400×900）

走查数据（`pnpm build` + `pnpm preview` + init script 注入 mock：2 个成员的工作区 + 3 个项目 + 4 个目录行；frontend = dirty + ahead 2）：

| 场景 | 结果 |
|---|---|
| 组头右键 | 菜单 `[编辑工作区…, 删除工作区]`，位置 = 指针（120/200），首项获焦；同时四类旧 hover 按钮（编辑 / 项目会话 / 移除项目 / 提交…）的 `aria-label` 计数**全部归零** |
| 「删除工作区」→ 确认 | `ConfirmDialog` 标题「删除工作区「全栈电商」？」→ 确认后 `delete_workspace("w1")` 被调、弹窗关闭、组消失、项目平铺（p1/p2/p3） |
| 项目头右键 → 「查看项目会话」 | `SessionPopup` 打开（`frontend · 会话`），菜单自动关闭 |
| 目录行右键（frontend） | `[提交…, 推送 2 个未推送提交]`，均可用 |
| 目录行右键（infra，干净） | `[提交…]` **禁用**，title =「没有可提交或推送的改动」 |
| 真实 CDP 右键（backend 行） | 菜单在点击处打开（box 112,378 = 菜单 left/top）；capture + 延迟读 `defaultPrevented = true`（原生菜单被吞） |
| 主区空白真实右键 | `defaultPrevented = true`、不弹自定义菜单（全局兜底生效） |
| 点外部（真实左键） | 菜单关闭 |
| 点「提交…」 | `get_change_set` 调起（提交面板），菜单关闭 |

自动化回归：`pnpm check`（553 vitest + e2e:ipc 94 命令）全绿——新增 `lib/contextMenu.test.ts` 6 条、`components/ContextMenu.test.tsx` 6 条、`components/sidebar/WorkspaceGroupSection.test.tsx` 3 条。

## 4. 边界

- **两形态左栏都已覆盖**（聊天侧为当日追加，见 §5）：终端形态左栏树全量右键化；聊天形态左栏的会话行 / 项目分组头 / 未归属组 / 工作区段头同样右键化（工作区的编辑 / 删除在聊天侧是**新增入口**，与终端同一语义）；
- 菜单项只做「原按钮的等价搬迁 + 工作区删除」，**不加**复制路径 / 在访达显示 / 新建终端等新动作（要加先定交互）；
- 全局禁用后，系统右键菜单在任何区域都不可用（含文本「复制 / 粘贴」的系统菜单与拼写建议）——用户明确要求；键盘 ⌘C/⌘V 不受影响；
- 工作区拖拽排序 / 编辑对话框的「删除工作区」入口都保留——右键菜单是补充，不是替代。

## 5. 聊天形态同步（2026-10-10 追加，用户口径：「聊天形态也要同步修改」）

聊天形态左栏（`ChatSidebar`）的四类行同样右键化——与终端侧共用同一套 `ContextMenuProvider`（组件测试里包 Provider 直渲；没有 Provider 时退化为「只吞原生菜单」，不影响旧用例）：

| 位置 | 原 UI | 现在 |
|---|---|---|
| 会话行 | 右侧 68px 槽位 hover 换成「归档」键（与时间同槽互斥） | 右键「归档会话 / 删除对话」（删除真删 jsonl，先走 `ConfirmDialog`，确认后 `delete_sessions`）；时间常显 |
| 项目分组头 | 动作槽：提交… / ＋新建会话 / 归档全部（与计数互斥） | 右键「新建会话 / 提交… / 归档本项目全部对话」；计数常显 |
| 「未归属会话」组头 | hover 归档全部（与计数互斥） | 右键「归档全部未归属对话」 |
| 工作区段头 | 无（编辑 / 删除此前只在终端形态） | 右键「编辑工作区… / 删除工作区」——**聊天侧新增入口**：同一个 `WorkspaceGroupDialog`（编辑回填）+ `ConfirmDialog` + `delete_workspace`；「未分组」段无菜单（与终端同款） |

实测（真实 Chromium `pnpm build` + preview + mock，切到聊天形态）：

| 场景 | 结果 |
|---|---|
| 旧 hover 键 | 「归档会话 / 提交… / 在 X 新建会话 / 归档 X 全部对话 / 归档全部未归属对话」的 aria-label 计数**全部为 0** |
| 会话行右键 | `[归档会话, 删除对话]`；点「删除对话」→ `ConfirmDialog`（标题 = 会话名、「删除会话后不可恢复」）→ 确认 → `delete_sessions(["s1"])` → 行消失、其它会话保留 |
| 项目头右键（frontend） | `[新建会话, 提交…, 归档 frontend 全部对话]` |
| 未归属组右键 | `[归档全部未归属对话]` |
| 段头右键 → 删除 | `[编辑工作区…, 删除工作区]` → `ConfirmDialog`「删除工作区「全栈电商」？」→ 确认 → `delete_workspace("w1")` → 段消失 |
| 段头右键 → 编辑 | 对话框打开并回填「全栈电商」 |
| 「未分组」段右键 | 不弹菜单 |

回归：`ChatSidebar.test.tsx` 改 1（提交键 → 右键菜单）+ 增 6（会话行归档 / 会话行删除确认调 `delete_sessions` / 未归属组 / 段头编辑 / 段头删除 / 未分组无菜单），共 14 条；全量 `pnpm check`（559 vitest + e2e:ipc 94 命令）全绿。
