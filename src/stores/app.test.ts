// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TerminalView } from "@shared/types";
import { useApp } from "./app";

const term = (id: string, cwd: string, status: TerminalView["status"] = "running"): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status, exitCode: null, resume: null, spawnSeq: 0, createdAt: 0 });

/** 播种「已打开若干终端」的局面（store 是模块单例，每个用例从显式状态开始）。 */
function seed(terminals: TerminalView[], activeTerminalId: string, activeWorkspacePath: string): void {
 useApp.setState({
  terminals,
  activeTerminalId,
  activeWorkspacePath,
  settingsTabOpen: false,
  settingsTabActive: false,
  closingTerminalId: null,
 });
}

describe("关闭终端后的激活项收敛（右栏只显示当前工作区的终端）", () => {
 it("关掉某工作区的最后一个终端：回到空态，选中项留在该工作区", () => {
  seed([term("a1", "/a/login"), term("b1", "/a/main")], "a1", "/a/login");
  useApp.getState().closeTerminal("a1");
  expect(useApp.getState().activeTerminalId).toBeNull();
  expect(useApp.getState().activeWorkspacePath).toBe("/a/login");
 });

 it("关掉列表末尾的终端：退回同工作区的左邻，不跳到别的分支", () => {
  seed([term("a1", "/a/login"), term("b1", "/a/main"), term("a2", "/a/login")], "a2", "/a/login");
  useApp.getState().closeTerminal("a2");
  expect(useApp.getState().activeTerminalId).toBe("a1");
  expect(useApp.getState().activeWorkspacePath).toBe("/a/login");
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
