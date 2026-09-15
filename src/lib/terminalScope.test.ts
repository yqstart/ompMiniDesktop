import { describe, expect, it } from "vitest";
import type { TerminalView } from "@shared/types";
import { countRunningTerminalsIn, countTerminalsIn, terminalsInScope } from "./terminalScope";

const term = (id: string, cwd: string, status: TerminalView["status"] = "running"): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status, exitCode: null, resume: null, collab: [], spawnSeq: 0, createdAt: 0 });

describe("终端范围（右栏按选中范围过滤）", () => {
 it("只列范围集合命中的终端", () => {
  const list = [term("t1", "/a/main"), term("t2", "/a/login"), term("t3", "/a/login")];
  expect(terminalsInScope(list, new Set(["/a/login"])).map((t) => t.id)).toEqual(["t2", "t3"]);
  expect(terminalsInScope(list, new Set(["/a/main", "/b/main"])).map((t) => t.id)).toEqual(["t1"]);
  expect(terminalsInScope(list, new Set(["/b/main"]))).toEqual([]);
 });

 it("没有范围（null）时不过滤：那种局面下终端不能凭空消失", () => {
  const list = [term("t1", "/a/main"), term("t2", "/a/login")];
  expect(terminalsInScope(list, null)).toEqual(list);
 });
});

describe("目录行终端徽章计数", () => {
 it("总数与运行中分开数，别的目录不计入", () => {
  const list = [term("t1", "/a/login"), term("t2", "/a/login", "exited"), term("t3", "/a/main")];
  expect(countTerminalsIn(list, "/a/login")).toBe(2);
  expect(countRunningTerminalsIn(list, "/a/login")).toBe(1);
  expect(countRunningTerminalsIn(list, "/a/main")).toBe(1);
  expect(countTerminalsIn(list, "/nowhere")).toBe(0);
 });
});
