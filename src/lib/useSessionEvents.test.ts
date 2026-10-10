import { beforeEach, describe, expect, it } from "vitest";
import type { SessionStatus, ViewMsg } from "@shared/types";
import { useApp } from "../stores/app";
import { __resetFolds, __resetHistoryLru, forgetSession, trimSessionHistories } from "./useSessionEvents";

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
