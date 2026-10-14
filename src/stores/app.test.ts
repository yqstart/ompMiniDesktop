// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { useApp } from "./app";

describe("设置视图（v1 起：覆盖主区的独立视图）", () => {
 it("openSettingsTab / closeSettingsTab：开则两态同时置位，关则同时复位", () => {
  useApp.setState({ settingsTabOpen: false, settingsTabActive: false });
  useApp.getState().openSettingsTab();
  expect(useApp.getState().settingsTabOpen).toBe(true);
  expect(useApp.getState().settingsTabActive).toBe(true);
  useApp.getState().closeSettingsTab();
  expect(useApp.getState().settingsTabOpen).toBe(false);
  expect(useApp.getState().settingsTabActive).toBe(false);
 });
});

/**
 * 队列真值（V40）：omp `queue_update` 帧与回读的落点（`applyQueue` 是唯一写入面）；
 * goal 状态（`setGoal`）、会话导航栈（`pushNav` / `navStep`）、挂起重启标记、旁问面板
 * 与查找条开关一并在这里锁住。
 */
describe("队列真值与 V40 聊天域动作", () => {
 it("applyQueue / queuedOf：按会话隔离，缺省空队列", () => {
  useApp.setState({ queuedBySession: {} });
  useApp.getState().applyQueue("s1", { steering: ["a"], followUp: ["b", "c"] });
  useApp.getState().applyQueue("s2", { steering: [], followUp: ["x"] });
  expect(useApp.getState().queuedOf("s1")).toEqual({ steering: ["a"], followUp: ["b", "c"] });
  expect(useApp.getState().queuedOf("s2")).toEqual({ steering: [], followUp: ["x"] });
  expect(useApp.getState().queuedOf("nope")).toEqual({ steering: [], followUp: [] });
  expect(useApp.getState().queuedOf(null)).toEqual({ steering: [], followUp: [] });
 });

 it("setGoal / goalOf：null 也落库（无目标态可区分于未回读）", () => {
  useApp.setState({ goalBySession: {} });
  useApp.getState().setGoal("s1", { id: "g1", objective: "修测试", status: "active", tokensUsed: 3, timeUsedSeconds: 60 });
  expect(useApp.getState().goalOf("s1")?.objective).toBe("修测试");
  useApp.getState().setGoal("s1", null);
  expect(useApp.getState().goalOf("s1")).toBeNull();
  expect(useApp.getState().goalOf("unread")).toBeNull();
 });

 it("pushNav / navStep：去重截断 + 前后一步（边界返回 null）", () => {
  useApp.setState({ navStack: [], navIdx: -1 });
  useApp.getState().pushNav("a");
  useApp.getState().pushNav("b");
  useApp.getState().pushNav("c");
  expect(useApp.getState().navStep(-1)).toBe("b");
  expect(useApp.getState().navStep(-1)).toBe("a");
  expect(useApp.getState().navStep(-1)).toBeNull();
  expect(useApp.getState().navStep(1)).toBe("b");
  // 导航后手动打开已存在的会话：截断到当前位置再压栈（前进历史丢弃）
  useApp.getState().pushNav("d");
  expect(useApp.getState().navStep(1)).toBeNull();
  expect(useApp.getState().navStep(-1)).toBe("b");
 });

 it("markApprovalRestart / clearApprovalRestart：按会话标记与清除", () => {
  useApp.setState({ approvalRestartBySession: {} });
  useApp.getState().markApprovalRestart("s1");
  expect(useApp.getState().approvalRestartBySession["s1"]).toBe(true);
  useApp.getState().clearApprovalRestart("s1");
  expect("s1" in useApp.getState().approvalRestartBySession).toBe(false);
  useApp.getState().clearApprovalRestart("ghost"); // no-op 不崩
 });

 it("setBtw：局部合并更新（open / sessionId / records）", () => {
  useApp.setState({ btw: { open: false, sessionId: null, records: [], busyRecordId: null, draft: "", error: null } });
  useApp.getState().setBtw({ open: true, sessionId: "s1" });
  expect(useApp.getState().btw.open).toBe(true);
  expect(useApp.getState().btw.sessionId).toBe("s1");
  expect(useApp.getState().btw.records).toEqual([]);
 });

 it("setFindOpen / setStatsOpen：开关落 store", () => {
  useApp.getState().setFindOpen(true);
  expect(useApp.getState().findOpen).toBe(true);
  useApp.getState().setFindOpen(false);
  expect(useApp.getState().findOpen).toBe(false);
  useApp.getState().setStatsOpen(true);
  expect(useApp.getState().statsOpen).toBe(true);
  useApp.getState().setStatsOpen(false);
 });
});

/**
 * 任务清单（V50）：`applyPlans` 是 `plansBySession` 的唯一写入面（todo 工具帧
 * `details.phases` + `get_state.todoPhases` 回读），`planCardBySession` 是浮卡 UI 状态。
 */
describe("任务清单：applyPlans / setPlanCard", () => {
 const P1 = [{ name: "阶段一", tasks: [{ content: "甲", status: "in_progress" }] }];

 it("首次写入自动展开；同值重写不换引用", () => {
  useApp.setState({ plansBySession: {}, planCardBySession: {} });
  useApp.getState().applyPlans("s1", P1);
  expect(useApp.getState().plansBySession["s1"]).toEqual(P1);
  expect(useApp.getState().planCardBySession["s1"]).toBe("expanded");
  const before = useApp.getState().plansBySession;
  useApp.getState().applyPlans("s1", P1);
  // 同一个值再写（帧与回读会送两遍）：store 引用不动，不触发重渲
  expect(useApp.getState().plansBySession).toBe(before);
 });

 it("用户收起 / 隐藏后，后续清单更新不覆盖开合状态", () => {
  useApp.setState({ plansBySession: {}, planCardBySession: {} });
  useApp.getState().applyPlans("s1", P1);
  useApp.getState().setPlanCard("s1", "collapsed");
  useApp.getState().applyPlans("s1", [{ name: "阶段一", tasks: [{ content: "甲", status: "completed" }] }]);
  expect(useApp.getState().planCardBySession["s1"]).toBe("collapsed");
 });

 it("空数组 = 清空（数据与浮卡状态一起删；下次计划重新自动展开）", () => {
  useApp.setState({ plansBySession: {}, planCardBySession: {} });
  useApp.getState().applyPlans("s1", P1);
  useApp.getState().applyPlans("s1", []);
  expect("s1" in useApp.getState().plansBySession).toBe(false);
  expect("s1" in useApp.getState().planCardBySession).toBe(false);
  useApp.getState().applyPlans("s1", P1);
  expect(useApp.getState().planCardBySession["s1"]).toBe("expanded");
 });

 it("setPlanCard：同值不写（引用稳定）", () => {
  useApp.setState({ planCardBySession: {} });
  useApp.getState().setPlanCard("s1", "collapsed");
  const cards = useApp.getState().planCardBySession;
  useApp.getState().setPlanCard("s1", "collapsed");
  expect(useApp.getState().planCardBySession).toBe(cards);
 });
});
