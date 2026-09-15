// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { fmt, TEXT } from "../../lib/locale";
import { WorkspaceGroupSection } from "./WorkspaceGroupSection";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@shared/api", () => ({
 api: { deleteWorkspace: vi.fn(async () => undefined) },
}));

const GROUP: WorkspaceView = { id: "g1", name: "全栈", createdAt: 1, projectIds: [] };
const t = TEXT["zh-CN"];

let container: HTMLDivElement;
let root: Root;
const edited = vi.fn();
const changed = vi.fn(async () => undefined);

beforeEach(() => {
 vi.clearAllMocks();
 useApp.setState({ locale: "zh-CN", selection: null });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

function render(group: WorkspaceView | null = GROUP): void {
 act(() => {
  root.render(
   <WorkspaceGroupSection
    group={group}
    projects={[]}
    itemsFor={() => []}
    onEdit={group === null ? null : edited}
    onChanged={changed}
    onError={() => undefined}
    onOpenSessions={() => undefined}
    dragActive={false}
    draggingId={null}
    dropTarget={null}
    onDragStart={() => undefined}
   />,
  );
 });
}

/** 组头的行内悬浮动作键（V43：hover 图标，DOM 常驻、opacity 切换——按 aria-label 找）。 */
function action(label: string): HTMLButtonElement {
 const el = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
 if (!el) throw new Error(`行内动作键不存在：${label}`);
 return el;
}

describe("工作区组头的行内悬浮图标（V43）", () => {
 it("编辑键直接开对话框（onEdit 收到本组）", () => {
  render();
  act(() => action(fmt(t.wsGroupEditTitle, "全栈")).click());
  expect(edited).toHaveBeenCalledWith(GROUP);
 });

 it("删除键走二次确认，确认后调用 delete_workspace 并刷新", async () => {
  render();
  act(() => action(t.wsGroupDelete).click());

  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute("aria-label")).toBe("删除工作区「全栈」？");
  const confirm = [...dialog.querySelectorAll("button")].at(-1)!;
  await act(async () => {
   confirm.click();
  });
  expect(api.deleteWorkspace).toHaveBeenCalledWith("g1");
  expect(changed).toHaveBeenCalled();
 });

 it("「未分组」区（group = null）不渲染行内动作键", () => {
  render(null);
  expect(container.querySelector(`button[aria-label="${t.wsGroupDelete}"]`)).toBeNull();
  expect(container.querySelector(`button[aria-label="${fmt(t.wsGroupEditTitle, "")}"]`)).toBeNull();
 });
});
