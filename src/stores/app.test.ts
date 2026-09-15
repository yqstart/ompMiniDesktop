// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { CheckoutView, ProjectView, TerminalView, WorkspaceView } from "@shared/types";
import { useApp } from "./app";

const term = (id: string, cwd: string, status: TerminalView["status"] = "running"): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status, exitCode: null, resume: null, collab: [], spawnSeq: 0, createdAt: 0 });

/** 播种「已打开若干终端」的局面（store 是模块单例，每个用例从显式状态开始）。 */
function seed(terminals: TerminalView[], activeTerminalId: string, path: string): void {
 useApp.setState({
  terminals,
  activeTerminalId,
  selection: { kind: "checkout", path },
  settingsTabOpen: false,
  settingsTabActive: false,
  closingTerminalId: null,
 });
}

/** w1 = 项目 a + b 的多项目工作区（各自一个主目录）。 */
const GROUP: WorkspaceView = { id: "w1", name: "全栈", createdAt: 1, projectIds: ["a", "b"] };
const PROJECTS: ProjectView[] = [
 { id: "a", path: "/a", name: "A", missing: false, sessionCount: 0, workspaceId: "w1" },
 { id: "b", path: "/b", name: "B", missing: false, sessionCount: 0, workspaceId: "w1" },
];
const CHECKOUTS: CheckoutView[] = [
 { projectId: "a", projectName: "A", path: "/a", branch: "main", head: null, isMain: true, missing: false },
 { projectId: "b", projectName: "B", path: "/b", branch: "main", head: null, isMain: true, missing: false },
];

function seedGroup(terminals: TerminalView[], activeTerminalId: string | null): void {
 useApp.setState({
  terminals,
  activeTerminalId,
  selection: { kind: "group", id: "w1" },
  workspaceGroups: [GROUP],
  projects: PROJECTS,
  checkouts: CHECKOUTS,
  settingsTabOpen: false,
  settingsTabActive: false,
  closingTerminalId: null,
 });
}

describe("关闭终端后的激活项收敛（右栏只显示当前范围的终端）", () => {
 it("关掉某范围的最后一个终端：回到空态，选中项留在该范围", () => {
  seed([term("a1", "/a/login"), term("b1", "/a/main")], "a1", "/a/login");
  useApp.getState().closeTerminal("a1");
  expect(useApp.getState().activeTerminalId).toBeNull();
  expect(useApp.getState().selection).toEqual({ kind: "checkout", path: "/a/login" });
 });

 it("关掉列表末尾的终端：退回同范围的左邻，不跳到别的分支", () => {
  seed([term("a1", "/a/login"), term("b1", "/a/main"), term("a2", "/a/login")], "a2", "/a/login");
  useApp.getState().closeTerminal("a2");
  expect(useApp.getState().activeTerminalId).toBe("a1");
  expect(useApp.getState().selection).toEqual({ kind: "checkout", path: "/a/login" });
 });
});

describe("工作区视图的终端操作（V21）", () => {
 it("组视图里开终端保持组视图（范围不缩窄，组内别的终端不消失）", () => {
  seedGroup([term("b1", "/b")], "b1");
  useApp.getState().openTerminal({ projectId: "a", cwd: "/a", label: "A" });
  expect(useApp.getState().selection).toEqual({ kind: "group", id: "w1" });
  expect(useApp.getState().terminals.length).toBe(2);
 });

 it("点组内终端只切激活、不缩窄视图；聚焦范围外终端才切到它的目录视图", () => {
  seedGroup([term("a1", "/a"), term("b1", "/b")], "a1");
  useApp.getState().focusTerminal("b1");
  expect(useApp.getState().selection).toEqual({ kind: "group", id: "w1" });
  useApp.getState().focusTerminal("a1");
  expect(useApp.getState().selection).toEqual({ kind: "group", id: "w1" });

  seed([term("a1", "/a"), term("b1", "/b")], "a1", "/a");
  useApp.getState().focusTerminal("b1");
  expect(useApp.getState().selection).toEqual({ kind: "checkout", path: "/b" });
 });

 it("选中工作区时激活终端收敛到范围内最近一个", () => {
  useApp.setState({
   terminals: [term("a1", "/a"), term("b1", "/b")],
   activeTerminalId: null,
   selection: { kind: "checkout", path: "/nowhere" },
   workspaceGroups: [GROUP],
   projects: PROJECTS,
   checkouts: CHECKOUTS,
  });
  useApp.getState().selectGroup("w1");
  expect(useApp.getState().selection).toEqual({ kind: "group", id: "w1" });
  expect(useApp.getState().activeTerminalId).toBe("b1");
 });
});

describe("OSC 标题 → 会话标题（omp 的回退名要认出来，别当会话标题）", () => {
 it("会话标题落 store；cwd 末段目录名（omp 还没有标题时的回退值）落 null", () => {
  seed([term("a1", "/w/ompMiniDesktop")], "a1", "/w/ompMiniDesktop");
  useApp.getState().setTerminalTitle("a1", "π > ompMiniDesktop");
  expect(useApp.getState().terminals[0].title).toBeNull();
  useApp.getState().setTerminalTitle("a1", "π > 修登录 bug");
  expect(useApp.getState().terminals[0].title).toBe("修登录 bug");
  expect(useApp.getState().terminals[0].state).toBe("ready");
  // 会话回到无标题（回退名再次到达）：旧标题必须清掉，不能继续冒充会话标题
  useApp.getState().setTerminalTitle("a1", "π > ompMiniDesktop");
  expect(useApp.getState().terminals[0].title).toBeNull();
 });

 it("标题帧没带名字（`π ⠋`）时保留上一次的会话标题，只更新状态", () => {
  seed([term("a1", "/w/app")], "a1", "/w/app");
  useApp.getState().setTerminalTitle("a1", "π > 老标题");
  useApp.getState().setTerminalTitle("a1", "π ⠋");
  expect(useApp.getState().terminals[0].title).toBe("老标题");
  expect(useApp.getState().terminals[0].state).toBe("working");
 });

 it("重启终端清掉旧会话标题（新进程可能不是同一个会话）", () => {
  seed([term("a1", "/w/app")], "a1", "/w/app");
  useApp.getState().setTerminalTitle("a1", "π > 老标题");
  useApp.getState().restartTerminal("a1");
  expect(useApp.getState().terminals[0].title).toBeNull();
 });
});

describe("协作根写回（V21）", () => {
 it("写回实际挂上的协作根；值不变时不产生新数组（避免多余渲染）", () => {
  seed([term("a1", "/w/app")], "a1", "/w/app");
  useApp.getState().setTerminalCollab("a1", ["/b", "/c"]);
  expect(useApp.getState().terminals[0].collab).toEqual(["/b", "/c"]);
  const before = useApp.getState().terminals;
  useApp.getState().setTerminalCollab("a1", ["/b", "/c"]);
  expect(useApp.getState().terminals).toBe(before);
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
