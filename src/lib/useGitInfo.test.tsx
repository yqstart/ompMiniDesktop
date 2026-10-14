// @vitest-environment jsdom
/**
 * git 只读查询 hook：cwd 变化重查；store 的 `gitInfoSeq` 自增（分支切换等跨组件变化）
 * 让已挂载的实例一起重读——这条链断了，切完分支输入卡 / 右栏会一直显示旧分支。
 */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GitInfo } from "@shared/types";
import { useApp } from "../stores/app";

const { apiMock } = vi.hoisted(() => ({ apiMock: { getGitInfo: vi.fn() } }));
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));

import { useGitInfo } from "./useGitInfo";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const info = (branch: string): GitInfo => ({
 isRepo: true,
 branch,
 detached: false,
 branches: [branch],
 dirty: false,
 added: 0,
 removed: 0,
 error: null,
});

function Probe({ cwd }: { cwd: string }) {
 const { info } = useGitInfo(cwd);
 return createElement("div", null, info?.branch ?? "…");
}

describe("useGitInfo", () => {
 beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ gitInfoSeq: 0 });
 });

 it("按 cwd 查询；gitInfoSeq 自增后重读并收敛到新值", async () => {
  apiMock.getGitInfo.mockResolvedValue(info("main"));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
   root.render(createElement(Probe, { cwd: "/w/alpha" }));
  });
  expect(apiMock.getGitInfo).toHaveBeenCalledWith("/w/alpha");
  expect(container.textContent).toBe("main");

  // 分支在壳外被切走：自增信号一到，已挂载实例必须重读
  apiMock.getGitInfo.mockResolvedValue(info("feature/x"));
  await act(async () => {
   useApp.setState((s) => ({ gitInfoSeq: s.gitInfoSeq + 1 }));
  });
  expect(apiMock.getGitInfo).toHaveBeenCalledTimes(2);
  expect(container.textContent).toBe("feature/x");

  // 空 cwd：不发起查询
  await act(async () => {
   root.render(createElement(Probe, { cwd: "" }));
  });
  expect(apiMock.getGitInfo).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
  container.remove();
 });
});
