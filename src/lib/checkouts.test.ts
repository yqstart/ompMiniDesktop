// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import type { CheckoutView } from "@shared/types";
import { api } from "@shared/api";
import { loadCheckouts, resolveNewChatCheckout } from "./checkouts";
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

describe("新建聊天的目标选择（⌘T）", () => {
 it("第一个可用主目录；没有主目录退回第一个可用目录；全失效 / 空清单 → null", () => {
  expect(resolveNewChatCheckout(base)?.path).toBe("/a/main");
  // 只有 worktree（主目录缺失）→ 退回第一个可用目录
  expect(resolveNewChatCheckout([base[1]])?.path).toBe("/a/login");
  // 全部目录缺失 → 没有可开的目标
  expect(resolveNewChatCheckout(base.map((w) => ({ ...w, missing: true })))).toBeNull();
  expect(resolveNewChatCheckout([])).toBeNull();
 });
});

describe("清单刷新", () => {
 it("loadCheckouts：目录行与工作区清单一次落库", async () => {
  vi.mocked(api.listCheckouts).mockResolvedValue(base);
  vi.mocked(api.listWorkspaces).mockResolvedValue([{ id: "w1", name: "全栈", createdAt: 1, projectIds: ["a", "b"] }]);
  useApp.setState({ checkouts: [], workspaceGroups: [] });
  const list = await loadCheckouts();
  expect(list).toEqual(base);
  const s = useApp.getState();
  expect(s.checkouts).toEqual(base);
  expect(s.workspaceGroups.map((g) => g.id)).toEqual(["w1"]);
 });
});
