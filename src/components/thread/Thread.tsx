import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BranchUp, Bulb, Check, CheckListSquare, ChevronRight, Copy, Loader, PenLine, Sparkles } from "reicon-react";
import { THREAD_PAGE, useApp } from "../../stores/app";
import { fmt } from "../../lib/locale";
import { useText } from "../../lib/useText";
import { api } from "@shared/api";
import { openForkedSession } from "../../lib/sessionOpen";
import { openBtwPanel } from "../../lib/btw";
import { nthMap } from "../../lib/viewmsg";
import { buildThreadLayout } from "../../lib/threadLayout";
import type { ViewMsg } from "@shared/types";
import { ToolRow } from "./ToolRow";
import { ToolRunRow } from "./ToolRunRow";
import { TurnRow } from "./TurnRow";
import { ApprovalCard } from "./ApprovalCard";
import { UiRequestCard } from "./UiRequestCard";
import { MentionChips } from "./MentionChips";
import { AssistantText } from "./AssistantText";
import { ChatEmptyState } from "./ChatEmptyState";
import { useElapsedSeconds, formatElapsed } from "../../lib/useElapsed";
import { useRevealedText } from "../../lib/streamReveal";

/** 空消息流的稳定引用（见 `Thread` 里 `events` 的说明）。 */
const EMPTY_EVENTS: ViewMsg[] = [];

/** 一次划选最多引用的字符数：超长选区截断，避免把整篇对话塞进草稿 / 旁问。 */
const MAX_SELECTION = 2000;

export function Thread() {
 const { projects, activeSessionId, eventsBySession, statusBySession, threadLimitSid, threadLimit, growThreadLimit, sessions } =
  useApp();
 const t = useText();
 const cwd = sessions.find((s) => s.id === activeSessionId)?.cwd ?? "";
 const archived = sessions.find((s) => s.id === activeSessionId)?.archived ?? false;
 const scroller = useRef<HTMLDivElement>(null);
 // 划选浮条（V40）：划中正文后在选区上方浮出「引用到输入框 / 旁问」。
 // 位置在 mouseup 时算一次（fixed 定位），滚动 / Esc / 点别处 / 动作执行后即关。
 const selBar = useRef<HTMLDivElement>(null);
 const [sel, setSel] = useState<{ left: number; top: number; text: string } | null>(null);
 // 「贴着底」状态（V37，粘性语义）：贴底时**任何内容增长**都保持贴底——关键是流式文本
 // 原位追加（同一消息变高），此前只认「消息条数变化」，视口在文本流式期间完全不动，
 // 文字在屏外生长（用户实测「没有输出的爽感」：内容超出 480px 视口仍停在原地）。
 // 用户上翻超过阈值（80px）即释放，程序 / 手动滚回底部附近自动恢复。判定在 onScroll，
 // 跟随动作在 useLayoutEffect（paint 前补滚动，输出不先画在屏外再跳）。
 const stick = useRef(true);
 // 「加载更早」后要保住视口位置：记录加载前距底部的距离，插入后补回去
 const keepOffset = useRef<number | null>(null);
 /**
  * 跟随动作（V37/V38）：贴底时把视口带到新底部。两道防线——
  * 1. `stick`（onScroll 维护）：用户上翻即释放；
  * 2. `lastH` 对账：**滚动事件与流式提交有同帧竞态**——用户刚滚开、scroll 事件还没派发，
  *    提交里的贴底动作就会把这次滚动吞掉（浏览器核对实测）。距底距离超过「本次新增高度 +
  *    8px」即认定用户已经滚开，当场释放；对任何输入方式（滚轮 / 键盘 / 触屏 / 程序化）都成立。
  */
 const lastH = useRef(0);
 const followBottom = useCallback(() => {
  const el = scroller.current;
  if (!el) return;
  const h = el.scrollHeight;
  const grew = Math.max(0, h - lastH.current);
  lastH.current = h;
  if (!stick.current) return;
  if (h - el.scrollTop - el.clientHeight > grew + 8) {
   stick.current = false;
   return;
  }
  el.scrollTop = h;
 }, []);
 /**
  * 消息列**内容盒**的回调 ref：平滑揭示每帧长高（不进 store），跟滚 effect 捕获不到——
  * ResizeObserver 盯内容盒，贴底时任何高度增长都补滚（揭示 / 图片加载 / 字体就位）。
  * 用回调 ref 而不是「effect + useRef」：Thread 常驻挂载，首屏可能是空态（内容盒不在 DOM），
  * 普通 effect 早退一次就再也接不上（浏览器核对实测过这个缺陷）；回调 ref 在节点
  * 真正挂上 / 换掉时触发，天然覆盖「空态 → 会话 → 换会话」所有路径。
  */
 const contentRo = useRef<ResizeObserver | null>(null);
 const attachContent = useCallback(
  (el: HTMLDivElement | null) => {
   contentRo.current?.disconnect();
   contentRo.current = null;
   if (el && typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => followBottom());
    ro.observe(el);
    contentRo.current = ro;
   }
  },
  [followBottom],
 );
 // 空态用模块级常量：`?? []` 每渲染都是新引用，会让下面的跟随 effect 依赖失效（eslint
 // exhaustive-deps 直接警告；语义上「没有事件」也不该被当成一次更新）。
 const events = (activeSessionId ? eventsBySession[activeSessionId] : undefined) ?? EMPTY_EVENTS;
 // 流式进行中（后端状态帧 / 回读真值）：流尾没有「正在输出」的行时补一条「思考中…」。
 // 为什么必须有：慢模型（尤其推理档拉满）从发送到首个 delta 可能几十秒到几分钟，
 // 期间「只有用户那条消息」——用户看到的就是「发送后无任何反应」。指示行是纯派生渲染，
 // 不进 store、不参与历史与去重。
 const status = activeSessionId ? statusBySession[activeSessionId]?.state : undefined;
 const working = status === "running" && !hasLiveTail(events[events.length - 1]);
 // 指示行**延迟露面**（V46）：文本段收尾与下一个块（工具 / 思考）之间往往只隔一两帧，
 // 立即挂出会「闪一下又消失」；持续的空窗（等首个 token / 等下一步）才值得说「在跑」。
 const workingVisible = useDelayedFlag(working, 300);
 // 分叉类动作只在稳定态可用（zcode 同口径）：运行中 / 待审批时转录还在落盘、定位不可靠；
 // 已归档会话只读。冻结原因分两种，作为按钮 title。
 const frozen = archived || status === "running" || status === "awaiting-approval";
 const frozenTitle = archived ? t.archivedComposerHint : t.msgForkBusyHint;
 // 分叉定位用的「同类同文本」序号表（见 `nthMap`）。
 const nthById = useMemo(() => nthMap(events), [events]);
 // 划选浮条：Esc / 点浮条外即关（浮条自身的 mousedown 被 preventDefault，不会清掉选区）
 useEffect(() => {
  if (!sel) return;
  const onKey = (e: KeyboardEvent) => {
   if (e.key === "Escape") setSel(null);
  };
  const onDown = (e: MouseEvent) => {
   const bar = selBar.current;
   if (bar && e.target instanceof Node && bar.contains(e.target)) return;
   setSel(null);
  };
  window.addEventListener("keydown", onKey);
  document.addEventListener("mousedown", onDown);
  return () => {
   window.removeEventListener("keydown", onKey);
   document.removeEventListener("mousedown", onDown);
  };
 }, [sel]);
 // 首屏增量（MASTER §7）：只渲染最后 N 条，向上加载更多。窗口按会话重置。
 const limit = threadLimitSid === activeSessionId ? threadLimit : THREAD_PAGE;
 const hidden = Math.max(0, events.length - limit);
 const shown = hidden > 0 ? events.slice(-limit) : events;
 // 消息列布局（v2 §2.1）：相邻同类工具行聚合成摘要行 + 每轮末尾的时长行；
 // running 时跳过压在流尾的进行中轮次（没有时长可报）
 const layout = useMemo(() => buildThreadLayout(shown, status === "running"), [shown, status]);
 const loadEarlier = () => {
  const el = scroller.current;
  if (el) keepOffset.current = el.scrollHeight - el.scrollTop;
  growThreadLimit(THREAD_PAGE);
 };
 /**
  * 划选浮条定位（mouseup）：要求选区非空、且 anchor 与 focus 都在消息列容器内——
  * 跨到左栏 / 输入框的选区不算「划中对话内容」。位置取选区末端的矩形，越界往回收
  * （贴顶时往下让，靠边时水平收进视口），浮条本身是 fixed，不参与消息列布局。
  */
 const onMouseUp = () => {
  const el = scroller.current;
  if (!el) return;
  const s = window.getSelection();
  if (!s || s.isCollapsed || s.rangeCount === 0) return;
  if (!el.contains(s.anchorNode) || !el.contains(s.focusNode)) return;
  const text = s.toString().trim();
  if (!text) return;
  const rect = s.getRangeAt(0).getBoundingClientRect();
  setSel({
   left: Math.min(Math.max(rect.left + rect.width / 2, 96), Math.max(96, window.innerWidth - 96)),
   top: Math.max(rect.top - 6, 44),
   text: text.slice(0, MAX_SELECTION),
  });
 };
 /** 引用到输入框：选中文本转成每行 `> ` 的引用块追加进草稿（有空草稿时先空一行隔开）。 */
 const quoteSelection = () => {
  const sid = activeSessionId;
  if (!sid || !sel) return;
  const block = `${sel.text
   .split("\n")
   .map((l) => `> ${l}`)
   .join("\n")}\n\n`;
  const old = useApp.getState().draftOf(sid);
  useApp.getState().setDraft(sid, old.trim() ? `${old}\n\n${block}` : block);
  setSel(null);
 };
 /** 旁问：带着选中文本打开面板（预填进输入框，不自动发送）。 */
 const askSelection = () => {
  const sid = activeSessionId;
  if (!sid || !sel) return;
  void openBtwPanel(sid, sel.text);
  setSel(null);
 };
 useLayoutEffect(() => {
  const el = scroller.current;
  if (el && keepOffset.current != null) {
   el.scrollTop = el.scrollHeight - keepOffset.current;
   keepOffset.current = null;
  }
 });
 // 切会话即读底（并重置贴底状态）：新会话消息先落位再滚到底（双 rAF 等首帧绘制完成）
 useEffect(() => {
  stick.current = true;
  lastH.current = 0;
  const raf = requestAnimationFrame(() => {
   requestAnimationFrame(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
   });
  });
  return () => cancelAnimationFrame(raf);
 }, [activeSessionId]);
 // 跟随时机（V37）：`events` 引用变化 = 本会话消息流有更新——流式文本原位追加、新消息追加、
 // 指示行出现 / 消失都算（此前缺的就是第一类）。useLayoutEffect 在 DOM 更新后、paint 前补滚动，
 // 不会出现「先画在屏外、再跳一下」的闪动；用户上翻（stick 为假）时不抢滚动。
 useLayoutEffect(() => {
  followBottom();
 }, [events, working, followBottom]);
 if (projects.length === 0) return <ChatEmptyState kind="no-project" />;
 if (!activeSessionId || (events.length === 0 && !working)) {
  return <ChatEmptyState kind="no-session" hasSession={!!activeSessionId} />;
 }
 return (
  <>
   <div
    ref={scroller}
    onScroll={(e) => {
     // 滚动即关浮条：位置是 mouseup 那一刻算的，滚走了就贴不住选区
     setSel(null);
     const el = e.currentTarget;
     // 粘性判定（V37）：距底 < 80px 视为「还在底部」（程序化滚动也会走到这里，
     // 滚回底部附近自动恢复跟随）；上翻更远即释放，流式输出不再把视口拽下去。
     stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
     // 滚到接近顶部时自动再放一页出来（配合下面的按钮，长会话不必手动点）
     if (hidden > 0 && el.scrollTop < 24) loadEarlier();
    }}
    onMouseUp={onMouseUp}
    className="thread-scroll mx-auto w-full max-w-(--measure-content) min-h-0 flex-1 px-5 py-5"
    role="log"
    aria-label={t.threadAria}
   >
    <div ref={attachContent}>
     {hidden > 0 && (
      <div className="mb-4 flex justify-center">
       <button
        onClick={loadEarlier}
        className="cursor-pointer rounded-md border border-border px-3 py-1 text-[13px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
        aria-label={fmt(t.loadEarlierAria, Math.min(hidden, THREAD_PAGE))}
       >
        {fmt(t.loadEarlier, Math.min(hidden, THREAD_PAGE), hidden)}
       </button>
      </div>
     )}
     {layout.map((item, i) => {
      if (item.kind === "run") {
       // 聚合折叠行（v2）：命令批 / 编辑卡——展开仍是逐条 ToolRow
       return <ToolRunRow key={item.id} group={item.group} items={item.items} cwd={cwd} />;
      }
      if (item.kind === "turn") {
       // 轮时长行（v2）：收在该轮内容之后
       return <TurnRow key={item.id} span={item.span} />;
      }
      const prev = layout[i - 1];
      const prevMsg = prev?.kind === "msg" ? prev.m : undefined;
      return (
       <ThreadRow
        key={item.m.id}
        m={item.m}
        sessionId={activeSessionId}
        cwd={cwd}
        tight={isTrace(item.m) && isTrace(prevMsg)}
        nth={nthById.get(item.m.id) ?? 0}
        frozen={frozen}
        frozenTitle={frozenTitle}
       />
      );
     })}
     {workingVisible && <WorkingRow tight={isTrace(shown[shown.length - 1])} />}
    </div>
   </div>
   {sel && (
    // 浮条：fixed 定位（消息列布局一点都不受它影响），mousedown 不夺选区
    <div
     ref={selBar}
     onMouseDown={(e) => e.preventDefault()}
     style={{ left: sel.left, top: sel.top }}
     className="fixed z-50 flex -translate-x-1/2 -translate-y-full items-center gap-0.5 rounded-md border border-border bg-elevated p-0.5 shadow-pop"
    >
     <button
      onClick={quoteSelection}
      className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      aria-label={t.selQuote}
      title={t.selQuote}
     >
      {t.selQuote}
     </button>
     <button
      onClick={askSelection}
      className="cursor-pointer rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
      aria-label={t.selAsk}
      title={t.selAsk}
     >
      {t.selAsk}
     </button>
    </div>
   )}
  </>
 );
}

/**
 * 流尾是否已经有「正在输出」的行：流式文本 / 未完成的思考 / 正在跑（含参数流式）的工具卡。
 * 有的话界面本身就在动（打字机 / 转圈），不必再补指示行；没有才是「发送后没反应」的窗口——
 * 模型在思考、或刚交完工具结果在等下一步。
 */
const hasLiveTail = (m: ViewMsg | undefined): boolean =>
 !!m &&
 ((m.kind === "text" && !m.complete) ||
  (m.kind === "thinking" && !m.complete) ||
  (m.kind === "tool" && (m.state === "running" || m.state === "streaming")));

/**
 * 「持续成立才露面」的布尔：条件成立后延迟 `delayMs` 才转为真，中途失效立即回落。
 * 服务流式指示行防闪（V46）：段与段之间的一两帧空窗不该让「思考中…」闪一下。
 *
 * 状态翻转在**渲染期**同步重置（React 的「props 变化时派生调整」模式），effect 里只在
 * 定时器到点时 setState——不直接在 effect 体内 setState（react-hooks/set-state-in-effect）。
 */
function useDelayedFlag(active: boolean, delayMs: number): boolean {
 const [state, setState] = useState({ active: false, shown: false });
 if (state.active !== active) setState({ active, shown: false });
 useEffect(() => {
  if (!active) return;
  const timer = window.setTimeout(() => setState({ active: true, shown: true }), delayMs);
  return () => window.clearTimeout(timer);
 }, [active, delayMs]);
 return active && state.shown;
}

/**
 * 流式「思考中…」指示行（纯派生，不写 store）。
 * 视觉与流式思考块同源（呼吸灯泡 + muted 文字）：都是「模型在思考」，读法一致。
 */
function WorkingRow({ tight }: { tight?: boolean }) {
 const t = useText();
 // 走字（V38）：这一段等待已经持续了多久——静止的一行读不出「还在跑」。
 const secs = useElapsedSeconds(true);
 return (
  <div className={`flex items-center gap-1.5 px-1.5 py-[3px] text-[13px] text-muted ${tight ? "mb-1" : "mb-4"}`}>
   <Bulb size={13} aria-hidden className="shrink-0 animate-pulse text-accent" />
   {t.thinking}
   {secs > 0 && (
    <span className="font-mono text-[11px] text-faint" aria-hidden>
     {formatElapsed(secs)}
    </span>
   )}
  </div>
 );
}

/**
 * 思考块（V38 重写）：流式中**自动展开**并实时显示思考文本（读者能看着它长、还有走字秒数），
 * 完成后自动折叠成一行「思考 · N 秒」；用户手动拨过开合就尊重用户的选择（touched）。
 * 走字秒数从挂载起算（历史块 complete 恒 true、不会走字）；完成后用 omp 的真实秒数
 * （`thinking_end` 帧携带），历史里没有秒数的块退化为「已思考」而不是假的「0 秒」。
 */
function ThinkingBlock({ m }: { m: Extract<ViewMsg, { kind: "thinking" }> }) {
 const t = useText();
 const [open, setOpen] = useState(() => !m.complete);
 const touched = useRef(false);
 const shown = useRevealedText(m.text, m.complete);
 const secs = useElapsedSeconds(!m.complete);
 const box = useRef<HTMLDivElement>(null);
 useEffect(() => {
  if (m.complete && !touched.current) setOpen(false);
 }, [m.complete]);
 // 流式中内部滚动跟随（思考可以长过 max-h-80；不跟就看着它停住）
 useLayoutEffect(() => {
  const el = box.current;
  if (el && !m.complete) el.scrollTop = el.scrollHeight;
 }, [shown, m.complete]);
 const label = m.complete
  ? m.seconds > 0
   ? fmt(t.thoughtDone, m.seconds)
   : t.thoughtDoneNoSeconds
  : secs > 0
   ? fmt(t.thinkingWithSeconds, secs)
   : t.thinking;
 return (
  <details
   className="group/think"
   open={open}
   onToggle={(e) => setOpen(e.currentTarget.open)}
  >
   <summary
    onClick={() => {
     // 用户拨动过开合 → 完成后不再自动折叠（原生 toggle 语义保持不变）
     touched.current = true;
    }}
    className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-[3px] text-[13px] text-muted transition-colors duration-100 hover:bg-hover"
   >
    {/* 思考中：灯泡走 accent 并跟着呼吸；已完成的思考退回静止的 faint（不抢正文） */}
    <Bulb
     size={13}
     className={`shrink-0 ${m.complete ? "text-faint" : "animate-pulse text-accent"}`}
     aria-hidden
    />
    {label}
    <ChevronRight
     size={12}
     aria-hidden
     className="shrink-0 transition-transform duration-150 group-open/think:rotate-90"
    />
   </summary>
   <div
    ref={box}
    className="mt-0.5 mb-1 ml-6 max-h-80 overflow-auto border-l border-border-soft pr-1 pl-3 text-[13px] leading-6 whitespace-pre-wrap text-muted"
   >
    {shown}
   </div>
  </details>
 );
}

/**
 * 「执行痕迹」类消息（工具调用 / 思考）：它们在流里成串出现，行与行之间收紧间距
 * （`mb-4` → 无），读起来是一段紧凑的时间线；正文段落才用整档间距隔开。
 */
const isTrace = (m: ViewMsg | undefined): boolean =>
 !!m && (m.kind === "tool" || m.kind === "thinking");

/**
 * 单条消息行（V2 M8）。
 *
 * 为什么必须 memo：流式输出每个 delta 都会更新 store，整列如果跟着重渲染，
 * 展开到几百上千条时每次 token 都要重算所有 Markdown / 工具卡。
 * `mergeViewMsgs` 只替换发生变化的那条消息、其余保持**同一对象引用**，
 * 所以浅比较即能让"只有正在流式的那一行"重渲染。
 */
const ThreadRow = memo(function ThreadRow({
 m,
 sessionId,
 cwd,
 tight,
 nth,
 frozen,
 frozenTitle,
}: {
 m: ViewMsg;
 sessionId: string | null;
 cwd: string;
 /** 上一条也是执行痕迹：间距收紧，成串的工具行读成一段。 */
 tight?: boolean;
 /** 该消息在「同类同文本」里的出现序号（分叉定位用，见 `nthOfText`）。 */
 nth: number;
 /** 运行中 / 待审批 / 已归档：分叉类动作冻结（zcode 只在稳定完成后才允许）。 */
 frozen: boolean;
 frozenTitle: string;
}) {
 const t = useText();
 return (
  // `data-msg-id`：会话内查找（⌘F）靠它把命中定位回消息行（另一并行任务消费）
  <div className={`text-sm leading-[1.7] ${tight ? "mb-1" : "mb-4"}`} data-msg-id={m.id}>
   {m.kind === "user" && (
    <div className="group/user ml-auto w-fit max-w-[72%]">
     {/* 用户气泡走 `--hover` 级中性填充（MASTER §4.4：右侧窄灰泡、圆角 lg）：一句「这是我说的」
         靠填充与右对齐就够；助手正文保持裸 Markdown 无底色，两者一眼分得开 */}
     <div className="rounded-lg rounded-br-sm bg-hover px-3.5 py-2">
      {m.text && <div className="whitespace-pre-wrap">{m.text}</div>}
      {(m.images?.length ?? 0) > 0 && (
       <div className={`flex flex-wrap gap-2 ${m.text ? "mt-2" : ""}`}>
        {m.images?.map((img, i) => (
         <img
          key={i}
          src={`data:${img.mimeType};base64,${img.data}`}
          alt={fmt(t.imageAlt, i + 1)}
          className="max-h-64 max-w-[240px] rounded-lg border border-border object-contain"
         />
        ))}
       </div>
      )}
      {(m.imagesOmitted ?? 0) > 0 && (
       <div className="mt-1.5 text-[11px] text-faint">{fmt(t.imagesOmitted, m.imagesOmitted ?? 0)}</div>
      )}
     </div>
     {m.text.trim() && (
      <div className="mt-0.5 flex justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-hover/user:opacity-100 focus-within:opacity-100">
       <ForkAction
        sessionId={sessionId}
        role="user"
        text={m.text}
        nth={nth}
        mode="edit"
        label={t.msgEditAria}
        disabled={frozen}
        disabledTitle={frozenTitle}
       />
       <CopyAction text={m.text} label={t.copyQuestion} />
      </div>
     )}
    </div>
   )}
   {m.kind === "text" && (
    <div className="group/msg">
     <AssistantText text={m.text} complete={m.complete} />
     {m.complete && m.text.trim() && (
      <div className="mt-0.5 flex gap-0.5 opacity-0 transition-opacity duration-150 group-hover/msg:opacity-100 focus-within:opacity-100">
       <ForkAction
        sessionId={sessionId}
        role="assistant"
        text={m.text}
        nth={nth}
        mode="branch"
        label={t.msgBranchAria}
        disabled={frozen}
        disabledTitle={frozenTitle}
       />
       <CopyAction text={m.text} label={t.copyReply} />
      </div>
     )}
    </div>
   )}
   {m.kind === "thinking" && <ThinkingBlock m={m} />}
   {m.kind === "tool" && <ToolRow m={m} cwd={cwd} />}
   {m.kind === "plan" && <PlanCard m={m} />}
   {m.kind === "approval" && sessionId && <ApprovalCard m={m} sessionId={sessionId} />}
   {m.kind === "ui" && sessionId && <UiRequestCard m={m} sessionId={sessionId} />}
   {m.kind === "files" && <MentionChips m={m} cwd={cwd} />}
   {m.kind === "ui-cancel" && null}
   {m.kind === "command" && (
    // 本地命令（`/` 开头）的输出：左侧 accent 竖条 + 正文色——它是用户主动要的结果，
    // 不是模型的解释，所以不给 muted（那会读起来像备注）
    <div className="rounded-md border-l-2 border-accent/40 bg-code px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
     {m.output}
    </div>
   )}
   {m.kind === "divider" && (m.divider === "subagent" ? (
    // 子代理行（v2 §2.1）：`创建 / 完成 子代理 X` 紧凑行（图标 + 文本），不画分隔线
    <div className="flex items-center gap-1.5 px-1.5 py-[3px] text-[12px] text-muted" role="status">
     <Sparkles size={12} className="shrink-0 text-accent" aria-hidden />
     <span className="min-w-0 truncate">{m.text}</span>
    </div>
   ) : (
    <div className="flex items-center gap-3 py-1">
     <span className="h-px flex-1 bg-border-soft" aria-hidden />
     <span className="text-[11px] text-faint">{m.text}</span>
     <span className="h-px flex-1 bg-border-soft" aria-hidden />
    </div>
   ))}
  </div>
 );
});

/**
 * 任务计划卡（只读）：`todoPhases` / `todo_reminder` 的阶段清单展示。
 * 状态「文字 + 颜色 + 符号」三信号（进行中 / 待办 / 完成），颜色不作唯一信号。
 */
function PlanCard({ m }: { m: Extract<ViewMsg, { kind: "plan" }> }) {
 const t = useText();
 /** 状态符号的颜色：完成 ok / 进行中 accent / 待办 faint（与状态词、符号形状并行）。 */
 const tone = (status: string) =>
  status === "completed" ? "text-ok" : status === "in_progress" ? "text-accent" : "text-faint";
 return (
  <div
   className="rounded-lg border border-border bg-surface px-3 py-2"
   role="group"
   aria-label={t.planTitle}
  >
   <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium text-muted">
    <CheckListSquare size={13} className="shrink-0 text-accent" aria-hidden />
    {t.planTitle}
   </div>
   <div className="space-y-1.5">
    {m.phases.map((p) => (
     <div key={p.id}>
      <div className="text-[13px] font-medium">{p.name}</div>
      <ul className="mt-0.5 space-y-0.5">
       {p.tasks.map((task) => (
        <li key={task.id} className="flex items-start gap-1.5 text-[13px] text-muted">
         <span aria-hidden className={tone(task.status)}>
          {task.status === "completed" ? "✓" : task.status === "in_progress" ? "◐" : "○"}
         </span>
         <span className={task.status === "in_progress" ? "text-foreground" : undefined}>
          {task.content}
          <span className="sr-only">
           {task.status === "completed"
            ? t.planDone
            : task.status === "in_progress"
             ? t.planInProgress
             : t.planTodo}
          </span>
         </span>
        </li>
       ))}
      </ul>
     </div>
    ))}
   </div>
  </div>
 );
}

/**
 * 「编辑并重发」/「分叉」按钮（V40）：hover 才出现，视觉与复制按钮同款。
 * 定位靠 role + 文本 + 同类同文本的第 `nth` 次出现（后端在转录里据此找）；`edit` 把原文本
 * 回填成新会话草稿（改完再发），`branch` 直接开新会话。
 * 运行中 / 待审批 / 已归档时禁用：分叉要读落盘后稳定的转录（zcode 同口径）。
 * 失败不弹窗——落一条本地命令行到消息流尾，与 `/` 命令的回执同一读法。
 */
function ForkAction({
 sessionId,
 role,
 text,
 nth,
 mode,
 label,
 disabled,
 disabledTitle,
}: {
 sessionId: string | null;
 role: "user" | "assistant";
 text: string;
 nth: number;
 mode: "branch" | "edit";
 label: string;
 disabled: boolean;
 disabledTitle: string;
}) {
 const t = useText();
 const [busy, setBusy] = useState(false);
 const run = async () => {
  if (!sessionId || busy) return;
  setBusy(true);
  try {
   const view = await api.forkFromMessage(sessionId, role, text, nth, mode);
   if (mode === "edit") await openForkedSession(view, { draft: text });
   else await openForkedSession(view);
  } catch (e) {
   const raw = e instanceof Error ? e.message : String(e);
   // 后端的定位失败用中文说明原因，前端映射成完整句子（其余错误带上原文）
   const line = raw.includes("第一条消息")
    ? t.msgForkNoPrev
    : raw.includes("没有定位到")
     ? t.msgForkNotFound
     : fmt(t.msgForkFailed, raw);
   useApp.getState().appendEvents(sessionId, [{ kind: "command", id: "lc-" + Date.now(), output: line }]);
  } finally {
   setBusy(false);
  }
 };
 return (
  <button
   onClick={() => void run()}
   disabled={disabled || busy}
   className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted"
   aria-label={label}
   title={disabled ? disabledTitle : label}
  >
   {busy ? (
    <Loader size={11} aria-hidden className="animate-spin" />
   ) : mode === "edit" ? (
    <PenLine size={11} aria-hidden />
   ) : (
    <BranchUp size={11} aria-hidden />
   )}
   {label}
  </button>
 );
}

/**
 * 单条消息的复制按钮（V2 M9）：hover 才出现，纯剪贴板、不碰 store/草稿。
 * 独立组件 + 自带 copied 状态，避免把状态提到 `ThreadRow` 里破坏行级 memo。
 */
function CopyAction({ text, label }: { text: string; label: string }) {
 const t = useText();
 const [copied, setCopied] = useState(false);
 const copy = async () => {
  try {
   await navigator.clipboard.writeText(text);
   setCopied(true);
  } catch {
   // 复制失败不打断阅读（与代码块复制同一策略）
   setCopied(false);
  }
  setTimeout(() => setCopied(false), 1200);
 };
 return (
  <button
   onClick={() => void copy()}
   className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] text-muted transition-colors duration-100 hover:bg-hover hover:text-foreground"
   aria-label={label}
   title={label}
  >
   {copied ? <Check size={11} aria-hidden /> : <Copy size={11} aria-hidden />}
   {copied ? t.copied : t.copy}
  </button>
 );
}

export function SessionActions() {
 const { activeSessionId } = useApp();
 const t = useText();
 if (!activeSessionId) return null;
 return (
  <button
   onClick={() => activeSessionId && api.stop(activeSessionId).catch(() => undefined)}
   className="cursor-pointer text-[13px] text-muted hover:text-foreground"
   aria-label={t.stop}
  >
   {t.stop}
  </button>
 );
}
