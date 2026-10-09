import { api } from "@shared/api";
import type { SessionView } from "@shared/types";
import { useApp } from "../stores/app";
import { fmt, TEXT } from "./locale";
import { viewMsgsFromJsonlLines } from "./viewmsg";
import { syncSessionRuntime } from "./useSessionEvents";

/**
 * 打开会话时调用方**手上已有的列表行**（左栏扫描行 / 归档行 / store 行 / 新建结果）：
 * `openSessionWithHistory` 先把它的 id / 项目 / 目录 / 标题落进 store，再等 `open_session` 收敛。
 * 只拿 id 打开是不够的——见 `openSessionWithHistory` 的说明。缺的字段按 `hintRow` 的默认值补。
 */
export type SessionHint = Pick<SessionView, "id" | "projectId" | "title" | "cwd"> & Partial<SessionView>;

/** 列表行 → store 行：缺的字段给安全默认值（时间用当下、`running` 视为「正要跑」），
 *  open 返回后由真值字段收敛（`running` / `archived` / 项目 / 目录）。 */
function hintRow(h: SessionHint): SessionView {
 return {
  id: h.id,
  projectId: h.projectId,
  title: h.title,
  cwd: h.cwd,
  timestamp: h.timestamp ?? Date.now(),
  archived: h.archived ?? false,
  corrupt: h.corrupt ?? false,
  note: h.note ?? null,
  running: h.running ?? true,
 };
}

/**
 * 消息流回底（Thread 的 `role="log"` 容器）：双 rAF 等首帧绘制完成再读底，
 * 否则新挂载的消息还没量出高度，scrollHeight 还是旧的。
 */
function scrollThreadToBottom() {
 requestAnimationFrame(() => {
  requestAnimationFrame(() => {
   const el = document.querySelector('[role="log"]');
   if (el) el.scrollTop = el.scrollHeight;
  });
 });
}

/**
 * 在某目录下新建聊天会话（目录行 / 会话弹窗的「新建」与空态共用）。
 *
 * 后端 `create_session` 已按该目录起长驻 RPC 并用 `get_state` 回填 sessionId；
 * 这里只负责把新会话补进 store、选中并拉一次历史（新会话为空，等于就绪态）。
 * 失败不抛：返回结果由调用方决定提示位置（左栏内联错误条 / 空态内联错误）。
 */
export async function createChatIn(
 cwd: string,
 opts: { projectName?: string } = {},
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
 try {
  const created = await api.createSession(cwd);
  const st = useApp.getState();
  const known = st.sessions.some((s) => s.id === created.id);
  st.set({
   ...(known ? {} : { sessions: [created, ...st.sessions] }),
   activeSessionId: created.id,
   statusBySession: { ...st.statusBySession, [created.id]: { state: "idle" } },
   sidebarOpen: false,
  });
  await openSessionWithHistory(created.id, created);
  return { ok: true, id: created.id };
 } catch (e) {
  const t = TEXT[useApp.getState().locale];
  const reason = e instanceof Error ? e.message : null;
  const message = opts.projectName
   ? reason
    ? fmt(t.createChatFailedIn, opts.projectName, reason)
    : fmt(t.createChatFailedInShort, opts.projectName)
   : reason
    ? fmt(t.createChatFailed, reason)
    : t.createChatFailedShort;
  return { ok: false, message };
 }
}
/**
 * 重读一个会话的视图（备注改名后用）：`open_session` 对已运行的会话只读回视图、不重复 spawn。
 * 失败保留旧行（标题暂时旧着，不打断编辑动作）。
 */
export async function refreshSessionView(id: string): Promise<void> {
 try {
  const view = await api.openSession(id);
  const cur = useApp.getState();
  const known = cur.sessions.some((s) => s.id === view.id);
  cur.set({
   sessions: known ? cur.sessions.map((s) => (s.id === view.id ? view : s)) : [view, ...cur.sessions],
  });
 } catch {
  // 刷新失败保留旧行
 }
}

/**
 * 首条用户消息的本地标题回退（rpc-ui 不生成 `title_change`，见 `useSessionEvents` 的同名分支）：
 * 取首条文本的前 12 个字符（去空白折行），只写 `store.sessions` 的显示字段、不写盘不写备注。
 * omp 侧标题一旦到位（`title_change` 实时帧 / 下次 `refreshSessionView`），以真值为准覆盖它。
 */
export function fallbackTitleFromText(text: string): string | null {
 const clean = text.replace(/\s+/g, " ").trim();
 if (!clean) return null;
 return clean.length <= 12 ? clean : `${clean.slice(0, 12)}…`;
}

/** 首条发送后：本地回退先顶上（不闪「未命名」），再回读一次 omp 真值（有标题就覆盖）。 */
export async function refreshTitleAfterFirstSend(id: string, text: string): Promise<void> {
 const cur = useApp.getState().sessions.find((s) => s.id === id);
 // 已有备注 / 已有真标题的不碰：回退只服务「未命名」会话
 if (cur?.note?.trim() || (cur?.title && !cur.title.startsWith("未命名会话") && !cur.title.startsWith("Untitled"))) return;
 const fallback = fallbackTitleFromText(text);
 if (fallback) {
  const st = useApp.getState();
  st.set({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, title: fallback } : s)) });
 }
 // 回读 omp 真值：rpc-ui 实测不产标题时保持回退；TUI 侧改过名时这里会被真值覆盖
 await refreshSessionView(id);
 const latest = useApp.getState().sessions.find((s) => s.id === id);
 if (fallback && latest && (latest.title.startsWith("未命名会话") || latest.title.startsWith("Untitled"))) {
  useApp.getState().set({ sessions: useApp.getState().sessions.map((s) => (s.id === id ? { ...s, title: fallback } : s)) });
 }
}

/**
 * 打开会话的**唯一实现**（会话弹窗 / 目录行 / 空态共用，避免两处漂移）：
 * 选中即读底 → 起/聚焦长驻 RPC → 补拉运行时真值 → 拉历史去重合并 → 再读底。
 *
 * `hint` = 调用方手上的列表行（左栏扫描行 / 归档行 / store 行 / 新建结果），**先落地再等 open**：
 * 上下文条的项目选择器、顶栏标题、消息列的 cwd 都读 `store.sessions`，而没开过的会话
 * `open_session` 要 spawn `omp --mode rpc-ui --resume` 并等握手（实测 1–3 s）、失败时这一行
 * 还会一直缺席——只拿 id 打开就会先显示「未归属 / 未命名会话」（用户实测：「点击已经存在的
 * 会话，输入框上方的项目有时展示不出来」）。hint 先顶上，`open_session` 返回后按真值收敛。
 *
 * 全程不抛错：会话打不开（文件被删 / omp 缺失）时仍允许看旧缓存，
 * 状态胶囊会报 exited / omp 不可用，不由这里弹错。
 */
export async function openSessionWithHistory(id: string, hint?: SessionHint): Promise<void> {
 // 换会话＝换消息流：把「首屏增量」窗口重置回第一页（否则沿用上一个会话的展开量）
 useApp.getState().resetThreadLimit(id);
 // 已知视图先落地（还没有这一行才落）：慢 open 期间项目 / 标题 / cwd 立刻就是对的
 const st0 = useApp.getState();
 if (hint && hint.id === id && !st0.sessions.some((s) => s.id === id)) {
  st0.set({ sessions: [hintRow(hint), ...st0.sessions] });
 }
 useApp.getState().set({ activeSessionId: id, sidebarOpen: false });
 // 切换即读底：新会话消息先落位，Thread 才有可滚内容
 scrollThreadToBottom();
 try {
  const opened = await api.openSession(id);
  const cur = useApp.getState();
  // 已有行（hint / 扫描行 / 之前打开过）只收敛后端说了算的四个字段——标题留给
  // open / title_change / 首条回退那几条既有路径（本地乐观标题不能被「未命名会话」顶掉）；
  // 搜索命中的会话可能落在扫描窗口之外（列表里没有这一行）：把它补进列表。
  const rows = cur.sessions.some((s) => s.id === opened.id)
   ? cur.sessions.map((s) =>
    s.id === opened.id
     ? { ...s, running: opened.running, archived: opened.archived, projectId: opened.projectId, cwd: opened.cwd }
     : s,
   )
   : [opened, ...cur.sessions];
  // 慢 open 期间用户可能已经切到别的会话：行照落，但**别把选中抢回来**（状态同理，
  // 那个会话可能真的在跑，不该被这里的「先按 idle 起手」抹掉）
  const stillActive = cur.activeSessionId === opened.id;
  cur.set({
   ...(stillActive
    ? { activeSessionId: opened.id, statusBySession: { ...cur.statusBySession, [opened.id]: { state: "idle" } } }
    : {}),
   sessions: rows,
  });
  // 运行时真值：**必须等 open 返回之后再补拉**——resume 的长驻进程是在 `open_session`
  // 里 spawn 的，订阅建立时那次补拉必然早于它完成（拉不到），于是模型 / 思考档 /
  // 上下文占用一直空着，直到用户手动切一次模型。这里补拉时进程一定已在。
  await syncSessionRuntime(opened.id);
 } catch {
  // 打不开时保留旧缓存可读，状态胶囊会报 exited / 不可用
 }
 try {
  const page = await api.getHistory(id);
  const cur = useApp.getState();
  // 同一会话重复打开不叠历史：tool 卡按 toolCallId 稳定 id，其余按行 id。
  // 乐观回显的 `u-local-*` 消息：历史里同一文本的 `u:<行id>` 到达时视为同一条，
  // 用历史版本替换本地版（行 id 稳定），不翻倍。
  const cur_list = cur.eventsBySession[id] ?? [];
  const seen = new Set(cur_list.map((m) => m.id));
  const local_by_text = new Map(
   cur_list.filter((m) => m.kind === "user" && m.id.startsWith("u-local-")).map((m) => [m.kind === "user" ? m.text : "", m.id]),
  );
  const fresh = viewMsgsFromJsonlLines(page.lines, TEXT[useApp.getState().locale]).filter((m) => {
   if (seen.has(m.id)) return false;
   if (m.kind === "user" && local_by_text.has(m.text)) {
    const local_id = local_by_text.get(m.text) as string;
    local_by_text.delete(m.text);
    cur.set({
     eventsBySession: {
      ...cur.eventsBySession,
      [id]: (cur.eventsBySession[id] ?? []).map((x) => (x.id === local_id ? m : x)),
     },
    });
    return false;
   }
   return true;
  });
  if (fresh.length > 0) useApp.getState().appendEvents(id, fresh);
  // 回放超限（5000 行 / 2000 条）时在流尾注明——绝不静默丢内容。
  // 固定 id + 先查已有：重复打开同一会话不叠第二条。
  if (page.truncated && !cur_list.some((m) => m.id === "hist-truncated")) {
   useApp.getState().appendEvents(id, [
    {
     kind: "divider",
     id: "hist-truncated",
     divider: "turn",
     text: TEXT[useApp.getState().locale].historyTruncated,
    },
   ]);
  }
  // 历史落位后再读一次底，保证停在最新处（慢历史期间用户已切走就别拽别人的消息列）
  if (useApp.getState().activeSessionId === id) scrollThreadToBottom();
 } catch {
  // 历史加载失败不阻塞选中
 }
}
