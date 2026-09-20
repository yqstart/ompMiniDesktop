// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { GeneralSettingsPanel } from "./GeneralSettingsPanel";

const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@shared/api", () => ({
  api: {
    getOmpSettings: vi.fn(),
    setOmpSetting: vi.fn(),
    resetOmpSetting: vi.fn(),
  },
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  useApp.setState({ health: null, locale: "zh-CN" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.mocked(api.getOmpSettings).mockReset();
});

describe("通用设置读取状态", () => {
  it("首次失败不显示伪设置行，可重试恢复", async () => {
    vi.mocked(api.getOmpSettings).mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce([
      { key: "todo.enabled", value: true, kind: "boolean", description: "todo" },
    ]);
    act(() => {
      root.render(<GeneralSettingsPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("当前 omp 版本没有这个设置");
    expect(container.textContent).toContain("boom");
    act(() => {
      container.querySelectorAll("button").forEach((button) => {
        if (button.textContent === "重试") button.click();
      });
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).not.toContain("boom");
  });

  it("搜索清空后恢复原折叠状态", async () => {
    vi.mocked(api.getOmpSettings).mockResolvedValue([
      { key: "todo.enabled", value: true, kind: "boolean", description: "todo" },
      { key: "bash.enabled", value: true, kind: "boolean", description: "shell" },
    ]);
    act(() => {
      root.render(<GeneralSettingsPanel />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    const input = container.querySelector("input")!;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(input, "todo");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // React 受控输入用 change 事件同步
    act(() => {
      setter?.call(input, "todo");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("任务清单");
    act(() => {
      setter?.call(input, "");
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.textContent).toContain("终端命令");
  });
});
