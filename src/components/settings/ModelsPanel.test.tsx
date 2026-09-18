// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { ModelInfo, ModelRolesInfo } from "@shared/types";
import { useApp } from "../../stores/app";
import { ModelsPanel } from "./ModelsPanel";

/**
 * 「omp 里改完，切回设置页就能看到」这条契约：设置标签重新激活（从终端标签切回来）时，
 * 模型角色要重新读一遍 omp 全局配置——此前只在组件挂载时读一次，切标签回来看到的还是旧值。
 */

const CR = { slow: "y/gpt-5.6-astra:auto:medium" };
const h = vi.hoisted(() => ({
 roleCalls: 0,
 roles: { slow: "y/gpt-5.6-astra:auto:medium" } as Record<string, string>,
 models: [] as ModelInfo[],
 chains: {} as Record<string, string[]>,
 cycleOrder: [] as string[],
}));

vi.mock("@shared/api", () => ({
 api: {
  getModelRoles: vi.fn(async () => {
   h.roleCalls += 1;
   return {
    roles: { ...h.roles },
    storage: "global",
    builtin: ["default", "smol", "slow", "vision", "plan", "commit", "tiny", "task", "advisor"],
   };
  }),
  getFallbackChains: vi.fn(async () => ({ chains: h.chains, modelFallback: true, revertPolicy: "cooldown-expiry" })),
  getCycleOrder: vi.fn(async () => [...h.cycleOrder]),
  setCycleOrder: vi.fn(async (order: string[]) => {
   h.cycleOrder = order;
   return [...order];
  }),
  getModels: vi.fn(async () => ({ models: h.models, fetchedAt: 0 })),
  refreshModels: vi.fn(async () => ({ models: h.models, fetchedAt: 0 })),
  setRetryOptions: vi.fn(async (modelFallback: boolean, revertPolicy: string) => ({ chains: h.chains, modelFallback, revertPolicy })),
  listProviders: vi.fn(async () => []),
  readModelsConfig: vi.fn(async () => ({ path: "/tmp/models.yml", exists: false, text: "", hash: "" })),
  getProviderLogin: vi.fn(async () => ({ provider: "", running: false, url: null, lines: [], done: null })),
 },
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => { }) }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn(async () => { }) }));

/** React 19 的 `act` 要求显式声明测试环境，否则每次调用都打警告。 */
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 h.roleCalls = 0;
 h.roles = { ...CR };
 h.models = [];
 h.chains = {};
 h.cycleOrder = [];
 useApp.setState({ settingsTabActive: true, models: null, myModels: [], locale: "zh-CN" });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

/** 冲掉 `load()` 的 promise 链（多处 setState）——两次宏任务足够。 */
const flush = async () => {
 await act(async () => {
  await delay(0);
  await delay(0);
 });
};

describe("ModelsPanel 的 omp 侧识别", () => {
 it("挂载时读一次 omp 角色；设置标签重新激活时再读一次（切回来看得到 omp 的新值）", async () => {
  act(() => {
   root.render(<ModelsPanel />);
  });
  await flush();
  expect(h.roleCalls).toBe(1);
  expect(container.textContent).toContain("y/gpt-5.6-astra:auto");

  // 模拟「在终端标签里的 omp 改了角色」：omp 侧的值变了，本组件不知情
  h.roles = { slow: "opencode-go/deepseek-v4.1-flash:low" };
  act(() => useApp.setState({ settingsTabActive: false }));
  expect(h.roleCalls).toBe(1);
  act(() => useApp.setState({ settingsTabActive: true }));
  await flush();

  expect(h.roleCalls).toBe(2);
  expect(container.textContent).toContain("opencode-go/deepseek-v4.1-flash");
  expect(container.textContent).not.toContain("y/gpt-5.6-astra:auto");
 });

 it("未激活时不读（设置标签隐藏期间不打扰 omp）", async () => {
  useApp.setState({ settingsTabActive: false });
  act(() => {
   root.render(<ModelsPanel />);
  });
  await flush();
  expect(h.roleCalls).toBe(0);
 });

 it("已配置但未星标的角色仍按完整目录判断思考能力", async () => {
  h.models = [
   { provider: "demo", id: "plain", selector: "demo/plain", name: "Plain", contextWindow: 1000, maxTokens: 100, reasoning: false, thinking: [], input: ["text"] },
   { provider: "demo", id: "reason", selector: "demo/reason", name: "Reason", contextWindow: 1000, maxTokens: 100, reasoning: true, thinking: ["low", "high"], input: ["text"] },
  ];
  h.roles = { default: "demo/plain" };
  useApp.setState({ myModels: ["demo/reason"] });
  act(() => root.render(<ModelsPanel />));
  await flush();
  expect(container.querySelector('[aria-label="设置 默认 的思考档位"]')).toBeNull();
  act(() => (container.querySelector('[aria-label="选择 默认"]') as HTMLButtonElement).click());
  expect(container.querySelector('[title="demo/reason"]')).not.toBeNull();
  expect(container.querySelector('[title="demo/plain"]')).toBeNull();
 });

 it("较早的角色读取晚返回时不能覆盖重新激活后的配置", async () => {
  // 项目目标为 ES2021，没有 Promise.withResolvers。
  let finish!: (value: ModelRolesInfo) => void;
  vi.mocked(api.getModelRoles).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  act(() => root.render(<ModelsPanel />));
  await flush();
  h.roles = { slow: "demo/current" };
  act(() => useApp.setState({ settingsTabActive: false }));
  act(() => useApp.setState({ settingsTabActive: true }));
  await flush();
  await act(async () => finish({ roles: { slow: "demo/stale" }, storage: "global", builtin: ["slow"] }));
  await flush();
  expect(container.textContent).toContain("demo/current");
  expect(container.textContent).not.toContain("demo/stale");
 });

 it("快速切换环：添加 / 上移 / 移除都按当前顺序整组写回", async () => {
  h.cycleOrder = ["default", "smol"];
  act(() => root.render(<ModelsPanel />));
  await flush();
  const section = container.querySelector('[aria-label="快速切换环"]')!;
  expect(section.textContent).toContain("默认");
  expect(section.textContent).toContain("快速");

  const lastWrite = () => {
   const calls = vi.mocked(api.setCycleOrder).mock.calls;
   return calls[calls.length - 1][0];
  };
  const click = (label: string) =>
   act(() => (section.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement).click());

  // 添加 slow（候选里点「深思」）→ 追加到末尾
  act(() => [...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === "添加角色")!.click());
  act(() => [...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === "深思")!.click());
  await flush();
  expect(lastWrite()).toEqual(["default", "smol", "slow"]);

  // 上移 slow → 换到中间
  click("上移 深思");
  await flush();
  expect(lastWrite()).toEqual(["default", "slow", "smol"]);

  // 移出 default → 只剩两个
  click("移出环 默认");
  await flush();
  expect(lastWrite()).toEqual(["slow", "smol"]);
 });

 it("新建转移链排除已配置模型，切换总开关不丢失草稿", async () => {
  h.models = ["first", "second"].map((id) => ({ provider: "demo", id, selector: `demo/${id}`, name: id, contextWindow: 1000, maxTokens: 100, reasoning: false, thinking: [], input: ["text"] }));
  h.chains = { "demo/first": ["demo/second"] };
  act(() => root.render(<ModelsPanel />));
  await flush();
  const section = container.querySelector('[aria-label="失败转移"]')!;
  const clickText = (text: string) => act(() => [...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === text)!.click());
  clickText("添加转移链");
  act(() => (section.querySelector('fieldset [role="radio"][aria-checked="false"]') as HTMLButtonElement).click());
  expect(section.querySelector('[title="demo/first"]')).toBeNull();
  act(() => (section.querySelector('[title="demo/second"]') as HTMLButtonElement).click());
  clickText("添加目标");
  act(() => (section.querySelector('[title="demo/first"]') as HTMLButtonElement).click());
  act(() => (section.querySelector('[role="switch"]') as HTMLButtonElement).click());
  await flush();
  expect(section.querySelector("fieldset")?.textContent).toContain("demo/second");
  expect(section.querySelector("fieldset")?.textContent).toContain("demo/first");
  expect([...section.querySelectorAll("button")].find((b) => b.textContent?.trim() === "创建")?.disabled).toBe(false);
 });
});
