// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { TerminalView, WorkspaceView } from "@shared/types";
import { api } from "@shared/api";
import { describeTerminalWorkspace, loadWorkspaces, resolveNewTerminalWorkspace } from "./workspaces";
import { useApp } from "../stores/app";

vi.mock("@shared/api", () => ({
 api: { listWorkspaces: vi.fn(async () => []) },
}));

const base = [
 { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
 { projectId: "a", projectName: "Alpha", path: "/a/login", branch: "login", head: null, isMain: false, missing: false },
 { projectId: "b", projectName: "Beta", path: "/b/main", branch: "main", head: null, isMain: false, missing: true },
];

const term = (id: string, cwd: string): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status: "running", exitCode: null, resume: null, spawnSeq: 0, createdAt: 0 });

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

describe("工作区清单刷新", () => {
 it("选中项失效（项目被移除）时退回第一个可用工作区，激活终端一起收敛到它", async () => {
  const list: WorkspaceView[] = [
   { projectId: "a", projectName: "Alpha", path: "/a/login", branch: "login", head: null, isMain: false, missing: false },
   { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
  ];
  vi.mocked(api.listWorkspaces).mockResolvedValue(list);
  useApp.setState({
   terminals: [term("gone", "/gone"), term("kept", "/a/login")],
   activeTerminalId: "gone",
   activeWorkspacePath: "/gone",
  });
  await loadWorkspaces();
  const s = useApp.getState();
  // 收敛是必须的：右栏按 `activeWorkspacePath` 过滤，留着 /gone 的激活终端会让视图空掉
  expect(s.activeWorkspacePath).toBe("/a/login");
  expect(s.activeTerminalId).toBe("kept");
 });
});
