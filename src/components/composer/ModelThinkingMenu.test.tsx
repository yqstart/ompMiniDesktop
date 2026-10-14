// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { ModelInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { ModelThinkingMenu } from "./ModelThinkingMenu";

/**
 * 模型 · 思考档合并菜单（v2）的选单分区（与设置页模型弹窗同一份口径，
 * `lib/myModels.ts` 的 `splitStarredModels`）：**我的模型**置顶成组、星标项不在供应商组里重复出现；
 * 每行行首的星标可即时加 / 摘（只改分区、不收窄候选）；思考档段只列支持档。
 */

const m = (provider: string, id: string): ModelInfo => ({
 provider,
 id,
 selector: `${provider}/${id}`,
 name: id,
 contextWindow: 128000,
 maxTokens: null,
 reasoning: null,
 thinking: null,
 input: ["text"],
});

const CATALOG = [m("demo", "plain"), m("demo", "reason"), m("other", "flash")];

vi.mock("@shared/api", () => ({
 api: {
  getModels: vi.fn(async () => ({ models: CATALOG, fetchedAt: 0 })),
  refreshModels: vi.fn(async () => ({ models: CATALOG, fetchedAt: 0 })),
  setModel: vi.fn(async () => { }),
  setThinking: vi.fn(async () => { }),
  getGlobalApproval: vi.fn(async () => "write"),
 },
}));

/** React 19 的 `act` 要求显式声明测试环境，否则每次调用都打警告。 */
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({
  models: { models: CATALOG, fetchedAt: 0 },
  composerMenu: "model", // 直接开下拉，省掉点击触发按钮这一步
  currentModel: null,
  activeSessionId: null,
  myModels: [],
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

/** 下拉里的分区标题（我的模型 + 各供应商）与行顺序。 */
const headers = () => [...container.querySelectorAll("div.px-1.pt-2")].map((el) => el.textContent);
const rows = () => [...container.querySelectorAll('button[aria-label^="使用模型"]')].map((el) => el.getAttribute("aria-label"));

describe("模型 · 思考档合并菜单", () => {
 it("我的模型置顶成组、星标项不在供应商组里重复出现；行首星标即时加 / 摘", () => {
  useApp.setState({ myModels: ["other/flash"] });
  act(() => {
   root.render(<ModelThinkingMenu />);
  });
  // 我的模型（按挑选顺序）在前，其余按供应商分组、目录原序；flash 不在 other 组里重复出现
  // （other 只有这一个模型，全被星标后该组直接消失）
  expect(headers()).toEqual(["我的模型", "demo"]);
  expect(rows()).toEqual(["使用模型 flash", "使用模型 plain", "使用模型 reason"]);

  // 行首星标 = 加入 / 移出「我的模型」（同一份 localStorage 偏好），分区即时跟着变
  act(() => (container.querySelector('[aria-label="加入我的模型 plain"]') as HTMLButtonElement).click());
  expect(useApp.getState().myModels).toEqual(["other/flash", "demo/plain"]);
  expect(rows()).toEqual(["使用模型 flash", "使用模型 plain", "使用模型 reason"]);
  act(() => (container.querySelector('[aria-label="移出我的模型 flash"]') as HTMLButtonElement).click());
  expect(useApp.getState().myModels).toEqual(["demo/plain"]);
  expect(headers()).toEqual(["我的模型", "demo", "other"]);
  expect(rows()).toEqual(["使用模型 plain", "使用模型 reason", "使用模型 flash"]);
 });

 it("没有星标时只列供应商组（不出现空的「我的模型」段）", () => {
  act(() => {
   root.render(<ModelThinkingMenu />);
  });
  expect(headers()).toEqual(["demo", "other"]);
  expect(rows()).toEqual(["使用模型 plain", "使用模型 reason", "使用模型 flash"]);
 });

 it("搜索过滤同样按分区排（星标命中在前），点选行按 provider/id 走 IPC", async () => {
  useApp.setState({ myModels: ["other/flash"], activeSessionId: "s1" });
  act(() => {
   root.render(<ModelThinkingMenu />);
  });
  const input = container.querySelector("#model-search") as HTMLInputElement;
  // React 受控输入的 value 要走原型 setter，再派发 input 事件才会进 onChange
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
   setter.call(input, "l"); // 命中 plain（demo）与 flash（other，已星标）
   input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(rows()).toEqual(["使用模型 flash", "使用模型 plain"]);
  expect(headers()).toEqual(["我的模型", "demo"]);

  act(() => (container.querySelector('[aria-label="使用模型 plain"]') as HTMLButtonElement).click());
  await act(async () => { await delay(0); });
  expect(vi.mocked(api.setModel)).toHaveBeenCalledWith("s1", "demo", "plain");
  expect(useApp.getState().composerMenu).toBeNull();
 });

 it("思考档段：只列当前模型支持的档位，点击下发 set_thinking_level 并标记当前档", async () => {
  useApp.setState({
   activeSessionId: "s1",
   currentModel: "demo/reason",
   currentEfforts: ["low", "high"],
   currentThinking: "high",
  });
  act(() => {
   root.render(<ModelThinkingMenu />);
  });
  const levelBtns = [...container.querySelectorAll<HTMLButtonElement>('button[aria-label^="思考等级"]')];
  expect(levelBtns.map((b) => b.textContent)).toEqual(["off", "low", "high"]);
  // 当前档（high）打勾：aria-pressed 表达选中
  expect(levelBtns[2].getAttribute("aria-pressed")).toBe("true");

  act(() => levelBtns[1].click());
  await act(async () => { await delay(0); });
  expect(vi.mocked(api.setThinking)).toHaveBeenCalledWith("s1", "low");
  expect(useApp.getState().currentThinking).toBe("low");
  expect(useApp.getState().composerMenu).toBeNull();
 });
});
