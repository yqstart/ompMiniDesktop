import { useEffect, useRef } from "react";
import {
 isPermissionGranted,
 requestPermission,
 sendNotification,
} from "@tauri-apps/plugin-notification";
import { useApp } from "../stores/app";

/**
 * 长任务完成通知：agent 从 running 切回 idle / awaiting-approval 时，
 * 若窗口不在前台，发一条系统通知（标题 + 首行文本），点击回到应用即可。
 * 权限首次需要时再申请，不打扰启动。
 */
export function useTaskNotifications() {
 const lastState = useRef<Record<string, string>>({});
 const { activeSessionId, statusBySession, eventsBySession } = useApp();
 useEffect(() => {
  if (!activeSessionId) return;
  const cur = statusBySession[activeSessionId]?.state;
  const prev = lastState.current[activeSessionId];
  lastState.current[activeSessionId] = cur ?? "";
  if (!cur || prev !== "running" || (cur !== "idle" && cur !== "awaiting-approval")) return;
  if (document.visibilityState === "visible") return;
  const msgs = eventsBySession[activeSessionId] ?? [];
  const lastText = [...msgs].reverse().find((m) => m.kind === "text" && m.text.trim()) as
   | { text: string }
   | undefined;
  const body =
   cur === "awaiting-approval"
    ? "Agent 等待你的审批"
    : lastText
     ? lastText.text.slice(0, 120)
     : "Agent 已完成本轮";
  void (async () => {
   try {
    if (!(await isPermissionGranted())) await requestPermission();
    sendNotification({ title: "ompMiniDesktop", body });
   } catch {
    // 通知失败不打扰主流程
   }
  })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeSessionId, statusBySession]);
}
