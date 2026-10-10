// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { WorkspaceView } from "@shared/types";
import { useApp } from "../../stores/app";
import { ContextMenuProvider } from "../ContextMenu";
import { WorkspaceGroupSection } from "./WorkspaceGroupSection";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@shared/api", () => ({
 api: { deleteWorkspace: vi.fn(async () => undefined) },
}));

const GROUP: WorkspaceView = { id: "g1", name: "全栈", createdAt: 1, projectIds: [] };

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

function render(): void {
 act(() => {
  root.render(
   <ContextMenuProvider>
    <WorkspaceGroupSection
     group={GROUP}
     projects={[]}
     itemsFor={() => []}
     onEdit={edited}
     onChanged={changed}
     onError={() => undefined}
     onOpenSessions={() => undefined}
     dragActive={false}
     draggingId={null}
     dropTarget={null}
     onDragStart={() => undefined}
    />
   </ContextMenuProvider>,
  );
 });
}

/** 右键组头（section 的第一个子 div）。 */
function rightClickHead(): void {
 const head = container.querySelector<HTMLElement>("section > div")!;
 act(() => head.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })));
}

function menuItem(label: string): HTMLButtonElement {
 // 图标 svg 里可能带空白文本节点（reicon 图标数据自带），textContent 比较前统一 trim
 const item = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((el) => el.textContent?.trim() === label);
 if (!item) throw new Error(`菜单项不存在：${label}`);
 return item;
}

describe("工作区组头的右键菜单（2026-10-10）", () => {
 it("右键菜单 = 编辑工作区… + 删除工作区；「编辑工作区…」直接开对话框", () => {
  render();
  rightClickHead();
  expect([...document.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent?.trim())).toEqual(["编辑工作区…", "删除工作区"]);
  act(() => menuItem("编辑工作区…").click());
  expect(edited).toHaveBeenCalledWith(GROUP);
 });

 it("「删除工作区」走二次确认，确认后调用 delete_workspace 并刷新", async () => {
  render();
  rightClickHead();
  act(() => menuItem("删除工作区").click());

  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.getAttribute("aria-label")).toBe("删除工作区「全栈」？");
  const confirm = [...dialog.querySelectorAll("button")].at(-1)!;
  await act(async () => {
   confirm.click();
  });
  expect(api.deleteWorkspace).toHaveBeenCalledWith("g1");
  expect(changed).toHaveBeenCalled();
 });

 it("「未分组」区（group = null）右键不弹菜单", () => {
  act(() => {
   root.render(
    <ContextMenuProvider>
     <WorkspaceGroupSection
      group={null}
      projects={[]}
      itemsFor={() => []}
      onEdit={null}
      onChanged={changed}
      onError={() => undefined}
      onOpenSessions={() => undefined}
      dragActive={false}
      draggingId={null}
      dropTarget={null}
      onDragStart={() => undefined}
     />
    </ContextMenuProvider>,
   );
  });
  rightClickHead();
  expect(document.querySelector('[role="menu"]')).toBeNull();
 });
});
