import { describe, expect, it } from "vitest";
import type { TerminalView } from "@shared/types";
import { countRunningTerminalsIn, countTerminalsIn, terminalsInWorkspace } from "./terminalScope";

const term = (id: string, cwd: string, status: TerminalView["status"] = "running"): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status, exitCode: null, resume: null, spawnSeq: 0, createdAt: 0 });

describe("终端范围（右栏按当前工作区过滤）", () => {
 it("只列选中工作区目录下的终端", () => {
  const list = [term("t1", "/a/main"), term("t2", "/a/login"), term("t3", "/a/login")];
  expect(terminalsInWorkspace(list, "/a/login").map((t) => t.id)).toEqual(["t2", "t3"]);
  expect(terminalsInWorkspace(list, "/a/main").map((t) => t.id)).toEqual(["t1"]);
  expect(terminalsInWorkspace(list, "/b/main")).toEqual([]);
 });

 it("没有可用工作区（null）时不过滤：那种局面下终端不能凭空消失", () => {
  const list = [term("t1", "/a/main"), term("t2", "/a/login")];
  expect(terminalsInWorkspace(list, null)).toEqual(list);
 });
});

describe("工作区行终端徽章计数", () => {
 it("总数与运行中分开数，别的目录不计入", () => {
  const list = [term("t1", "/a/login"), term("t2", "/a/login", "exited"), term("t3", "/a/main")];
  expect(countTerminalsIn(list, "/a/login")).toBe(2);
  expect(countRunningTerminalsIn(list, "/a/login")).toBe(1);
  expect(countRunningTerminalsIn(list, "/a/main")).toBe(1);
  expect(countTerminalsIn(list, "/nowhere")).toBe(0);
 });
});
