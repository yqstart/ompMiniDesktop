// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../../stores/app";
import { QuickSwitcher } from "./QuickSwitcher";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({
  terminals: [
   {
    id: "t-login",
    projectId: "a",
    cwd: "/a/login",
    label: "Alpha · login",
    title: "修复登录",
    state: "working",
    status: "running",
    exitCode: null,
    resume: null,
    collab: [],
    spawnSeq: 0,
    createdAt: 1,
   },
  ],
  activeTerminalId: "t-login",
  selection: { kind: "checkout", path: "/a/login" },
  workspaceGroups: [],
  projects: [],
  checkouts: [
   { projectId: "a", projectName: "Alpha", path: "/a/main", branch: "main", head: null, isMain: true, missing: false },
   { projectId: "a", projectName: "Alpha", path: "/a/login", branch: "login", head: null, isMain: false, missing: false },
   { projectId: "b", projectName: "Beta", path: "/b/gone", branch: "gone", head: null, isMain: false, missing: true },
  ],
  locale: "zh-CN",
  quickSwitcherOpen: true,
  sidebarOpen: false,
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

function open() {
 act(() => {
  root.render(<QuickSwitcher />);
 });
}

function typeQuery(value: string) {
 const input = container.querySelector("input")!;
 act(() => {
  input.focus();
  input.setAttribute("value", value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
 });
 // 受控输入在 React 19 测试里用原生 value 设置器触发
 const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
 act(() => {
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
 });
}

describe("快速切换", () => {
 it("筛选后回车聚焦已有终端，不新建终端", () => {
  const before = useApp.getState().terminals.length;
  open();
  typeQuery("修复登录");
  const input = container.querySelector("input")!;
  act(() => {
   input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(useApp.getState().terminals.length).toBe(before);
  expect(useApp.getState().activeTerminalId).toBe("t-login");
  expect(useApp.getState().quickSwitcherOpen).toBe(false);
 });

 it("缺失目录不可执行且不建终端", () => {
  open();
  typeQuery("gone");
  const before = useApp.getState().terminals.length;
  const missing = Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.includes("Beta"));
  expect(missing?.hasAttribute("disabled")).toBe(true);
  act(() => {
   missing?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
  expect(useApp.getState().terminals.length).toBe(before);
  expect(useApp.getState().quickSwitcherOpen).toBe(true);
 });

 it("打开后目标消失时提示而不误切", () => {
  open();
  typeQuery("修复登录");
  act(() => {
   useApp.setState({ terminals: [], checkouts: [] });
   container.querySelector("input")?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  // 列表已无可执行结果：回车保持面板并提示无匹配，不关闭也不新建
  expect(container.textContent).toContain("没有匹配的终端或工作区");
  expect(useApp.getState().quickSwitcherOpen).toBe(true);
 });

 it("组字中的回车不执行", () => {
  const focus = vi.spyOn(useApp.getState(), "focusTerminal");
  open();
  typeQuery("修复登录");
  const input = container.querySelector("input")!;
  const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  Object.defineProperty(event, "isComposing", { value: true });
  // React 读取 nativeEvent.isComposing，这里直接派发原生事件
  act(() => {
   input.dispatchEvent(event);
  });
  expect(focus).not.toHaveBeenCalled();
  focus.mockRestore();
 });

 it("工作区项可搜索；回车切到该工作区范围", () => {
  act(() => {
   useApp.setState({
    workspaceGroups: [{ id: "w1", name: "全栈", createdAt: 1, projectIds: ["a"] }],
    projects: [{ id: "a", path: "/a/main", name: "Alpha", missing: false, sessionCount: 0, workspaceId: "w1" }],
   });
  });
  open();
  typeQuery("全栈");
  const input = container.querySelector("input")!;
  act(() => {
   input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(useApp.getState().selection).toEqual({ kind: "group", id: "w1" });
  expect(useApp.getState().quickSwitcherOpen).toBe(false);
 });
});
