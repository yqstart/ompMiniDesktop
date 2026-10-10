import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionRuntime, SessionStatus, ViewMsg } from "@shared/types";

vi.mock("@shared/api", () => ({
 api: {
  getSessionRuntime: vi.fn(async () => null),
  setThinking: vi.fn(async () => undefined),
 },
}));

import { api } from "@shared/api";
import { useApp } from "../stores/app";
import { __resetFolds, __resetHistoryLru, forgetSession, syncSessionRuntime, trimSessionHistories } from "./useSessionEvents";

/**
 * V34 内存治理的回归测试：非活跃会话的历史会被清掉（切回时重新 get_history 拉回），
 * 归档 / 删除时整个会话的前端缓存被清掉。防的是「浏览过的会话数据永远挂着」——
 * 每个长会话的全量消息（含工具全量输出）常驻内存，攒起来就是几百 MB 到 GB 级。
 *
 * 时序照真实路径走：打开一个会话（seed 历史）时 trim 一次——所以 seed 与 trim 交错。
 */

const msg = (id: string): ViewMsg => ({ kind: "text", id, seq: 0, text: id, complete: true });

/** 给会话塞一条历史（可选状态）。 */
function seed(sid: string, state?: SessionStatus["state"]) {
 useApp.setState((s) => ({
  eventsBySession: { ...s.eventsBySession, [sid]: [msg(sid)] },
  ...(state ? { statusBySession: { ...s.statusBySession, [sid]: { state } as SessionStatus } } : {}),
 }));
}

/** 模拟「打开一个会话」：先有历史，随后触发一次清理（useSessionEvents 订阅 effect 里的调用）。 */
function open(sid: string, state?: SessionStatus["state"]) {
 seed(sid, state);
 trimSessionHistories(sid);
}

beforeEach(() => {
 __resetHistoryLru();
 __resetFolds();
 useApp.setState({ eventsBySession: {}, statusBySession: {}, plansBySession: {}, attachmentsBySession: {} });
});

describe("trimSessionHistories：非活跃会话的历史只留最近 3 个", () => {
 it("第 4 个会话打开后，最早的历史被清掉", () => {
  open("s1");
  open("s2");
  open("s3");
  expect(Object.keys(useApp.getState().eventsBySession).sort()).toEqual(["s1", "s2", "s3"]);
  open("s4");
  // s1 超出保留窗口 → 被清；其余保留
  expect(Object.keys(useApp.getState().eventsBySession).sort()).toEqual(["s2", "s3", "s4"]);
 });

 it("同一会话反复激活不会重复占位（LRU 去重）", () => {
  open("s1");
  open("s2");
  open("s1");
  open("s3");
  // 最近三次激活 = s3 / s1 / s2 → 都在；没有第 4 个会话可清
  expect(Object.keys(useApp.getState().eventsBySession).sort()).toEqual(["s1", "s2", "s3"]);
 });

 it("正在跑 / 等审批的会话不清（流还在写，用户随时可能切回来看中间态）", () => {
  seed("run", "running");
  seed("wait", "awaiting-approval");
  for (const sid of ["a", "b", "c", "d"]) open(sid);
  const keys = Object.keys(useApp.getState().eventsBySession).sort();
  expect(keys).toEqual(["b", "c", "d", "run", "wait"]);
 });

 it("keepCount=1（切去终端形态）时只留当前会话", () => {
  open("s1");
  open("s2");
  open("s3");
  trimSessionHistories("s1", 1);
  expect(Object.keys(useApp.getState().eventsBySession)).toEqual(["s1"]);
 });
});

describe("forgetSession：归档 / 删除后清掉会话的前端缓存", () => {
 it("事件流 / 状态 / 计划 / 附件四类键一起清", () => {
  open("s1", "idle");
  useApp.setState({
   plansBySession: { s1: [] },
   attachmentsBySession: { s1: [] },
  });
  forgetSession("s1");
  const st = useApp.getState();
  expect("s1" in st.eventsBySession).toBe(false);
  expect("s1" in st.statusBySession).toBe(false);
  expect("s1" in st.plansBySession).toBe(false);
  expect("s1" in st.attachmentsBySession).toBe(false);
 });

 it("不存在的会话是 no-op（不炸、不影响其它会话）", () => {
  open("s2", "idle");
  expect(() => forgetSession("nope")).not.toThrow();
  expect(Object.keys(useApp.getState().eventsBySession)).toEqual(["s2"]);
 });
});

/**
 * 活动态真值回读（`SessionMeta.status`，只在 `get_session_runtime` 里带）：
 * 状态事件是推送，切走期间收不到——切回一个正在跑的会话要靠这次回读把「运行中」补回，
 * 否则胶囊显示成就绪、流式「思考中」指示不出现，输入框还会把下一句当新 prompt 发出去
 * （运行中应当走排队 / 转向，普通 prompt 会打断进行中的轮次）。
 */
describe("运行时回读：活动态真值补回状态表", () => {
 const runtime = (status: SessionRuntime["status"]): SessionRuntime => ({
  model: null,
  efforts: null,
  thinkingLevel: null,
  status,
 });

 it("status 落到 statusBySession（切走期间错过的状态帧靠它补）", async () => {
  useApp.setState({ activeSessionId: "s1", statusBySession: {} });
  vi.mocked(api.getSessionRuntime).mockResolvedValue(runtime("running"));
  await syncSessionRuntime("s1");
  expect(useApp.getState().statusBySession["s1"]?.state).toBe("running");
 });

 it("不在当前会话时回读结果不落（避免切走后被旧会话真值覆盖）", async () => {
  useApp.setState({ activeSessionId: "other", statusBySession: {} });
  vi.mocked(api.getSessionRuntime).mockResolvedValue(runtime("running"));
  await syncSessionRuntime("s1");
  expect("s1" in useApp.getState().statusBySession).toBe(false);
 });

 it("载荷没带 status 时不动状态表（事件推送不背这个字段）", async () => {
  useApp.setState({ activeSessionId: "s1", statusBySession: { s1: { state: "idle" } } });
  vi.mocked(api.getSessionRuntime).mockResolvedValue(runtime(null));
  await syncSessionRuntime("s1");
  expect(useApp.getState().statusBySession["s1"]?.state).toBe("idle");
 });
});
