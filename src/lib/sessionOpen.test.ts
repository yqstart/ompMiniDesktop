/**
 * 打开会话的**全链路回归**（mock IPC，不依赖 Tauri）：
 * `openSessionWithHistory` 把 get_history 的行落库为消息流、重复打开不叠、
 * 回放超限时在流尾落一条注记（且不重复落）。
 *
 * 这条链路此前没有测试覆盖——排查「打开已有会话不显示」问题时它是最先被怀疑的对象。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionView } from "@shared/types";

const SID = "sess-open-1";

/** get_history 的形状（后端已过滤到 message/custom/title 系，包一层 {lines, truncated}）。 */
const HISTORY_LINES = [
 { type: "message", id: "m1", message: { role: "user", content: [{ type: "text", text: "你好" }] } },
 {
  type: "message",
  id: "m2",
  message: {
   role: "assistant",
   content: [
    { type: "text", text: "我来跑一下" },
    { type: "toolCall", id: "tc1", name: "bash", arguments: { command: "ls" }, intent: "列出目录" },
   ],
  },
 },
 { type: "message", id: "m3", message: { role: "toolResult", toolCallId: "tc1", toolName: "bash", content: [{ type: "text", text: "a.txt" }] } },
 { type: "title_change", id: "t1", title: "会话标题" },
];

vi.mock("@shared/api", () => ({
 api: {
  openSession: vi.fn(async (id: string) => ({
   id,
   projectId: "p1",
   title: "t",
   cwd: "/a",
   timestamp: 1,
   archived: false,
   corrupt: false,
   note: null,
   running: true,
  })),
  getSessionRuntime: vi.fn(async () => null),
  getHistory: vi.fn(async () => ({ lines: structuredClone(HISTORY_LINES), truncated: false })),
 },
}));

// node 环境没有 rAF：读底调用不需要真跑
(globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;

import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { fallbackTitleFromText, openSessionWithHistory, refreshTitleAfterFirstSend } from "./sessionOpen";

describe("打开会话：历史落库与去重", () => {
 beforeEach(() => {
  useApp.setState({ eventsBySession: {}, sessions: [], activeSessionId: null });
  vi.mocked(api.getHistory).mockResolvedValue({ lines: structuredClone(HISTORY_LINES), truncated: false });
 });

 it("历史落库（消息与工具痕迹都进流）", async () => {
  await openSessionWithHistory(SID);
  const kinds = (useApp.getState().eventsBySession[SID] ?? []).map((m) => m.kind);
  expect(kinds).toContain("user");
  expect(kinds).toContain("text");
  expect(kinds).toContain("tool");
 });

 it("重复打开同一会话不叠历史", async () => {
  await openSessionWithHistory(SID);
  const n1 = (useApp.getState().eventsBySession[SID] ?? []).length;
  await openSessionWithHistory(SID);
  expect(useApp.getState().eventsBySession[SID] ?? []).toHaveLength(n1);
 });

 it("truncated 时在流尾落一条注记，且重复打开不叠第二条", async () => {
  vi.mocked(api.getHistory).mockResolvedValue({ lines: structuredClone(HISTORY_LINES), truncated: true });
  await openSessionWithHistory(SID);
  expect((useApp.getState().eventsBySession[SID] ?? []).filter((m) => m.id === "hist-truncated")).toHaveLength(1);
  await openSessionWithHistory(SID);
  expect((useApp.getState().eventsBySession[SID] ?? []).filter((m) => m.id === "hist-truncated")).toHaveLength(1);
 });

 describe("已知视图（hint）：先落地再等 open", () => {
  /** 列表行：左栏 / 归档页点在手上的那一行。 */
  const ROW: SessionView = {
   id: SID,
   projectId: "p9",
   title: "列表里的标题",
   cwd: "/w/p9",
   timestamp: 7,
   archived: false,
   corrupt: false,
   note: null,
   running: false,
  };

  it("open 未返回时项目 / 目录 / 标题就已在（上下文条不再先显示「未归属」），返回后按真值收敛", async () => {
   // 项目目标为 ES2021，没有 Promise.withResolvers（同 ModelsPanel.test.tsx 的口径）
   let finish!: (value: SessionView) => void;
   vi.mocked(api.openSession).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
   const pending = openSessionWithHistory(SID, ROW);
   // 慢 open 期间（真实后端要 spawn + 握手 1–3s）：这一行已经在 store 里，项目名立刻可用
   expect(useApp.getState().sessions.find((s) => s.id === SID)).toMatchObject({
    projectId: "p9",
    cwd: "/w/p9",
    title: "列表里的标题",
   });
   finish({ ...ROW, projectId: "p1", cwd: "/a", running: true });
   await pending;
   const after = useApp.getState().sessions.find((s) => s.id === SID);
   // 后端说了算的字段（项目 / 目录 / running）收敛；标题留给 open / title_change / 首条回退那条线
   expect(after).toMatchObject({ projectId: "p1", cwd: "/a", running: true });
   expect(after?.title).toBe("列表里的标题");
  });

  it("慢 open 期间用户已切走：行照落，但不把选中抢回来、不抹掉那个会话的状态", async () => {
   // 项目目标为 ES2021，没有 Promise.withResolvers（同 ModelsPanel.test.tsx 的口径）
   let finish!: (value: SessionView) => void;
   vi.mocked(api.openSession).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
   const pending = openSessionWithHistory(SID, ROW);
   useApp.setState({ activeSessionId: "other", statusBySession: { [SID]: { state: "running" } } });
   finish({ ...ROW, running: true });
   await pending;
   const st = useApp.getState();
   expect(st.activeSessionId).toBe("other");
   expect(st.statusBySession[SID]?.state).toBe("running");
   expect(st.sessions.some((s) => s.id === SID)).toBe(true);
  });
 });

 describe("首条标题回退（rpc-ui 不产标题时的本地显示）", () => {
  it("取首条前 12 字（空白折叠，超长截断加省略号）", () => {
   expect(fallbackTitleFromText("  你好\n世界  ")).toBe("你好 世界");
   expect(fallbackTitleFromText("这是一个很长的需求描述要截断")).toBe("这是一个很长的需求描述要…");
   expect(fallbackTitleFromText("帮我把登录页重构一下")).toBe("帮我把登录页重构一下");
   expect(fallbackTitleFromText("   ")).toBeNull();
  });

  it("未命名会话：回退先顶上，回读无真值时保留回退", async () => {
   useApp.setState({
    sessions: [{ id: SID, projectId: "p1", title: "未命名会话 10-09", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: null, running: true }],
   });
   vi.mocked(api.openSession).mockResolvedValue({ id: SID, projectId: "p1", title: "未命名会话 10-09", archived: false } as never);
   await refreshTitleAfterFirstSend(SID, "帮我把登录页重构一下登录页重构一下");
   expect(useApp.getState().sessions.find((s) => s.id === SID)?.title).toBe("帮我把登录页重构一下登录…");
  });

  it("回读到真值时用真值覆盖回退", async () => {
   useApp.setState({
    sessions: [{ id: SID, projectId: "p1", title: "未命名会话 10-09", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: null, running: true }],
   });
   vi.mocked(api.openSession).mockResolvedValue({ id: SID, projectId: "p1", title: "登录页重构", archived: false } as never);
   await refreshTitleAfterFirstSend(SID, "帮我把登录页重构一下");
   expect(useApp.getState().sessions.find((s) => s.id === SID)?.title).toBe("登录页重构");
  });

  it("有备注 / 已有真标题的不碰", async () => {
   useApp.setState({
    sessions: [{ id: SID, projectId: "p1", title: "我的备注", cwd: "/a", timestamp: 1, archived: false, corrupt: false, note: "我的备注", running: true }],
   });
   vi.mocked(api.openSession).mockClear();
   await refreshTitleAfterFirstSend(SID, "新消息不该改标题");
   expect(useApp.getState().sessions.find((s) => s.id === SID)?.title).toBe("我的备注");
   expect(vi.mocked(api.openSession)).not.toHaveBeenCalled();
  });
 });
});
