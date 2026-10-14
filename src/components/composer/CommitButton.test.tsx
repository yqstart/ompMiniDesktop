// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeSet, CommitTaskView } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";

/**
 * 卡顶行「提交」键：点开提交浮层（与右栏「变更」同链路）；状态图标随 `commitTasks[cwd]`
 * 的 phase 走——运行中转圈、失败红点、其余为对勾。
 */
const { apiMock } = vi.hoisted(() => ({
 apiMock: {
  getChangeSet: vi.fn(
   async (): Promise<ChangeSet> => ({
    isRepo: true,
    branch: "main",
    head: null,
    upstream: null,
    upstreamGone: false,
    ahead: 0,
    behind: 0,
    files: [],
   }),
  ),
 },
}));
vi.mock("@shared/api", () => ({
 api: new Proxy(apiMock, { get: (t, k) => (k in t ? (t as Record<string, unknown>)[k as string] : async () => null) }),
}));

import { CommitButton } from "./CommitButton";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zh = TEXT["zh-CN"];

function task(phase: CommitTaskView["phase"]): CommitTaskView {
 return {
  cwd: "/w/alpha",
  mode: "fast",
  phase,
  files: [],
  selected: [],
  message: "",
  generated: false,
  log: [],
  commits: [],
  error: null,
  hint: null,
  startedAt: 0,
 };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 vi.clearAllMocks();
 useApp.setState({ locale: "zh-CN", commitTasks: {}, activeCommitCwd: null });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

function render() {
 act(() => {
  root.render(<CommitButton cwd="/w/alpha" />);
 });
}

describe("CommitButton", () => {
 it("默认对勾 + 「提交」；点开提交浮层（落任务并聚焦该 cwd）", async () => {
  render();
  expect(container.textContent).toContain(zh.gitCommitTitle);
  expect(container.querySelector(".animate-spin")).toBeNull();
  expect(container.querySelector(".bg-danger")).toBeNull();
  await act(async () => {
   container.querySelector("button")?.click();
  });
  expect(useApp.getState().activeCommitCwd).toBe("/w/alpha");
  expect(useApp.getState().commitTasks["/w/alpha"]).toBeTruthy();
 });

 it("运行中显示转圈，失败显示红点", () => {
  useApp.setState({ commitTasks: { "/w/alpha": task("committing") } });
  render();
  expect(container.querySelector(".animate-spin")).toBeTruthy();
  act(() => root.unmount());
  root = createRoot(container);
  useApp.setState({ commitTasks: { "/w/alpha": task("failed") } });
  render();
  expect(container.querySelector(".bg-danger")).toBeTruthy();
  expect(container.querySelector(".animate-spin")).toBeNull();
 });
});
