// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GitInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";

/**
 * 右栏「变更」区块（v2）：分支 + dirty 点、未提交改动的 `+X −Y`（后端 v2 新增的行级统计）、
 * ahead / behind 与提交 / 推送入口。
 * git 数据走被 mock 的 `@shared/api`（`get_git_info`）；提交 / 推送入口只断言渲染，
 * 点击链路见 `lib/commitTasks` 的既有测试。
 */
const { apiMock } = vi.hoisted(() => ({
 apiMock: {
  getGitInfo: vi.fn(
   async (): Promise<GitInfo> => ({
    isRepo: true,
    branch: "main",
    detached: false,
    branches: ["main"],
    dirty: true,
    added: 12,
    removed: 3,
    error: null,
   }),
  ),
 },
}));
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));

import { ChangesSection } from "./ChangesSection";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zh = TEXT["zh-CN"];
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 vi.clearAllMocks();
 useApp.setState({
  locale: "zh-CN",
  activeSessionId: "s1",
  sessions: [
   { id: "s1", projectId: "p1", title: "t", cwd: "/w/alpha", timestamp: 0, archived: false, corrupt: false, note: null, running: false },
  ],
  projects: [{ id: "p1", name: "alpha", path: "/w/alpha", missing: false, workspaceId: null, order: 0 } as never],
  workspaceGitStates: { "/w/alpha": { path: "/w/alpha", isRepo: true, dirty: true, ahead: 2, behind: 0, upstream: "origin/main", upstreamGone: false } },
  commitTasks: {},
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

describe("ChangesSection", () => {
 it("渲染分支、dirty 点、+X −Y 与 ahead；提交与推送入口在", async () => {
  await act(async () => {
   root.render(<ChangesSection />);
  });
  await act(async () => { });
  expect(apiMock.getGitInfo).toHaveBeenCalledWith("/w/alpha");
  expect(container.textContent).toContain(zh.panelChanges);
  expect(container.textContent).toContain("main");
  expect(container.textContent).toContain("+12");
  expect(container.textContent).toContain("−3");
  // ahead（2）：行内计数 + 推送按钮
  expect(container.textContent).toContain("2");
  expect(container.textContent).toContain(zh.gitCommitTitle);
 });

 it("非 git 仓库：给出一行说明，不渲染分支与按钮", async () => {
  apiMock.getGitInfo.mockResolvedValueOnce({
   isRepo: false,
   branch: null,
   detached: false,
   branches: [],
   dirty: null,
   added: null,
   removed: null,
   error: "not a repository",
  });
  await act(async () => {
   root.render(<ChangesSection />);
  });
  await act(async () => { });
  expect(container.textContent).toContain(zh.notGitRepo);
  expect(container.textContent).not.toContain(zh.gitCommitTitle);
 });
});
