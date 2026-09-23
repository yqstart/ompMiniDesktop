// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CommitPhase, WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { CommitTaskPanel } from "./CommitTaskPanel";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

/** 提交信息语言的作用域是**项目**：一个项目下挂主目录与 worktree 两个工作区。 */
const MAIN: WorkspaceView = {
  projectId: "p1",
  projectName: "repo",
  path: "/repo",
  branch: "main",
  head: null,
  isMain: true,
  missing: false,
};
const WORKTREE: WorkspaceView = { ...MAIN, path: "/repo/.wt/feat", branch: "feat", isMain: false };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  useApp.setState({
    locale: "zh-CN",
    workspaces: [MAIN, WORKTREE],
    commitLangPrefs: {},
    commitTasks: {},
    activeCommitCwd: null,
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 打开某个工作区的任务浮层（`committed` = 第一段已完成的终态，控件可操作）。 */
function showTask(cwd: string, phase: CommitPhase = "committed"): void {
  useApp.setState({
    commitTasks: {
      [cwd]: { cwd, phase, log: [], commits: [], error: null, hint: null, startedAt: 0 },
    },
    activeCommitCwd: cwd,
  });
  root = createRoot(container);
  act(() => root.render(<CommitTaskPanel />));
}

const radios = () => [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const remember = () => container.querySelector<HTMLButtonElement>('[role="switch"]')!;
const stored = () => JSON.parse(localStorage.getItem("omp.commitLang.v1") ?? "{}");

describe("提交信息语言控件（按项目记忆）", () => {
  it("三档默认选中「系统默认」，选中态由 aria-checked 表达", () => {
    showTask("/repo");
    expect(radios().map((b) => b.textContent)).toEqual(["系统默认", "简体中文", "English"]);
    expect(radios().map((b) => b.getAttribute("aria-checked"))).toEqual(["true", "false", "false"]);
    expect(remember().getAttribute("aria-checked")).toBe("false");
  });

  it("选中文：先只进内存；勾「记住选择」后按项目写盘（并能跨工作区共享）", () => {
    showTask("/repo");
    act(() => radios()[1].click());
    expect(useApp.getState().commitLangPrefs.p1).toEqual({ lang: "zh", remembered: false });
    expect(stored()).toEqual({}); // 没记住 = 不落盘
    expect(container.textContent).toContain("摘要首词仍须英文过去式动词"); // 中文档的首词说明

    act(() => remember().click());
    expect(useApp.getState().commitLangPrefs.p1).toEqual({ lang: "zh", remembered: true });
    expect(stored()).toEqual({ p1: "zh" });

    // 同一项目的 worktree 打开浮层：同一份项目偏好（系统默认 / 中文 / English 对应项目，不是工作区）
    act(() => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    showTask("/repo/.wt/feat");
    expect(radios().map((b) => b.getAttribute("aria-checked"))).toEqual(["false", "true", "false"]);
    expect(remember().getAttribute("aria-checked")).toBe("true");
  });

  it("取消「记住选择」：从盘里删键，本次运行仍用当前档", () => {
    showTask("/repo");
    act(() => radios()[2].click());
    act(() => remember().click());
    expect(stored()).toEqual({ p1: "en" });

    act(() => remember().click());
    expect(stored()).toEqual({});
    expect(useApp.getState().commitLangPrefs.p1).toEqual({ lang: "en", remembered: false });
    expect(radios()[2].getAttribute("aria-checked")).toBe("true");
  });

  it("运行中锁住：三档与记住开关都禁用，并说明下次提交生效", () => {
    showTask("/repo", "committing");
    expect(radios().every((b) => b.disabled)).toBe(true);
    expect(remember().disabled).toBe(true);
    expect(container.textContent).toContain("任务运行中不可修改");

    act(() => radios()[1].click()); // 禁用态点击不生效
    expect(useApp.getState().commitLangPrefs.p1).toBeUndefined();
  });
});
