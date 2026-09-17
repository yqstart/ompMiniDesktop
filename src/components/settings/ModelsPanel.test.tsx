// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  getFallbackChains: vi.fn(async () => ({ chains: {}, modelFallback: true, revertPolicy: "cooldown-expiry" })),
  getModels: vi.fn(async () => ({ models: [], fetchedAt: 0 })),
  refreshModels: vi.fn(async () => ({ models: [], fetchedAt: 0 })),
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
 useApp.setState({ settingsTabActive: true, models: null });
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
});
