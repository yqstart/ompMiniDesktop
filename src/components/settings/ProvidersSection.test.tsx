// @vitest-environment jsdom
import { setTimeout as delay } from "node:timers/promises";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { ModelInfo, ModelsConfigFile } from "@shared/types";
import { useApp } from "../../stores/app";
import { ProvidersSection } from "./ProvidersSection";

/**
 * 添加供应商的收口：自定义供应商**保存成功后直接开挑模型弹窗**（与登录成功后的就地挑选对齐），
 * 供应商区块内不再有自己的刷新按钮（页级唯一刷新在「模型」页头）。
 */

const h = vi.hoisted(() => ({
 models: [] as ModelInfo[],
 file: { path: "/tmp/models.yml", exists: false, text: "", hash: "" } as ModelsConfigFile,
 writes: 0,
}));

vi.mock("@shared/api", () => ({
 api: {
  listProviders: vi.fn(async () => []),
  readModelsConfig: vi.fn(async () => ({ ...h.file })),
  writeModelsConfig: vi.fn(async (text: string) => {
   h.writes += 1;
   h.file = { ...h.file, exists: true, text, hash: "h2" };
   return { ...h.file };
  }),
  getModels: vi.fn(async () => ({ models: h.models, fetchedAt: 0 })),
  refreshModels: vi.fn(async () => ({ models: h.models, fetchedAt: 0 })),
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
 h.models = [];
 h.file = { path: "/tmp/models.yml", exists: false, text: "", hash: "" };
 h.writes = 0;
 useApp.setState({ models: null, myModels: [], locale: "zh-CN" });
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

/** 受控输入：走原型 setter + input 事件（React 的 onChange 由 input 触发）。 */
const setInput = async (el: Element | null, value: string) => {
 const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
 await act(async () => {
  setter?.call(el, value);
  el?.dispatchEvent(new Event("input", { bubbles: true }));
 });
};

const byText = (text: string) =>
 [...container.querySelectorAll("button")].find((b) => b.textContent?.includes(text));

describe("添加供应商向导", () => {
 it("自定义保存成功后就地打开该供应商的挑模型弹窗（以新键为 id）", async () => {
  act(() => root.render(<ProvidersSection />));
  await flush();
  act(() => byText("添加供应商")!.click());
  // 第一步：选提供商（「自定义」是选择器首项）
  act(() => byText("自定义")!.click());
  // 自定义表单：名称 / 接口地址 / 模型 id 填完才可保存
  await setInput(container.querySelector('[placeholder="my-gateway"]'), "my-gw");
  await setInput(container.querySelector('[placeholder="https://gw.example.com/v1"]'), "https://gw.example.com/v1");
  await setInput(container.querySelector('[placeholder="model-id"]'), "m1");
  act(() => byText("保存")!.click());
  await flush();

  expect(h.writes).toBe(1);
  // 保存 → 页级刷新（目录）+ 就该供应商进行挑选：弹窗标题带新键
  const dialog = container.querySelector('[role="dialog"][aria-modal="true"]');
  expect(dialog).not.toBeNull();
  expect(dialog!.textContent).toContain("挑选 my-gw 的模型");
  expect(vi.mocked(api.refreshModels)).toHaveBeenCalled();
 });
});
