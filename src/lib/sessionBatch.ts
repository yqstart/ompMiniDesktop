import { api } from "@shared/api";

/**
 * 会话批量操作的唯一实现（会话弹窗与设置页「已归档对话」共用）。
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

