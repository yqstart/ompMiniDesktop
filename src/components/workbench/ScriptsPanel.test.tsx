// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptCatalog } from "@shared/types";
import { useApp } from "../../stores/app";
import { TEXT } from "../../lib/locale";

/**
 * 右栏「脚本」页签（V43）：识别结果渲染、点行在终端里跑（投递到 store）、自定义脚本增删改。
 * 后端识别整块 mock——本用例只验证面板的取数口径与交互。
 */
const { apiMock } = vi.hoisted(() => ({ apiMock: { discoverScripts: vi.fn() } }));
vi.mock("@shared/api", () => ({ api: apiMock }));

import { ScriptsPanel } from "./ScriptsPanel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const zh = TEXT["zh-CN"];
const CWD = "/w/alpha";

const catalog = (over: Partial<ScriptCatalog> = {}): ScriptCatalog => ({
 cwd: CWD,
 ecosystems: ["Node (pnpm)"],
 scripts: [
  { name: "dev", command: "pnpm run dev", source: "package.json" },
  { name: "build", command: "pnpm run build", source: "package.json" },
 ],
 ...over,
});

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 vi.clearAllMocks();
 apiMock.discoverScripts.mockResolvedValue(catalog());
 useApp.setState({
  locale: "zh-CN",
  customScripts: {},
  pendingTerminalRun: null,
  terminalRunSeq: 0,
  workbenchOpen: false,
  workbenchTab: "files",
 });
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
});

async function render(visible = true) {
 await act(async () => {
  root.render(<ScriptsPanel cwd={CWD} visible={visible} />);
 });
}

/** 受控输入要经原生 setter + input 事件，React 才认这次改动。 */
function setInput(el: HTMLInputElement, value: string) {
 const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
 setter?.call(el, value);
 el.dispatchEvent(new Event("input", { bubbles: true }));
}

function buttonByLabel(label: string): HTMLButtonElement | null {
 return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
}

describe("ScriptsPanel", () => {
 it("显示识别到的生态与项目脚本（带来源）", async () => {
  await render();
  expect(apiMock.discoverScripts).toHaveBeenCalledWith(CWD);
  expect(container.textContent).toContain("Node (pnpm)");
  expect(container.textContent).toContain("dev");
  expect(container.textContent).toContain("pnpm run dev");
  expect(container.textContent).toContain("package.json");
 });

 it("点脚本行 = 投递到该目录的终端（顺带展开右栏并切到终端页签）", async () => {
  await render();
  const row = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("pnpm run build"));
  await act(async () => {
   row?.click();
  });
  const pending = useApp.getState().pendingTerminalRun;
  expect(pending?.cwd).toBe(CWD);
  expect(pending?.command).toBe("pnpm run build");
  expect(useApp.getState().workbenchTab).toBe("terminal");
  expect(useApp.getState().workbenchOpen).toBe(true);
 });

 it("页签没显示过就不扫描项目", async () => {
  await render(false);
  expect(apiMock.discoverScripts).not.toHaveBeenCalled();
 });

 it("没有识别到脚本时给支持清单的空态", async () => {
  apiMock.discoverScripts.mockResolvedValue(catalog({ ecosystems: [], scripts: [] }));
  await render();
  expect(container.textContent).toContain(zh.scriptsEmpty);
 });

 it("识别失败只落一行失败提示，不抛到界面", async () => {
  apiMock.discoverScripts.mockRejectedValue(new Error("EACCES"));
  await render();
  expect(container.textContent).toContain(zh.scriptsDetectFailed);
 });

 it("新建自定义脚本：写进偏好并可再次运行", async () => {
  await render();
  await act(async () => {
   buttonByLabel(zh.scriptsNew)?.click();
  });
  const inputs = [...container.querySelectorAll<HTMLInputElement>("input")];
  expect(inputs).toHaveLength(2);
  await act(async () => {
   setInput(inputs[0], "起开发服务");
   setInput(inputs[1], "pnpm tauri:dev");
  });
  const save = [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === zh.scriptsSave);
  await act(async () => {
   save?.click();
  });
  const saved = useApp.getState().customScripts[CWD];
  expect(saved).toHaveLength(1);
  expect(saved[0]).toMatchObject({ name: "起开发服务", command: "pnpm tauri:dev" });
  // 表单收起、行出现，点行同样投递
  expect(container.textContent).toContain("起开发服务");
  const row = [...container.querySelectorAll("button")].find((b) => b.textContent?.includes("pnpm tauri:dev"));
  await act(async () => {
   row?.click();
  });
  expect(useApp.getState().pendingTerminalRun?.command).toBe("pnpm tauri:dev");
 });

 it("删除自定义脚本：行从偏好里消失", async () => {
  useApp.setState({ customScripts: { [CWD]: [{ id: "s1", name: "起服务", command: "pnpm dev" }] } });
  await render();
  await act(async () => {
   buttonByLabel(zh.scriptsDelete)?.click();
  });
  expect(useApp.getState().customScripts[CWD]).toBeUndefined();
  expect(container.textContent).not.toContain("起服务");
 });
});
