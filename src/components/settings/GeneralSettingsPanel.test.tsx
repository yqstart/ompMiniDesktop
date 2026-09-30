// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { OmpCatalogItem, OmpSettingsCatalog } from "@shared/types";
import { useApp } from "../../stores/app";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@shared/api", () => ({
 api: {
  getOmpSettingsCatalog: vi.fn(),
  listOmpThemes: vi.fn(),
  setOmpSetting: vi.fn(),
  resetOmpSetting: vi.fn(),
 },
}));

/** 造一项（默认 boolean true；测试只覆盖关心的字段）。 */
const catalogItem = (over: Partial<OmpCatalogItem>): OmpCatalogItem => ({
 key: "k",
 value: true,
 kind: "boolean",
 description: "",
 section: "tools",
 options: [],
 redacted: false,
 ...over,
});
const catalog = (items: OmpCatalogItem[]): OmpSettingsCatalog => ({ sections: ["tools"], items });

/** 冲掉 mock promise 链（load 里 catalog 与主题列表两条链都要落地）。 */
const flush = async () => {
 await act(async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
 });
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
 useApp.setState({ health: null, locale: "zh-CN" });
 vi.mocked(api.listOmpThemes).mockResolvedValue([]);
 container = document.createElement("div");
 document.body.append(container);
 root = createRoot(container);
});

afterEach(() => {
 act(() => root.unmount());
 container.remove();
 vi.mocked(api.getOmpSettingsCatalog).mockReset();
 vi.mocked(api.setOmpSetting).mockReset();
});

describe("设置页读取状态", () => {
 it("首次失败不显示伪设置行，可重试恢复", async () => {
  vi.mocked(api.getOmpSettingsCatalog)
   .mockRejectedValueOnce(new Error("boom"))
   .mockResolvedValueOnce(catalog([catalogItem({ key: "todo.enabled" })]));
  act(() => {
   root.render(<GeneralSettingsPanel />);
  });
  await flush();
  expect(container.textContent).toContain("boom");
  expect(container.textContent).not.toContain("任务清单"); // 失败时不画伪设置行
  act(() => {
   container.querySelectorAll("button").forEach((button) => {
    if (button.textContent === "重试") button.click();
   });
  });
  await flush();
  expect(container.textContent).not.toContain("boom");
  expect(container.textContent).toContain("任务清单");
 });

 it("搜索过滤、清空后恢复", async () => {
  vi.mocked(api.getOmpSettingsCatalog).mockResolvedValue(
   catalog([
    catalogItem({ key: "todo.enabled" }),
    catalogItem({ key: "bash.enabled", section: "shell" }),
   ]),
  );
  act(() => {
   root.render(<GeneralSettingsPanel />);
  });
  await flush();
  expect(container.textContent).toContain("任务清单");
  expect(container.textContent).toContain("终端命令");

  const input = container.querySelector("input")!;
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
   setter?.call(input, "todo");
   input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("任务清单");
  expect(container.textContent).not.toContain("终端命令");

  act(() => {
   setter?.call(input, "");
   input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.textContent).toContain("任务清单");
  expect(container.textContent).toContain("终端命令");
 });
});

describe("枚举设置", () => {
 /** 真实点击序列：`pointerdown` 与 `click` 都派发（jsdom 不会自己生成）。 */
 function click(element: Element) {
  act(() => {
   element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
   element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
 }

 const thinking = catalogItem({
  key: "defaultThinkingLevel",
  value: "medium",
  kind: "enum",
  description: "thinking",
  section: "model",
  options: ["minimal", "low", "medium", "high", "xhigh", "max", "auto"],
 });

 it("选项在浮层里，选中后写回 omp 并收起", async () => {
  vi.mocked(api.getOmpSettingsCatalog).mockResolvedValue(catalog([thinking]));
  vi.mocked(api.setOmpSetting).mockResolvedValue({
   key: "defaultThinkingLevel",
   value: "high",
   kind: "enum",
   description: "thinking",
  });
  act(() => {
   root.render(<GeneralSettingsPanel />);
  });
  await flush();

  const trigger = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "medium");
  if (!trigger) throw new Error("枚举触发按钮没渲染出来");
  click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("true");
  // 选项挂在 body 的浮层里：设置页自己的文档流不出现这一块（不把后面的设置推走）
  expect(document.body.textContent).toContain("xhigh");
  expect(container.textContent).not.toContain("xhigh");

  const option = Array.from(document.body.querySelectorAll("button")).find((b) => b.textContent === "high");
  if (!option) throw new Error("浮层里的选项没渲染出来");
  click(option);
  await flush();
  expect(api.setOmpSetting).toHaveBeenCalledWith("defaultThinkingLevel", "high");
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
 });

 it("再点触发按钮收起", async () => {
  vi.mocked(api.getOmpSettingsCatalog).mockResolvedValue(catalog([thinking]));
  act(() => {
   root.render(<GeneralSettingsPanel />);
  });
  await flush();
  const trigger = Array.from(container.querySelectorAll("button")).find((b) => b.textContent === "medium")!;
  click(trigger);
  expect(container.ownerDocument.body.textContent).toContain("xhigh");
  click(trigger);
  expect(trigger.getAttribute("aria-expanded")).toBe("false");
  expect(document.body.textContent).not.toContain("xhigh");
 });
});
