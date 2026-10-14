// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ViewMsg } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";
import { ContextPanel } from "./ContextPanel";

/**
 * 右栏区块导航（v2）：点浮层里的区块名要把**右栏自己的滚动容器**滚到该区块。
 *
 * 这条口径是从用户实测的「点一下来源，整个中列/输入框位置就乱了」反推出来的：
 * 曾经的 `scrollIntoView` 会连带滚祖先链上任何可程序化滚动的容器（`main` 是
 * `overflow: hidden`、`document` 也是），一旦祖先有可滚内容，点导航就把工作区推偏。
 * jsdom 里没有真实布局（rect 全 0），所以这里守的是**动作落点**：
 * 滚的是右栏 body 自己、且任何元素都不得调用 `scrollIntoView`。
 *
 * 目标区块的定位精度（`scroll-mt-2` 的 8px 偏移）在真实 WebView 里另做了实测。
 */

const t = TEXT["zh-CN"];
const cwd = "/tmp/proj";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** 会话里读过文件，右栏「来源」区块才渲染；没有来源时导航点它是静默无动作。 */
const MSGS: ViewMsg[] = [
  { kind: "user", id: "u1", text: "看一遍实现", mentions: [] },
  {
    kind: "tool",
    id: "t1",
    toolCallId: "c1",
    name: "read",
    intent: "",
    argsSummary: "src/index.css",
    state: "ok",
    output: "ok",
    streamIndex: 0,
    path: `${cwd}/src/index.css`,
  },
];

let container: HTMLDivElement;
let root: Root;
let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  scrollIntoView = vi.fn();
  Element.prototype.scrollIntoView = scrollIntoView as never;
  Element.prototype.scrollTo = vi.fn() as never;
  useApp.setState({
    locale: "zh-CN",
    theme: "dark",
    projects: [{ id: "p1", path: cwd, name: "proj", missing: false, sessionCount: 1, workspaceId: null }],
    sessions: [
      {
        id: "s1",
        projectId: "p1",
        title: "会话",
        cwd,
        timestamp: 0,
        archived: false,
        corrupt: false,
        note: null,
        running: false,
      },
    ],
    activeSessionId: "s1",
    eventsBySession: { s1: MSGS },
    statusBySession: { s1: { state: "idle" } },
    contextPanelOpen: true,
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<ContextPanel />);
  });
  await act(async () => {});
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("ContextPanel 区块导航", () => {
  it("点「来源」只滚右栏自己的滚动容器，不触发 scrollIntoView", () => {
    const nav = container.querySelector<HTMLButtonElement>(`button[aria-label="${t.panelSectionsAria}"]`);
    expect(nav).not.toBeNull();
    act(() => nav!.click());

    const item = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === t.panelSources);
    expect(item).toBeDefined();

    const section = container.querySelector<HTMLElement>("#panel-sources");
    expect(section).not.toBeNull();
    const body = section!.parentElement as HTMLElement;
    const scrollTo = vi.fn();
    body.scrollTo = scrollTo as never;

    act(() => item!.click());

    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("区块没渲染时点导航静默无动作（不造空跳、不报错）", () => {
    act(() => {
      useApp.setState({ eventsBySession: { s1: [{ kind: "user", id: "u1", text: "hi", mentions: [] }] } });
    });
    const nav = container.querySelector<HTMLButtonElement>(`button[aria-label="${t.panelSectionsAria}"]`);
    act(() => nav!.click());
    const item = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === t.panelSources);
    expect(item).toBeDefined();
    act(() => item!.click());
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
