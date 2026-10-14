import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Loader, Sparkles } from "reicon-react";
import type { SubAgentInfo } from "@shared/types";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { useText } from "../../lib/useText";
import { fmt, type Text } from "../../lib/locale";
import { PanelSection } from "./PanelSection";

/** 无子代理会话共用的空数组：selector 每次返回同一引用，避免 zustand 无谓重渲。 */
const EMPTY: SubAgentInfo[] = [];

/**
 * 右栏「子代理」区块（v2；由 v1 的消息列上方状态条 `SubAgentStrip` 迁入——不再以独立状态条重复出现）。
 *
 * omp 的 `task` 工具会 spawn 一批子会话；这里在右栏列出本会话的子代理：running 在前、
 * 每行状态色点 + 取消；点击行展开该子代理的转录（首次拉全量、之后按 `nextByte` 增量追加，
 * running 时每 3s 轮询一次）。数据只读 `subagentsBySession`（帧与打开会话时的补拉写入），
 * 取消走 `api.cancelSubagent`，终态由 omp 的 `subagent_lifecycle` 帧回灌，本地不猜状态。
 * 没有子代理时整块不渲染。
 */
export function SubagentsSection() {
 const subs = useApp((s) => (s.activeSessionId ? (s.subagentsBySession[s.activeSessionId] ?? EMPTY) : EMPTY));
 const sid = useApp((s) => s.activeSessionId);
 const t = useText();
 /** 展开转录的子代理（单展开）：带 sid 标记——切会话后旧展开态自动失效。 */
 const [expanded, setExpanded] = useState<{ sid: string; id: string } | null>(null);
 const expandedId = expanded && expanded.sid === sid ? expanded.id : null;
 if (subs.length === 0) return null;
 const running = subs.filter((s) => s.status === "running");
 return (
  <PanelSection
   title={t.panelSubagents}
   anchor="panel-subagents"
   action={
    <span className="shrink-0 text-[11px] text-faint">
     {running.length > 0 ? fmt(t.saRunning, running.length) : fmt(t.saTotal, subs.length)}
    </span>
   }
  >
   <ul className="-mx-1 space-y-px">
    {/* running 在前（其余保持注册表顺序） */}
    {[...running, ...subs.filter((s) => s.status !== "running")].map((sub) => (
     <SubAgentRow
      key={sub.id}
      sub={sub}
      sid={sid}
      t={t}
      expanded={expandedId === sub.id}
      onToggle={() => setExpanded((cur) => (cur?.id === sub.id ? null : sid ? { sid, id: sub.id } : null))}
     />
    ))}
   </ul>
  </PanelSection>
 );
}

/** 状态 → 色点与文案：颜色只是身份，`aria-label` 与可见文案都给出状态词。 */
const STATUS: Record<SubAgentInfo["status"], { dot: string; text: (t: Text) => string }> = {
 running: { dot: "animate-pulse bg-accent", text: (t) => t.saStatusRunning },
 completed: { dot: "bg-ok", text: (t) => t.saStatusCompleted },
 failed: { dot: "bg-danger", text: (t) => t.saStatusFailed },
 aborted: { dot: "bg-danger", text: (t) => t.saStatusAborted },
};

function SubAgentRow({
 sub,
 sid,
 t,
 expanded,
 onToggle,
}: {
 sub: SubAgentInfo;
 sid: string | null;
 t: Text;
 expanded: boolean;
 onToggle: () => void;
}) {
 const status = STATUS[sub.status];
 const label = status.text(t);
 return (
  <li>
   <div className="group/sa flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-100 hover:bg-hover">
    <span role="img" aria-label={label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${status.dot}`} />
    <button
     onClick={onToggle}
     className="min-w-0 flex-1 cursor-pointer text-left"
     aria-expanded={expanded}
     aria-label={fmt(t.saOpenAria, sub.agent)}
    >
     <span className="flex items-baseline gap-1.5">
      <span className="truncate font-mono text-[12px] text-foreground">{sub.agent}</span>
      {/* 状态词已由色点的 aria-label 播报，可见的这份不再重复读 */}
      <span aria-hidden className="shrink-0 text-[10px] text-faint">
       {label}
      </span>
     </span>
     {sub.description && <span className="block truncate text-[11px] text-muted">{sub.description}</span>}
    </button>
    {sub.status === "running" && <CancelButton sid={sid} sub={sub} t={t} />}
    {expanded ? (
     <ChevronDown size={12} className="shrink-0 text-faint" aria-hidden />
    ) : (
     <ChevronRight size={12} className="shrink-0 text-faint" aria-hidden />
    )}
   </div>
   {expanded && sid && <TranscriptPane sid={sid} sub={sub} t={t} />}
  </li>
 );
}

/**
 * 取消按钮：**单次提交**——按下即 pending（禁用 + 转圈）防重，成功由生命周期帧把该行
 * 变成终态（按钮随之消失），只有失败才解除 pending 让用户重试。
 */
function CancelButton({ sid, sub, t }: { sid: string | null; sub: SubAgentInfo; t: Text }) {
 const [pending, setPending] = useState(false);
 const cancel = async () => {
  if (pending || !sid) return;
  setPending(true);
  try {
   const res = await api.cancelSubagent(sid, sub.id);
   // 后端回执说没取消成（子代理自己刚结束）就别锁死按钮——终态帧很快会把这一行换掉
   if (!res?.cancelled) setPending(false);
  } catch {
   setPending(false); // 失败留在 running 行上，可再点；错误本身由消息流的分隔线兜底
  }
 };
 return (
  <button
   type="button"
   disabled={pending}
   aria-label={fmt(t.saCancelAria, sub.agent)}
   onClick={() => void cancel()}
   className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted"
  >
   {pending && <Loader size={10} className="animate-spin" aria-hidden />}
   {t.saCancel}
  </button>
 );
}

/** 转录最多渲染多少条：超出保尾截前（长跑子代理不必把面板撑爆）。 */
const MAX_TRANSCRIPT = 200;

/** 增量读的间隔：只看 running 的子代理。 */
const POLL_MS = 3000;

/** 渲染行：`tool` 为 true 的是工具调用行（`⚙ name`），其余是消息文本块拼成的行。 */
type TranscriptLine = { tool: boolean; text: string };

/**
 * 消息数组 → 渲染行：按块序取文本块就地拼行（同一消息的多段 text 合成一行），
 * 工具调用单独一行；thinking 等其它块忽略，空内容自然不产生行。
 */
function transcriptLines(messages: unknown[]): TranscriptLine[] {
 const lines: TranscriptLine[] = [];
 for (const raw of messages) {
  const content = (raw as { content?: unknown } | null)?.content;
  if (!Array.isArray(content)) continue;
  let run: string[] = [];
  const flush = () => {
   if (run.length === 0) return;
   lines.push({ tool: false, text: run.join("\n") });
   run = [];
  };
  for (const block of content) {
   const b = block as { type?: string; text?: unknown; name?: unknown } | null;
   if (!b) continue;
   if (b.type === "text" && typeof b.text === "string" && b.text.trim() !== "") run.push(b.text.trim());
   else if (b.type === "toolCall") {
    flush();
    lines.push({ tool: true, text: typeof b.name === "string" ? b.name : "" });
   }
  }
  flush();
 }
 return lines;
}

/**
 * 子代理转录面板：行下内联展开，自带滚动区。
 *
 * 首次拉全量（不带 `fromByte`），把回执的 `nextByte` 存进 `cursor`；之后「刷新」按钮
 * 与 running 时的 3s 轮询都拿它做增量读。`reset: true` 表示后端重开了文件，旧内容作废、
 * 这份当全量重建。失败只显示一行错误（已有内容保留），下次成功自动清掉。
 * 卸载即清定时器——收起/切行/换会话都靠卸载这条路径。
 */
function TranscriptPane({ sid, sub, t }: { sid: string; sub: SubAgentInfo; t: Text }) {
 /** 已读到的内容：null = 还没成功拉过（loading 由此派生——effect 里不做同步 setState）。 */
 const [view, setView] = useState<{ msgs: unknown[]; omitted: number } | null>(null);
 const [error, setError] = useState<string | null>(null);
 const loading = view === null && error === null;
 /** 增量读游标：ref 而非 state，免得进依赖把轮询定时器重挂。 */
 const cursor = useRef<number | null>(null);

 const pull = useCallback(
  async (fromByte?: number) => {
   const res = await api.getSubagentMessages(sid, sub.id, fromByte);
   const incoming = (res.messages ?? res.entries ?? []) as unknown[];
   if (typeof res.nextByte === "number") cursor.current = res.nextByte;
   setView((prev) => {
    const base = prev ?? { msgs: [], omitted: 0 };
    const all = res.reset ? incoming : [...base.msgs, ...incoming];
    const drop = Math.max(0, all.length - MAX_TRANSCRIPT);
    return { msgs: drop > 0 ? all.slice(drop) : all, omitted: (res.reset ? 0 : base.omitted) + drop };
   });
   setError(null);
  },
  [sid, sub.id],
 );

 // 首拉：从头读（不带 fromByte）——与 ContextMeter 同一写法：effect 里**内联**发起请求、
 // 状态只在 promise 回调里落（复用 pull 会被 lint 视为「effect 体内可能同步 setState」）
 useEffect(() => {
  let alive = true;
  void api
   .getSubagentMessages(sid, sub.id, undefined)
   .then((res) => {
    if (!alive) return;
    const incoming = (res.messages ?? res.entries ?? []) as unknown[];
    if (typeof res.nextByte === "number") cursor.current = res.nextByte;
    const drop = Math.max(0, incoming.length - MAX_TRANSCRIPT);
    setView({ msgs: drop > 0 ? incoming.slice(drop) : incoming, omitted: drop });
    setError(null);
   })
   .catch((e: unknown) => {
    if (alive) setError(e instanceof Error ? e.message : String(e));
   });
  return () => {
   alive = false;
  };
 }, [sid, sub.id]);

 /** 手动刷新 / 轮询共用：接着上次的 nextByte 增量读；还没成功过就当首拉。 */
 const refresh = useCallback(() => {
  void pull(cursor.current ?? undefined).catch((e: unknown) =>
   setError(e instanceof Error ? e.message : String(e)),
  );
 }, [pull]);

 // running 才轮询；子代理转终态、切行或组件卸载都会清掉定时器
 useEffect(() => {
  if (sub.status !== "running") return;
  const timer = setInterval(refresh, POLL_MS);
  return () => clearInterval(timer);
 }, [sub.status, refresh]);

 const lines = useMemo(() => transcriptLines(view?.msgs ?? []), [view]);

 return (
  <div
   role="region"
   aria-label={fmt(t.saTranscriptAria, sub.agent)}
   className="mt-0.5 mb-1 ml-4 rounded-md border border-border-soft bg-surface"
  >
   <div className="flex items-center gap-2 border-b border-border-soft px-2 py-1">
    {/* 面板整体已带同一个 aria-label，可见的这份不再重复播报 */}
    <Sparkles size={11} className="shrink-0 text-faint" aria-hidden />
    <span aria-hidden className="min-w-0 flex-1 truncate text-[11px] text-faint">
     {t.saTranscriptTitle}
    </span>
    <button
     type="button"
     aria-label={t.saRefresh}
     onClick={refresh}
     className="shrink-0 cursor-pointer rounded-md border border-border px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
    >
     {t.saRefresh}
    </button>
   </div>
   <div className="max-h-64 overflow-y-auto px-2 py-1.5">
    {error && (
     <div role="alert" className="text-[11px] leading-relaxed break-words text-danger">
      {fmt(t.saTranscriptFailed, error)}
     </div>
    )}
    {!error && loading && <div className="text-[11px] text-faint">{t.saTranscriptLoading}</div>}
    {!error && !loading && lines.length === 0 && <div className="text-[11px] text-faint">{t.saTranscriptEmpty}</div>}
    {lines.length > 0 && (
     <>
      {(view?.omitted ?? 0) > 0 && (
       <div className="text-[11px] text-faint">{fmt(t.saTranscriptMore, view?.omitted ?? 0)}</div>
      )}
      {lines.map((l, i) =>
       l.tool ? (
        <div key={i} className="truncate font-mono text-[11px] text-faint">
         {"⚙ "}
         {l.text}
        </div>
       ) : (
        <div key={i} className="text-[11px] leading-relaxed whitespace-pre-wrap break-words text-muted">
         {l.text}
        </div>
       ),
      )}
     </>
    )}
   </div>
  </div>
 );
}
