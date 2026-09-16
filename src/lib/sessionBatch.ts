import { api } from "@shared/api";
import { useApp } from "../stores/app";

/**
 * 会话批量操作的唯一实现（左栏分组头与设置页「已归档对话」共用）。
 *
 * 两处入口做的事完全一样：按 `BATCH_LIMIT` 分批调后端、逐批聚合失败明细。
 * 各家自己拼一遍等于给「一次上限」留两个会漂移的副本——后端超限会直接拒绝整批。
 */
export const BATCH_LIMIT = 200;

/** 批量结果：成功数 + 失败明细（`id` + 原因）。 */
export type BatchOutcome = { ok: number; failed: { id: string; message: string }[] };

export async function runSessionBatch(
 kind: "archive" | "unarchive" | "delete",
 ids: string[],
): Promise<BatchOutcome> {
 const failed: { id: string; message: string }[] = [];
 let ok = 0;
 for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
  const chunk = ids.slice(i, i + BATCH_LIMIT);
  const res =
   kind === "archive"
    ? await api.archiveSessions(chunk)
    : kind === "unarchive"
     ? await api.unarchiveSessions(chunk)
     : await api.deleteSessions(chunk);
  ok += res.ok;
  failed.push(...res.failed);
 }
 return { ok, failed };
}

/**
 * 删除成功后清掉前端痕迹：正在看的会话退回空态、该会话缓存的事件与状态一并丢弃，
 * 不留幽灵消息。只传**真正删掉**的 id——失败的那些还在列表里，缓存要继续可读。
 */
export function pruneDeletedSessions(ids: string[]) {
 const st = useApp.getState();
 const eventsBySession = { ...st.eventsBySession };
 const statusBySession = { ...st.statusBySession };
 for (const id of ids) {
  delete eventsBySession[id];
  delete statusBySession[id];
 }
 const activeGone = st.activeSessionId !== null && ids.includes(st.activeSessionId);
 st.set({
  eventsBySession,
  statusBySession,
  activeSessionId: activeGone ? null : st.activeSessionId,
 });
}
