// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChangeFile, ChangeSet, DirEntry, DirListing } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";

/**
 * 右栏文件树（V42）：懒加载一层目录、变更标色、点文件交给系统打开、行尾「引用到输入框」。
 * 后端与系统打开都替换成 mock——本用例只验证前端的取数口径与交互。
 */
const { apiMock, openerMock } = vi.hoisted(() => ({
 apiMock: { listDir: vi.fn(), getChangeSet: vi.fn() },
 openerMock: { openPath: vi.fn(async () => {}), revealItemInDir: vi.fn(async () => {}) },
}));
vi.mock("@shared/api", () => ({ api: apiMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ ...openerMock, openUrl: vi.fn(async () => {}) }));

import { FileTree } from "./FileTree";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zh = TEXT["zh-CN"];
const ROOT = "/w/alpha";

const entry = (name: string, isDir: boolean): DirEntry => ({
 name,
 path: `${ROOT}/${name}`,
 isDir,
 isSymlink: false,
 size: isDir ? null : 12,
});

const listing = (path: string, entries: DirEntry[], repoRoot: string | null = ROOT): DirListing => ({
 path,
 parent: null,
 entries,
 truncated: false,
 repoRoot,
});

const changeSet = (files: Partial<ChangeFile>[]): ChangeSet => ({
 isRepo: true,
 branch: "main",
 head: null,
 upstream: null,
 upstreamGone: false,
 ahead: 0,
 behind: 0,
 files: files.map((f) => ({
  path: "a.ts",
  origPath: null,
  index: " ",
  worktree: "M",
  untracked: false,
  add: 1,
  del: 0,
  ...f,
 })),
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 vi.clearAllMocks();
 useApp.setState({
  locale: "zh-CN",
  activeSessionId: "s1",
  drafts: {},
  composerFocusSeq: 0,
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

async function render() {
 await act(async () => {
  root.render(<FileTree root={ROOT} />);
 });
}

/** 行按钮的文字里带图标与徽标，按「包含名字」找。 */
function rowByName(name: string): HTMLElement | null {
 return [...container.querySelectorAll<HTMLElement>("div.group")].find((d) => d.textContent?.includes(name)) ?? null;
}

describe("FileTree", () => {
 it("树根加载：列目录、按仓库根给改动文件打徽标", async () => {
  apiMock.listDir.mockResolvedValue(listing(ROOT, [entry("src", true), entry("a.ts", false)]));
  apiMock.getChangeSet.mockResolvedValue(changeSet([{ path: "a.ts", worktree: "M" }]));
  await render();
  expect(apiMock.listDir).toHaveBeenCalledWith(ROOT, true);
  expect(container.textContent).toContain("src");
  expect(rowByName("a.ts")?.textContent).toContain("M");
  // 没有改动的目录不带徽标
  expect(rowByName("src")?.textContent).not.toContain("M");
 });

 it("展开目录才取它的内容（懒加载，第二次调用不再带仓库根）", async () => {
  apiMock.listDir.mockImplementation(async (path: string) =>
   path === ROOT ? listing(ROOT, [entry("src", true)]) : listing(path, [entry("index.ts", false)]),
  );
  apiMock.getChangeSet.mockResolvedValue(changeSet([]));
  await render();
  expect(container.textContent).not.toContain("index.ts");
  act(() => rowByName("src")?.querySelector("button")?.click());
  await act(async () => {});
  expect(apiMock.listDir).toHaveBeenCalledWith(`${ROOT}/src`, false);
  expect(container.textContent).toContain("index.ts");
 });

 it("点文件交给系统默认程序打开", async () => {
  apiMock.listDir.mockResolvedValue(listing(ROOT, [entry("a.ts", false)]));
  apiMock.getChangeSet.mockResolvedValue(changeSet([]));
  await render();
  await act(async () => {
   rowByName("a.ts")?.querySelector("button")?.click();
  });
  expect(openerMock.openPath).toHaveBeenCalledWith(`${ROOT}/a.ts`);
 });

 it("行尾「引用到输入框」按 omp 提及语法写进当前会话草稿", async () => {
  apiMock.listDir.mockResolvedValue(listing(ROOT, [entry("a.ts", false)]));
  apiMock.getChangeSet.mockResolvedValue(changeSet([]));
  await render();
  const btn = rowByName("a.ts")?.querySelector<HTMLButtonElement>(`button[aria-label="${zh.filesInsertRef}"]`);
  expect(btn).toBeTruthy();
  act(() => btn?.click());
  expect(useApp.getState().drafts["s1"]).toBe(`@${ROOT}/a.ts `);
 });

 it("目录读不到时显示失败行，不抛到界面上", async () => {
  apiMock.listDir.mockRejectedValue(new Error("EACCES"));
  apiMock.getChangeSet.mockResolvedValue(changeSet([]));
  await render();
  expect(container.textContent).toContain(zh.filesLoadFailed);
 });
});
