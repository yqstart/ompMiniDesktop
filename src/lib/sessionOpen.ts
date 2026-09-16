import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { fmt, TEXT } from "./locale";
import { viewMsgsFromJsonlLines } from "./viewmsg";
import { loadSessions } from "./sessionList";
import { syncSessionRuntime } from "./useSessionEvents";

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
 * 在指定项目下新建会话（左栏分组内入口与中央空态共用）。
 *
 * 后端 `create_session` 已按项目目录起长驻 RPC 并用 `get_state` 回填 sessionId；
 * 这里只负责刷新列表 + 选中新会话 + 拉一次历史（新会话为空，等于就绪态）。
 * 失败不抛：返回结果由调用方决定提示位置（左栏内联错误条 / 空态内联错误）。
 */
export async function createSessionIn(
 projectId: string | null,
 opts: { projectName?: string } = {},
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
 if (!projectId) {
  return { ok: false, message: TEXT[useApp.getState().locale].pickProjectFirst };
 }
 try {
  const created = await api.createSession(projectId);
  const [projects] = await Promise.all([api.listProjects().catch(() => null), loadSessions()]);
  const st = useApp.getState();
  st.set({
   ...(projects ? { projects } : {}),
   activeProjectId: projectId,
   activeSessionId: created.id,
   sidebarOpen: false,
  });
  await openSessionWithHistory(created.id);
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
 * 打开会话的**唯一实现**（左栏会话行与输入框上方项目下拉共用，避免两处漂移）：
 * 选中即读底 → 起/聚焦长驻 RPC → 补拉运行时真值 → 拉历史去重合并 → 再读底。
 *
 * 全程不抛错：会话打不开（文件被删 / omp 缺失）时仍允许看旧缓存，
 * 状态胶囊会报 exited / omp 不可用，不由这里弹错。
 */
export async function openSessionWithHistory(id: string): Promise<void> {
 // 换会话＝换消息流：把「首屏增量」窗口重置回第一页（否则沿用上一个会话的展开量）
 useApp.getState().resetThreadLimit(id);
 useApp.getState().set({ activeSessionId: id, sidebarOpen: false });
 // 切换即读底：新会话消息先落位，Thread 才有可滚内容
 scrollThreadToBottom();
 try {
  const opened = await api.openSession(id);
  const cur = useApp.getState();
  // 搜索命中的会话可能落在扫描窗口之外（列表里没有这一行）：把它补进列表，
  // 否则顶栏标题与上下文条会显示成「未命名会话 / 未归属」。
  const known = cur.sessions.some((s) => s.id === opened.id);
  cur.set({
   activeSessionId: opened.id,
   ...(known ? {} : { sessions: [opened, ...cur.sessions] }),
   statusBySession: { ...cur.statusBySession, [opened.id]: { state: "idle" } },
  });
  // 运行时真值：**必须等 open 返回之后再补拉**——resume 的长驻进程是在 `open_session`
  // 里 spawn 的，订阅建立时那次补拉必然早于它完成（拉不到），于是模型 / 思考档 /
  // 上下文占用一直空着，直到用户手动切一次模型。这里补拉时进程一定已在。
  await syncSessionRuntime(opened.id);
 } catch {
  // 打不开时保留旧缓存可读，状态胶囊会报 exited / 不可用
 }
 try {
  const history = await api.getHistory(id);
  const cur = useApp.getState();
  // 同一会话重复打开不叠历史：tool 卡按 toolCallId 稳定 id，其余按行 id。
  // 乐观回显的 `u-local-*` 消息：历史里同一文本的 `u:<行id>` 到达时视为同一条，
  // 用历史版本替换本地版（行 id 稳定），不翻倍。
  const cur_list = cur.eventsBySession[id] ?? [];
  const seen = new Set(cur_list.map((m) => m.id));
  const local_by_text = new Map(
   cur_list.filter((m) => m.kind === "user" && m.id.startsWith("u-local-")).map((m) => [m.kind === "user" ? m.text : "", m.id]),
  );
  const fresh = viewMsgsFromJsonlLines(history, TEXT[useApp.getState().locale]).filter((m) => {
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
  // 历史落位后再读一次底，保证停在最新处
  scrollThreadToBottom();
 } catch {
  // 历史加载失败不阻塞选中
 }
}
