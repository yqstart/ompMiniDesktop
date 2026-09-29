// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckoutView, ProjectView, TerminalView } from "@shared/types";
import { useApp } from "../../stores/app";
import { ProjectGroup } from "./ProjectGroup";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT: ProjectView = { id: "p1", path: "/a", name: "frontend", missing: false, sessionCount: 0, workspaceId: "w1" };
const MAIN: CheckoutView = { projectId: "p1", projectName: "frontend", path: "/a", branch: "main", head: null, isMain: true, missing: false };
const LOGIN: CheckoutView = { ...MAIN, path: "/a-login", branch: "login", isMain: false };

const term = (id: string, cwd: string): TerminalView => ({
 id,
 projectId: "p1",
 cwd,
 label: id,
 title: null,
 state: "unknown",
 status: "running",
 exitCode: null,
 resume: null,
 collab: [],
 spawnSeq: 0,
 createdAt: 1,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
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
   <ProjectGroup
    project={PROJECT}
    items={[MAIN, LOGIN]}
    dragging={false}
    onChanged={async () => undefined}
    onError={() => undefined}
    onOpenSessions={() => undefined}
    onDragStart={() => undefined}
   />,
  );
 });
}

/** 被标出的目录行（行标记 = `aria-current`，按行的 title（= 目录路径）读回）。 */
function markedPaths(): string[] {
 return [...container.querySelectorAll<HTMLElement>('[aria-current="location"]')].map((el) => el.title);
}

describe("目录行的行标记（选中 / 终端在这里）", () => {
 it("工作区视图下：激活终端所在的目录行上选中样式（选中态在组头，不缩窄视图）", () => {
  useApp.setState({
   selection: { kind: "group", id: "w1" },
   terminals: [term("t1", "/a-login")],
   activeTerminalId: "t1",
  });
  render();
  expect(markedPaths()).toEqual(["/a-login"]);
  expect(container.querySelector<HTMLElement>('[title="/a-login"]')?.className).toContain("bg-active");
  expect(container.querySelector<HTMLElement>('[title="/a"]')?.className).not.toContain("bg-active");
 });

 it("激活终端不在本项目的目录里：一行都不标（不做前缀 / 模糊匹配）", () => {
  useApp.setState({
   selection: { kind: "group", id: "w1" },
   terminals: [term("t9", "/a-login/deeper"), term("t8", "/other")],
   activeTerminalId: "t9",
  });
  render();
  expect(markedPaths()).toEqual([]);
 });

 it("目录视图：没有终端时选中行照旧标出（范围可见，不因无终端熄灭）", () => {
  useApp.setState({
   selection: { kind: "checkout", path: "/a" },
   terminals: [],
   activeTerminalId: null,
  });
  render();
  expect(markedPaths()).toEqual(["/a"]);
 });
});
