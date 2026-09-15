// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";
import { ReferencePicker } from "./ReferencePicker";

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿一个能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({
 listProjectFiles: vi.fn(),
 ptyWrite: vi.fn(() => Promise.resolve()),
}));
vi.mock("@shared/api", () => ({
 api: { listProjectFiles: mock.listProjectFiles, ptyWrite: mock.ptyWrite },
}));

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

const t = TEXT["zh-CN"];

const FE = { id: "fe", path: "/p/fe", name: "FE", missing: false, sessionCount: 0, workspaceId: "w1" };
const BE = { id: "be", path: "/p/be", name: "BE", missing: false, sessionCount: 0, workspaceId: "w1" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 mock.listProjectFiles.mockReset();
 mock.ptyWrite.mockReset();
 mock.ptyWrite.mockResolvedValue(undefined);
 mock.listProjectFiles.mockResolvedValue([
  { path: "/p/be", files: ["src/api.ts", "src/db/index.ts", "README.md"], truncated: false, error: null },
 ]);
 useApp.setState({
  terminals: [
   {
    id: "t1",
    projectId: "fe",
    cwd: "/p/fe",
    label: "FE · main",
    title: null,
    state: "ready",
    status: "running",
    exitCode: null,
    resume: null,
    collab: [],
    spawnSeq: 0,
    createdAt: 1,
   },
  ],
  activeTerminalId: "t1",
  selection: { kind: "checkout", path: "/p/fe" },
  workspaceGroups: [{ id: "w1", name: "全栈", createdAt: 0, projectIds: ["fe", "be"] }],
  projects: [FE, BE],
  checkouts: [
   { projectId: "fe", projectName: "FE", path: "/p/fe", branch: "main", head: null, isMain: true, missing: false },
   { projectId: "be", projectName: "BE", path: "/p/be", branch: "main", head: null, isMain: true, missing: false },
  ],
  locale: "zh-CN",
  refPickerTarget: { kind: "terminal", id: "t1" },
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

/** 让 effect 里的 promise 回调落地：async act 会 flush 微任务队列。 */
async function settle() {
 await act(async () => { });
}

/** 渲染并等文件列表 promise 结算。 */
async function open() {
 await act(async () => {
  root.render(<ReferencePicker />);
 });
 await settle();
}

function typeQuery(value: string) {
 const input = container.querySelector("input")!;
 const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
 act(() => {
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
 });
}

function press(key: string) {
 act(() => {
  container.querySelector("input")!.dispatchEvent(
   new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
  );
 });
}

function clickByText(text: string) {
 const button = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
 act(() => {
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
 });
}

describe("引用工作区文件浮层", () => {
 it("只列其他成员项目（当前项目排除）；目录树缩进；回车注入 @绝对路径 并关闭", async () => {
  await open();
  // 只请求「其他项目」，当前项目（/p/fe）不发请求
  expect(mock.listProjectFiles).toHaveBeenCalledWith(["/p/be"]);
  // 目录树：目录行（图标 + 名字，无 `/` 后缀）+ 文件末段
  const dirNames = [...container.querySelectorAll("button")]
   .filter((b) => b.getAttribute("role") !== "option")
   .map((b) => b.textContent)
   .filter((text): text is string => text !== null && text.length > 0);
  expect(dirNames).toEqual(["src", "db"]);
  expect(container.textContent).toContain("index.ts");
  expect(container.textContent).toContain("README.md");
  // 文件行只显示末段名（不再是整条路径平铺）
  expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual([
   "index.ts",
   "api.ts",
   "README.md",
  ]);

  typeQuery("api");
  const options = [...container.querySelectorAll('[role="option"]')];
  expect(options.map((o) => o.textContent)).toEqual(["api.ts"]);

  press("Enter");
  expect(mock.ptyWrite).toHaveBeenCalledWith("t1", "\u001b[200~@/p/be/src/api.ts \u001b[201~");
  expect(useApp.getState().refPickerTarget).toBeNull();
 });

 it("目录行可折叠：子树隐藏、目录行保留、再点恢复", async () => {
  await open();
  const before = [...container.querySelectorAll('[role="option"]')].map((o) => o.textContent);
  expect(before).toEqual(["index.ts", "api.ts", "README.md"]);

  clickByText("src");
  expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(["README.md"]);
  expect([...container.querySelectorAll("button")].some((b) => b.textContent === "src")).toBe(true);

  clickByText("src");
  expect([...container.querySelectorAll('[role="option"]')].map((o) => o.textContent)).toEqual(before);
 });

 it("当前项目不在工作区里（没有其他项目）：给提示且不发请求", async () => {
  act(() => {
   useApp.setState({ workspaceGroups: [], projects: [{ ...FE, workspaceId: null }, BE] });
  });
  await open();
  expect(mock.listProjectFiles).not.toHaveBeenCalled();
  expect(container.textContent).toContain(t.refPickScopeHint);
 });

 it("聊天形态：回车把 @绝对路径 追加进草稿（不写 PTY）、交还焦点信号并关闭", async () => {
  act(() => {
   useApp.setState({
    refPickerTarget: { kind: "chat", sessionId: "s1" },
    sessions: [
     { id: "s1", projectId: "fe", title: "会话", cwd: "/p/fe", timestamp: 1, archived: false, corrupt: false, note: null, running: false },
    ],
    drafts: { s1: "看看这个：" },
   });
  });
  await open();
  expect(mock.listProjectFiles).toHaveBeenCalledWith(["/p/be"]);
  typeQuery("api");
  press("Enter");
  expect(useApp.getState().drafts.s1).toBe("看看这个： @/p/be/src/api.ts ");
  expect(mock.ptyWrite).not.toHaveBeenCalled();
  expect(useApp.getState().refPickerTarget).toBeNull();
  expect(useApp.getState().composerFocusSeq).toBeGreaterThan(0);
 });

 it("聊天形态：会话已不在 store（被删）→ 浮层自收、不渲染", async () => {
  act(() => {
   useApp.setState({ refPickerTarget: { kind: "chat", sessionId: "gone" }, sessions: [], drafts: {} });
  });
  await open();
  expect(useApp.getState().refPickerTarget).toBeNull();
  expect(container.textContent).toBe("");
 });

 it("终端忙碌（π 非等待输入）：不注入、给提示、浮层留着", async () => {
  act(() => {
   useApp.setState({
    terminals: [{ ...useApp.getState().terminals[0]!, state: "working" }],
   });
  });
  await open();
  press("Enter");
  expect(mock.ptyWrite).not.toHaveBeenCalled();
  expect(useApp.getState().refPickerTarget).toEqual({ kind: "terminal", id: "t1" });
  expect(container.textContent).toContain(t.refPickBusy);
 });

 it("加载失败显示错误与重试；重试成功后恢复列表", async () => {
  mock.listProjectFiles.mockRejectedValueOnce(new Error("boom"));
  await open();
  expect(container.textContent).toContain(t.refPickLoadFailed);
  expect(container.textContent).toContain("boom");

  clickByText(t.refPickRetry);
  await settle();
  expect([...container.querySelectorAll('[role="option"]')].length).toBe(3);
 });
});
