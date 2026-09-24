// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { CheckoutView, ProjectView, TerminalView } from "@shared/types";
import { api } from "@shared/api";
import { describeTerminalWorkspace, loadCheckouts, resolveNewTerminalCheckout } from "./checkouts";
import { useApp } from "../stores/app";

vi.mock("@shared/api", () => ({
 api: { listCheckouts: vi.fn(async () => []), listWorkspaces: vi.fn(async () => []) },
}));

const base: CheckoutView[] = [
 { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
 { projectId: "a", projectName: "Alpha", path: "/a/login", branch: "login", head: null, isMain: false, missing: false },
 { projectId: "b", projectName: "Beta", path: "/b/main", branch: "main", head: null, isMain: true, missing: false },
 { projectId: "c", projectName: "Gamma", path: "/c/main", branch: "main", head: null, isMain: true, missing: true },
];

/** a 未分组；b、c 同属工作区 w1（c 的目录缺失）。 */
const projects: ProjectView[] = [
 { id: "a", path: "/a/main", name: "Alpha", missing: false, sessionCount: 0, workspaceId: null },
 { id: "b", path: "/b/main", name: "Beta", missing: false, sessionCount: 0, workspaceId: "w1" },
 { id: "c", path: "/c/main", name: "Gamma", missing: true, sessionCount: 0, workspaceId: "w1" },
];

const term = (id: string, cwd: string): TerminalView =>
 ({ id, projectId: null, cwd, label: id, title: id, state: "unknown", status: "running", exitCode: null, resume: null, collab: [], spawnSeq: 0, createdAt: 0 });

describe("新建终端目标选择", () => {
 it("目录视图优先该目录；工作区视图取组内第一个可用主目录；缺省主目录兜底", () => {
  expect(resolveNewTerminalCheckout(base, { kind: "checkout", path: "/a/login" }, projects)?.path).toBe("/a/login");
  // 目录失效 → 落「第一个可用主目录」
  expect(resolveNewTerminalCheckout(base, { kind: "checkout", path: "/missing" }, projects)?.path).toBe("/a/main");
  // w1 组内 c 的目录缺失 → 取 b 的主目录
  expect(resolveNewTerminalCheckout(base, { kind: "group", id: "w1" }, projects)?.path).toBe("/b/main");
  // 组不存在 → 无目标（调用方落空态）
  expect(resolveNewTerminalCheckout(base, { kind: "group", id: "w9" }, projects)).toBeNull();
  // 没有选中项 → 第一个主目录
  expect(resolveNewTerminalCheckout(base, null, projects)?.path).toBe("/a/main");
  // 全部失效 → null
  expect(resolveNewTerminalCheckout(base.map((w) => ({ ...w, missing: true })), null, projects)).toBeNull();
 });

 it("终端上下文优先目录行名，缺席用路径末段", () => {
  expect(describeTerminalWorkspace("/a/login", base)).toEqual({ primary: "Alpha · login", title: "/a/login" });
  expect(describeTerminalWorkspace("/tmp/ghost", base)).toEqual({ primary: "ghost", title: "/tmp/ghost" });
 });
});

describe("清单刷新与选中收敛", () => {
 it("目录选中失效（目录被移除）→ 退回第一个可用目录，激活终端收敛到它", async () => {
  vi.mocked(api.listCheckouts).mockResolvedValue([
   { projectId: "a", projectName: "Alpha", path: "/a/login", branch: "login", head: null, isMain: false, missing: false },
   { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
  ]);
  vi.mocked(api.listWorkspaces).mockResolvedValue([]);
  useApp.setState({
   terminals: [term("gone", "/gone"), term("kept", "/a/login")],
   activeTerminalId: "gone",
   selection: { kind: "checkout", path: "/gone" },
  });
  await loadCheckouts();
  const s = useApp.getState();
  // 收敛是必须的：右栏按选中范围过滤，留着 /gone 的激活终端会让视图空掉
  expect(s.selection).toEqual({ kind: "checkout", path: "/a/login" });
  expect(s.activeTerminalId).toBe("kept");
 });

 it("工作区选中在组仍存在时保持（空组是空态，不是失效）", async () => {
  vi.mocked(api.listCheckouts).mockResolvedValue([]);
  vi.mocked(api.listWorkspaces).mockResolvedValue([{ id: "w1", name: "全栈", createdAt: 1, projectIds: [] }]);
  useApp.setState({ terminals: [], activeTerminalId: null, selection: { kind: "group", id: "w1" } });
  await loadCheckouts();
  expect(useApp.getState().selection).toEqual({ kind: "group", id: "w1" });
 });

 it("工作区被删 → 退回第一个可用目录", async () => {
  vi.mocked(api.listCheckouts).mockResolvedValue([
   { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
  ]);
  vi.mocked(api.listWorkspaces).mockResolvedValue([]);
  useApp.setState({ terminals: [], activeTerminalId: null, selection: { kind: "group", id: "ghost" } });
  await loadCheckouts();
  expect(useApp.getState().selection).toEqual({ kind: "checkout", path: "/a/main" });
 });
});
