import { useEffect } from "react";
import { useSessionEvents } from "../../lib/useSessionEvents";
import { useTaskNotifications } from "../../lib/useTaskNotifications";
import { hydrateDrafts } from "../../lib/openPath";
import { TopBar } from "./TopBar";
import { Thread } from "./Thread";
import { StatusBar } from "./StatusBar";
import { Composer } from "../composer/Composer";

/**
 * 聊天形态主区（V32；V1–V10 形态的恢复）：顶栏 + 消息流 + 输入框。
 *
 * - **常驻挂载、只切显隐**（与终端面板同一课）：切去终端形态 / 设置标签时只是 `hidden`，
 *   xterm 那套「卸载即 kill」的教训对聊天侧同样成立——切回来时要保住滚动位置与订阅；
 * - 事件订阅（`useSessionEvents`）与完成通知（`useTaskNotifications`）挂在这里：
 *   它们跟随 `activeSessionId` 建立 / 释放，形态切走时订阅保持（后台会话继续收流）；
 * - `StatusBar` 本身是不可见的 aria-live 区域（状态已收敛进输入框内的状态胶囊），
 *   保留是为了读屏播报。
 */
export function ChatView({ visible = true }: { visible?: boolean }) {
 useSessionEvents();
 useTaskNotifications();
 useEffect(() => {
  // 草稿持久化（localStorage `omp.drafts.v1`）：启动水合一次；之后的写入在 Composer 里随输入进行
  hydrateDrafts();
 }, []);
 return (
  <div
   inert={!visible}
   className={visible ? "flex min-h-0 min-w-0 w-full flex-1 flex-col" : "hidden"}
  >
   <TopBar />
   <Thread />
   <StatusBar />
   <Composer />
  </div>
 );
}
