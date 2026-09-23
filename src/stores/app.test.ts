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
