// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { describeTerminalWorkspace, resolveNewTerminalWorkspace } from "./workspaces";

const base = [
  { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
  { projectId: "a", projectName: "Alpha", path: "/a/login", branch: "login", head: null, isMain: false, missing: false },
  { projectId: "b", projectName: "Beta", path: "/b/main", branch: "main", head: null, isMain: false, missing: true },
];

describe("新建终端目标选择", () => {
  it("优先当前选中，其次主目录，最后第一个可用", () => {
    expect(resolveNewTerminalWorkspace(base, "/a/login")?.path).toBe("/a/login");
    expect(resolveNewTerminalWorkspace(base, "/missing")?.path).toBe("/a/main");
    expect(resolveNewTerminalWorkspace(base.slice(1), null)?.path).toBe("/a/login");
    expect(resolveNewTerminalWorkspace(base.map((w) => ({ ...w, missing: true })), null)).toBeNull();
  });

  it("终端上下文优先工作区名，缺席用路径末段", () => {
    expect(describeTerminalWorkspace("/a/login", base)).toEqual({ primary: "Alpha · login", title: "/a/login" });
    expect(describeTerminalWorkspace("/tmp/ghost", base)).toEqual({ primary: "ghost", title: "/tmp/ghost" });
  });
});
