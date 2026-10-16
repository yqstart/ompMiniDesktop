// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useApp } from "../stores/app";
import { TEXT } from "../lib/locale";
import { ReferencePicker } from "./ReferencePicker";

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿一个能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({
 listProjectFiles: vi.fn(),
}));
vi.mock("@shared/api", () => ({
 api: { listProjectFiles: mock.listProjectFiles },
}));

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom 没实现 scrollIntoView（键盘移动时要把选中行滚进视野），给个空实现
if (!Element.prototype.scrollIntoView) {
 Element.prototype.scrollIntoView = () => {};
}

const t = TEXT["zh-CN"];

const FE = { id: "fe", path: "/p/fe", name: "FE", missing: false, sessionCount: 0, workspaceId: "w1" };
const BE = { id: "be", path: "/p/be", name: "BE", missing: false, sessionCount: 0, workspaceId: "w1" };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 mock.listProjectFiles.mockReset();
 mock.listProjectFiles.mockResolvedValue([
  { path: "/p/be", files: ["src/api.ts", "src/db/index.ts", "README.md"], truncated: false, error: null },
 ]);
 useApp.setState({
  workspaceGroups: [{ id: "w1", name: "全栈", createdAt: 0, projectIds: ["fe", "be"] }],
  projects: [FE, BE],
  checkouts: [
   { projectId: "fe", projectName: "FE", path: "/p/fe", branch: "main", head: null, isMain: true, missing: false },
   { projectId: "be", projectName: "BE", path: "/p/be", branch: "main", head: null, isMain: true, missing: false },
  ],
  sessions: [
   { id: "s1", projectId: "fe", title: "会话", cwd: "/p/fe", timestamp: 1, archived: false, corrupt: false, note: null, running: false },
  ],
  drafts: { s1: "" },
  locale: "zh-CN",
  refPickerTarget: { sessionId: "s1" },
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
 it("只列其他成员项目（当前项目排除）；目录树缩进；回车把 @路径 追加进草稿并关闭", async () => {
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
  // 跨项目 = 会话目录（/p/fe）之外：按绝对路径投递待插入芯片（目录内的引用才走相对路径，
  // 见 workspaceFiles.test.ts）；真正的插入由 Composer 消费这条请求完成
  expect(useApp.getState().pendingReference).toMatchObject({
   sessionId: "s1",
   path: "/p/be/src/api.ts",
   label: "api.ts",
   isDir: false,
  });
  expect(useApp.getState().refPickerTarget).toBeNull();
  expect(useApp.getState().composerFocusSeq).toBeGreaterThan(0);
 });

 it("键盘：默认停在第一条文件行，↑ 能停到文件夹行、Enter 引用整个文件夹", async () => {
  await open();
  // 树的行序：src(0) → src/db(1) → index.ts(2) → api.ts(3) → README.md(4)
  press("ArrowUp"); // 从默认落点（index.ts）上移到 src/db
  press("Enter");
  expect(useApp.getState().pendingReference).toMatchObject({
   sessionId: "s1",
   path: "/p/be/src/db",
   label: "db/",
   isDir: true,
  });
  expect(useApp.getState().refPickerTarget).toBeNull();
 });

 it("已有草稿时追加在原文之后（尾随空格收口提及解析）", async () => {
  act(() => useApp.setState({ drafts: { s1: "看看这个：" } }));
  await open();
  typeQuery("api");
  press("Enter");
  // 草稿本身不再被直接改写（非受控编辑器）：引用以「待插入芯片」投递，原文保持不动
  expect(useApp.getState().pendingReference).toMatchObject({ path: "/p/be/src/api.ts", seq: expect.any(Number) });
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

 it("文件夹可引用：目录行尾的链接键投递目录引用（isDir、短名带尾斜杠、路径不带）", async () => {
  await open();
  // 行尾链接键按树的前序排列：src、src/db
  const buttons = [...container.querySelectorAll("button")].filter(
   (b) => b.getAttribute("aria-label") === t.refPickDirRef,
  );
  expect(buttons).toHaveLength(2);

  act(() => {
   buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  // 跨项目 = 绝对路径；尾斜杠由引用芯片序列化时补（`@/p/be/src/db/`）
  expect(useApp.getState().pendingReference).toMatchObject({
   sessionId: "s1",
   path: "/p/be/src/db",
   label: "db/",
   isDir: true,
  });
  expect(useApp.getState().refPickerTarget).toBeNull();
  expect(useApp.getState().composerFocusSeq).toBeGreaterThan(0);
 });

 it("当前项目不在工作区里（没有其他项目）：给提示且不发请求", async () => {
  act(() => {
   useApp.setState({ workspaceGroups: [], projects: [{ ...FE, workspaceId: null }, BE] });
  });
  await open();
  expect(mock.listProjectFiles).not.toHaveBeenCalled();
  expect(container.textContent).toContain(t.refPickScopeHint);
 });

 it("会话已不在 store（被删）→ 浮层自收、不渲染", async () => {
  act(() => {
   useApp.setState({ refPickerTarget: { sessionId: "gone" }, sessions: [], drafts: {} });
  });
  await open();
  expect(useApp.getState().refPickerTarget).toBeNull();
  expect(container.textContent).toBe("");
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
