// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useApp } from "../../stores/app";
import { TerminalTabs } from "./TerminalTabs";

/**
 * 标签栏右上角两枚键（V15 入口搬迁后的口径）：
 * - 左 `＋`（新建终端）、右「供应商用量」——顺序是产品口径，换位要改这里；
 * - 「供应商用量」键直接开弹窗（不再经过设置页）；
 * - 设置标签与终端标签的显隐语义不变（那部分由 App / 标签测试覆盖）。
 */

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({
  terminals: [],
  checkouts: [],
  workspaceGroups: [],
  projects: [],
  selection: null,
  activeTerminalId: null,
  settingsTabOpen: false,
  settingsTabActive: false,
  providerUsageOpen: false,
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

function render() {
 act(() => {
  root.render(<TerminalTabs />);
 });
}

describe("标签栏右上角", () => {
 it("「供应商用量」键打开用量弹窗", () => {
  render();
  const key = container.querySelector<HTMLButtonElement>('button[aria-label="供应商用量"]');
  expect(key).not.toBeNull();
  act(() => {
   key?.click();
  });
  expect(useApp.getState().providerUsageOpen).toBe(true);
 });

 it("顺序：新建终端在前、供应商用量在后（最右）", () => {
  render();
  const labels = [...container.querySelectorAll<HTMLButtonElement>("button[aria-label]")].map((b) =>
   b.getAttribute("aria-label"),
  );
  const newIndex = labels.indexOf("新建终端");
  const usageIndex = labels.indexOf("供应商用量");
  expect(newIndex).toBeGreaterThanOrEqual(0);
  expect(usageIndex).toBeGreaterThan(newIndex);
  expect(usageIndex).toBe(labels.length - 1);
 });
});
