import { describe, expect, it } from "vitest";
import type { CheckoutView, ProjectView, WorkspaceView } from "@shared/types";
import { checkoutGroupId, collabContextFor, projectIdForPath, selectionScopePaths } from "./workspaceGroups";

/** w1 = 前端 b + 后端 c 的多项目工作区；a 未分组。 */
const groups: WorkspaceView[] = [{ id: "w1", name: "全栈", createdAt: 1, projectIds: ["b", "c"] }];
const projects: ProjectView[] = [
 { id: "a", path: "/a", name: "Alpha", missing: false, sessionCount: 0, workspaceId: null },
 { id: "b", path: "/b", name: "Front", missing: false, sessionCount: 0, workspaceId: "w1" },
 { id: "c", path: "/c", name: "Back", missing: false, sessionCount: 0, workspaceId: "w1" },
];
const checkouts: CheckoutView[] = [
 { projectId: "a", projectName: "Alpha", path: "/a", branch: "main", head: null, isMain: true, missing: false },
 { projectId: "b", projectName: "Front", path: "/b", branch: "main", head: null, isMain: true, missing: false },
 { projectId: "b", projectName: "Front", path: "/b/.wt/x", branch: "x", head: null, isMain: false, missing: false },
 { projectId: "c", projectName: "Back", path: "/c", branch: "main", head: null, isMain: true, missing: false },
];

describe("选中范围（右栏视图）", () => {
 it("目录视图只含该目录", () => {
  const scope = selectionScopePaths({ kind: "checkout", path: "/b" }, groups, checkouts, projects);
  expect([...(scope ?? [])]).toEqual(["/b"]);
 });

 it("工作区视图 = 组内全部项目的全部目录（含 worktree）", () => {
  const scope = selectionScopePaths({ kind: "group", id: "w1" }, groups, checkouts, projects);
  expect([...(scope ?? [])].sort()).toEqual(["/b", "/b/.wt/x", "/c"]);
 });

 it("未分组视图 = 未归属项目的目录", () => {
  const scope = selectionScopePaths({ kind: "group", id: null }, groups, checkouts, projects);
  expect([...(scope ?? [])]).toEqual(["/a"]);
 });

 it("没有选中项 = 不过滤", () => {
  expect(selectionScopePaths(null, groups, checkouts, projects)).toBeNull();
 });
});

describe("协作上下文（全自动挂载）", () => {
 it("多成员工作区里的目录（含 worktree）：挂其余成员的主目录并注入说明", () => {
  const ctx = collabContextFor("/b/.wt/x", groups, checkouts, projects, "zh-CN");
  expect(ctx.addDirs).toEqual(["/c"]);
  expect(ctx.note).toContain("全栈");
  expect(ctx.note).toContain("Front");
  expect(ctx.note).toContain("Back");
  expect(ctx.note).toContain("/c");
  // 英文界面走英文注入
  expect(collabContextFor("/b", groups, checkouts, projects, "en").note).toContain("[ompMiniDesktop workspace]");
 });

 it("未分组项目 / 单成员工作区不挂根也不注入", () => {
  expect(collabContextFor("/a", groups, checkouts, projects, "zh-CN")).toEqual({ addDirs: [], note: null });
  const soloGroups: WorkspaceView[] = [{ id: "w2", name: "solo", createdAt: 1, projectIds: ["a"] }];
  const soloProjects: ProjectView[] = [{ ...projects[0], workspaceId: "w2" }];
  expect(collabContextFor("/a", soloGroups, checkouts, soloProjects, "zh-CN")).toEqual({ addDirs: [], note: null });
 });

 it("对不上任何项目的目录不挂根", () => {
  expect(collabContextFor("/tmp/ghost", groups, checkouts, projects, "zh-CN")).toEqual({ addDirs: [], note: null });
 });
});

describe("cwd → 项目 / 工作区解析", () => {
 it("worktree 目录按目录行精确匹配到项目，再取所属组", () => {
  expect(checkoutGroupId("/b/.wt/x", checkouts, projects)).toBe("w1");
  expect(checkoutGroupId("/a", checkouts, projects)).toBeNull();
  expect(checkoutGroupId("/tmp/ghost", checkouts, projects)).toBeNull();
 });

 it("目录行里没有的 cwd 按项目主目录前缀兜底（最长优先）", () => {
  expect(projectIdForPath("/c/sub/dir", checkouts, projects)).toBe("c");
 });
});
