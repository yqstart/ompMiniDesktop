// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectView, SessionView } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";
import { ChatSidebar } from "./ChatSidebar";

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({
 listSessions: vi.fn(),
 listProjects: vi.fn(async () => [] as unknown[]),
 listWorkspaces: vi.fn(async () => [] as unknown[]),
 listCheckouts: vi.fn(async () => [] as unknown[]),
 createWorkspace: vi.fn(),
}));
vi.mock("@shared/api", () => ({
 api: {
  listSessions: mock.listSessions,
  listProjects: mock.listProjects,
  listWorkspaces: mock.listWorkspaces,
  listCheckouts: mock.listCheckouts,
  createWorkspace: mock.createWorkspace,
 },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => null) }));
vi.mock("@tauri-apps/api/app", () => ({ getVersion: vi.fn(async () => "0.10.0") }));

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

const P1: ProjectView = { id: "p1", path: "/w/alpha", name: "alpha", missing: false, sessionCount: 2, workspaceId: "w1" };
const P2: ProjectView = { id: "p2", path: "/w/beta", name: "beta", missing: false, sessionCount: 1, workspaceId: "w1" };
const P3: ProjectView = { id: "p3", path: "/w/solo", name: "solo", missing: false, sessionCount: 0, workspaceId: null };

const session = (id: string, projectId: string | null, title: string, archived = false): SessionView => ({
 id,
 projectId,
 title,
 cwd: projectId === "p1" ? "/w/alpha" : projectId === "p2" ? "/w/beta" : "/tmp/scratch",
 timestamp: 1,
 archived,
 corrupt: false,
 note: null,
 running: false,
});

const SESSIONS: SessionView[] = [
 session("s1", "p1", "登录页重构"),
 session("s2", "p2", "后端接口联调"),
 session("s3", null, "游离会话"),
 session("s4", "p1", "已归档的旧会话", true),
];

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 mock.listSessions.mockReset();
 mock.listSessions.mockResolvedValue({ sessions: SESSIONS, totalFiles: 4, scannedFiles: 4 });
 mock.listProjects.mockReset();
 mock.listProjects.mockResolvedValue([]);
 mock.listWorkspaces.mockReset();
 mock.listWorkspaces.mockResolvedValue([]);
 mock.listCheckouts.mockReset();
 mock.listCheckouts.mockResolvedValue([]);
 mock.createWorkspace.mockReset();
 useApp.setState({
  projects: [P1, P2],
  workspaceGroups: [{ id: "w1", name: "全栈", createdAt: 0, projectIds: ["p1", "p2"] }],
  sessions: [],
  activeSessionId: null,
  locale: "zh-CN",
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

/** 渲染并等 `list_sessions` 那一趟落地。 */
async function open(): Promise<void> {
 await act(async () => {
  root.render(<ChatSidebar visible />);
 });
 await act(async () => { });
}

describe("聊天侧栏的工作区分段（V21 容器在聊天形态的投影）", () => {
 it("有自定义工作区：按组分段，工作区头带成员数，会话挂在自己的项目下", async () => {
  await open();
  const text = container.textContent ?? "";
  expect(text).toContain("全栈");
  // 工作区头的成员计数（`wsGroupCount` = 「N 个项目」）
  expect(container.querySelector('[aria-label="2 个项目"]')).not.toBeNull();
  // 会话按项目落在工作区段内：段里同时有项目名与它会话的标题
  const section = container.querySelector("details.group\\/ws");
  expect(section?.textContent).toContain("alpha");
  expect(section?.textContent).toContain("登录页重构");
  expect(section?.textContent).toContain("后端接口联调");
  // 未归属会话仍在（它不属于任何项目）
  expect(text).toContain("游离会话");
  // 已归档的会话不列
  expect(text).not.toContain("已归档的旧会话");
 });

 it("未进组的项目：进「未分组」段（同一个分段排布）", async () => {
  act(() => {
   useApp.setState({ projects: [P1, P3] });
  });
  await open();
  const text = container.textContent ?? "";
  expect(text).toContain("全栈");
  expect(text).toContain("未分组");
  expect(text).toContain("solo");
 });

 it("没有自定义工作区：平铺（不出现工作区头 / 未分组段）", async () => {
  act(() => {
   useApp.setState({ workspaceGroups: [], projects: [{ ...P1, workspaceId: null }, { ...P2, workspaceId: null }] });
  });
  await open();
  const text = container.textContent ?? "";
  expect(text).not.toContain("未分组");
  expect(container.querySelector("details.group\\/ws")).toBeNull();
  expect(text).toContain("alpha");
  expect(text).toContain("登录页重构");
 });
});

describe("聊天侧栏的提交入口（与终端目录行同一命令面）", () => {
 it("项目分组头有提交键，点击打开该项目的提交面板", async () => {
  const { TEXT } = await import("../../lib/locale");
  await open();
  const btn = container.querySelector(`button[aria-label="${TEXT["zh-CN"].gitCommitTitle}"]`);
  expect(btn, "项目分组头应有提交入口").not.toBeNull();
  (btn as HTMLButtonElement).click();
  expect(useApp.getState().activeCommitCwd).toBe("/w/alpha");
 });

 it("有未推送提交时分组头显示待推送徽章（点击走推送）", async () => {
  const { TEXT } = await import("../../lib/locale");
  act(() => {
   useApp.setState({
    workspaceGitStates: { "/w/alpha": { path: "/w/alpha", isRepo: true, dirty: false, ahead: 3, behind: 0, upstream: "origin/main", upstreamGone: false } },
    commitTasks: {},
   });
  });
  await open();
  const badge = container.querySelector(`button[aria-label="${TEXT["zh-CN"].gitPushTitle.replace("{0}", "3")}"]`);
  expect(badge, "待推送徽章应渲染").not.toBeNull();
  expect(badge?.textContent).toContain("3");
 });

 it("改名后的实时标题覆盖扫描行的旧标题", async () => {
  await open();
  expect(container.textContent).toContain("登录页重构");
  act(() => {
   useApp.setState({
    sessions: [{ id: "s1", projectId: "p1", title: "改名后的标题", cwd: "/w/alpha", timestamp: 1, archived: false, corrupt: false, note: "改名后的标题", running: true }],
   });
  });
  expect(container.textContent).toContain("改名后的标题");
 });
});

/** 输入框赋值：绕过 React 的 value 影子状态（与 `WorkspaceGroupDialog.test.tsx` 同一套）。 */
async function fill(input: HTMLInputElement | null, value: string): Promise<void> {
 const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
 await act(async () => {
  setter?.call(input, value);
  input?.dispatchEvent(new Event("input", { bubbles: true }));
 });
}

async function click(el: HTMLElement | null | undefined): Promise<void> {
 await act(async () => {
  el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
 });
}

describe("聊天侧栏的工作区标题行（与终端形态同一排入口）", () => {
 it("标题行给出「新建工作区」与「添加项目」两枚键", async () => {
  const t = TEXT["zh-CN"];
  await open();
  expect(container.textContent).toContain(t.workspaceTitle);
  expect(container.querySelector(`button[aria-label="${t.wsGroupNew}"]`), "新建工作区").not.toBeNull();
  expect(container.querySelector(`button[aria-label="${t.sidebarAddProjectAria}"]`), "添加项目").not.toBeNull();
 });

 it("点「新建工作区」打开同一个对话框；建完左栏立刻出现新段与其成员", async () => {
  const t = TEXT["zh-CN"];
  await open();
  expect(container.textContent).not.toContain("数据组");

  // 建完工作区后端的两个变化：项目归属改了、工作区清单多一组
  mock.createWorkspace.mockResolvedValue({ id: "w2", name: "数据组", createdAt: 0, projectIds: ["p2"] });
  mock.listProjects.mockResolvedValue([P1, { ...P2, workspaceId: "w2" }]);
  mock.listWorkspaces.mockResolvedValue([
   { id: "w1", name: "全栈", createdAt: 0, projectIds: ["p1"] },
   { id: "w2", name: "数据组", createdAt: 0, projectIds: ["p2"] },
  ]);

  await click(container.querySelector<HTMLButtonElement>(`button[aria-label="${t.wsGroupNew}"]`));
  const nameInput = container.querySelector<HTMLInputElement>(`input[placeholder="${t.wsGroupNamePlaceholder}"]`);
  expect(nameInput, "点标题行的 Layers 应打开工作区对话框").not.toBeNull();
  await fill(nameInput, "数据组");
  const beta = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((b) =>
   (b.closest("label")?.textContent ?? "").includes("beta"),
  );
  await click(beta);
  expect(beta?.checked, "勾选成员项目").toBe(true);
  await click([...container.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === t.wsGroupCreate));

  expect(mock.createWorkspace).toHaveBeenCalledWith("数据组", ["p2"]);
  // 项目行必须重拉：归属没刷新的话新组在聊天左栏是「没有成员的空组」，按口径不占段
  expect(mock.listProjects, "建完要重拉项目行").toHaveBeenCalled();
  const created = [...container.querySelectorAll("details.group\\/ws")].find((s) => (s.textContent ?? "").includes("数据组"));
  expect(created, "新工作区应作为分段出现在左栏").not.toBeUndefined();
  expect(created?.textContent).toContain("beta");
  // 对话框建完即关
  expect(container.querySelector(`input[placeholder="${t.wsGroupNamePlaceholder}"]`)).toBeNull();
 });
});
