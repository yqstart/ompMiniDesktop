import type { ViewMsg } from "@shared/types";

/**
 * 实时事件与已有消息流的合并（纯函数，便于单测）。
 *
 * 背景（历史 bug）：一次工具调用在 RPC 流里会分多个阶段到达——
 * `toolcall_delta`（输入中）→ `toolcall_end`（运行中）→ `tool_execution_start`
 * → `tool_execution_end` / `message{toolResult}`（终态）。若每个阶段都无脑追加，
 * 同一次调用会渲染成 2～3 张卡，其中"输入中"那张永远转圈——就是设计稿点名要修的
 * 「已完成工具仍转圈」。历史回放路径已由 `viewMsgsFromJsonlLines` 按 toolCallId
 * 合并解决；本模块负责实时路径的同等待遇。
 *
 * 两条合并规则：
 * 1. `text` 的 `__append`：同一个流式块按 id 覆盖（不是新增一行）。
 * 2. `tool` 卡：按 id 覆盖并**合并字段**——状态与输出以新卡为准，名称/意图/参数摘要
 *    这类"调用元数据"只在早期事件里出现，必须从旧卡继承，否则终态卡会丢参数。
 */

/** 内部标记：只在实时管线中使用，落 store 前会被剥掉，不属于 ViewMsg。 */
export type InternalFlags = {
  /** text 流式追加：同 id 覆盖而非新增。 */
  __append?: boolean;
  /** 工具卡换 id：先用 contentIndex 占位、`toolcall_end` 后换成 toolCallId 卡。 */
  __replaceId?: string;
};

export type IncomingViewMsg = ViewMsg & InternalFlags;

type ToolCard = Extract<ViewMsg, { kind: "tool" }>;

/** 工具卡字段合并：终态覆盖状态/输出，早期事件里的元数据不许丢。 */
export function mergeToolCard(oldCard: ToolCard, next: ToolCard): ToolCard {
  return {
    ...oldCard,
    ...next,
    id: next.id || oldCard.id,
    toolCallId: next.toolCallId || oldCard.toolCallId,
    name: next.name && next.name !== "tool" ? next.name : oldCard.name,
    intent: next.intent || oldCard.intent,
    argsSummary:
      next.argsSummary && next.argsSummary !== "输入中…" ? next.argsSummary : oldCard.argsSummary,
    output: next.output || oldCard.output,
    outputFull: next.outputFull ?? oldCard.outputFull,
  };
}

/** 剥掉内部标记，保证 store 里只留干净 ViewMsg（e2e:ipc 的 ViewMsg 契约不受影响）。 */
export function stripInternal(m: IncomingViewMsg): ViewMsg {
  if (m.__append === undefined && m.__replaceId === undefined) return m;
  const { __append, __replaceId, ...rest } = m;
  void __append;
  void __replaceId;
  return rest as ViewMsg;
}

export function mergeViewMsgs(cur: ViewMsg[], incoming: IncomingViewMsg[]): ViewMsg[] {
  const out = cur.slice();
  for (const raw of incoming) {
    const next = stripInternal(raw);
    // 换 id：流式占位卡被正式卡取代，原位替换成合并后的卡（保持消息顺序）
    if (raw.__replaceId) {
      const ri = out.findIndex((x) => x.id === raw.__replaceId);
      if (ri >= 0) {
        const oldCard = out[ri];
        out.splice(ri, 1);
        if (oldCard.kind === "tool" && next.kind === "tool") {
          const dup = out.findIndex((x) => x.kind === "tool" && x.id === next.id);
          if (dup >= 0) {
            out[dup] = mergeToolCard(oldCard, out[dup] as ToolCard);
          } else {
            out.splice(ri, 0, mergeToolCard(oldCard, next));
          }
          continue;
        }
      }
    }
    if (raw.__append && next.kind === "text") {
      const idx = out.findIndex((x) => x.kind === "text" && x.id === next.id && !x.complete);
      if (idx >= 0) out[idx] = next;
      else out.push(next);
      continue;
    }
    if (next.kind === "tool") {
      const idx = out.findIndex((x) => x.kind === "tool" && x.id === next.id);
      if (idx >= 0) {
        out[idx] = mergeToolCard(out[idx] as ToolCard, next);
        continue;
      }
    }
    // 同一个审批请求重复推送（重连 / 重放）只保留一张卡
    if (next.kind === "approval") {
      const idx = out.findIndex((x) => x.kind === "approval" && x.id === next.id);
      if (idx >= 0) {
        out[idx] = next;
        continue;
      }
    }
    // 通用 UI 请求同理按 uiId 去重（同一条 request 重放不会出两张卡）
    if (next.kind === "ui") {
      const idx = out.findIndex((x) => x.kind === "ui" && x.uiId === next.uiId);
      if (idx >= 0) {
        out[idx] = next;
        continue;
      }
    }
    // 服务端撤回：连同对应卡片一起从流里移除（用户已无法回包，留着就是死卡）
    if (next.kind === "ui-cancel") {
      const idx = out.findIndex((x) => x.kind === "ui" && x.uiId === next.uiId);
      if (idx >= 0) out.splice(idx, 1);
      continue;
    }
    out.push(next);
  }
  return out;
}
