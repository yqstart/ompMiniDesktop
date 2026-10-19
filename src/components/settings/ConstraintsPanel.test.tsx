// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { ConstraintFile, ConstraintsView } from "@shared/types";
import { useApp } from "../../stores/app";
import { ConstraintsPanel } from "./ConstraintsPanel";

// React 的 act 环境（与其它 jsdom 组件测试同一口径）
const actEnv = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnv.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("@shared/api", () => ({
  api: {
    getOmpConstraints: vi.fn(),
    writeOmpConstraint: vi.fn(),
    createOmpRule: vi.fn(),
    deleteOmpRule: vi.fn(),
  },
}));

const agentsFile: ConstraintFile = {
  kind: "agents",
  name: "AGENTS.md",
  path: "/a/AGENTS.md",
  exists: true,
  content: "# 全局约束\n",
  hash: "agents-hash",
  modifiedMs: 1,
  size: 10,
  error: null,
};
const rulesFile: ConstraintFile = {
  kind: "rules",
  name: "RULES.md",
  path: "/a/RULES.md",
  exists: true,
  content: "---\nalwaysApply: true\n---\n规则\n",
  hash: "rules-hash",
  modifiedMs: 1,
  size: 20,
  error: null,
};
const ruleFile: ConstraintFile = {
  kind: "rule",
  name: "no-any.md",
  path: "/a/rules/no-any.md",
  exists: true,
  content: "---\ndescription: 禁止 any\ncondition:\n  - ': any'\n---\n正文\n",
  hash: "rule-hash",
  modifiedMs: 1,
  size: 30,
  error: null,
};
const view: ConstraintsView = {
  agentDir: "/a",
  rulesDir: "/a/rules",
  files: [agentsFile, rulesFile, ruleFile],
  rulesError: null,
};

const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
};

const buttonByText = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent?.trim() === text,
  );

const buttonContaining = (root: HTMLElement, text: string) =>
  [...root.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
    button.textContent?.includes(text),
  );

/** 受控 textarea：走原型 setter + input 事件（React 才认）。 */
const setTextareaValue = (el: HTMLTextAreaElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ locale: "zh-CN", settingsTabActive: true });
  vi.mocked(api.getOmpConstraints).mockResolvedValue(view);
  vi.mocked(api.writeOmpConstraint).mockImplementation(async (kind, name, content, expectHash) => ({
    ...ruleFile,
    kind,
    name,
    content,
    hash: `written-${expectHash ?? "force"}`,
  }));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("omp 约束面板", () => {
  it("三种文件都在，且都是整份 Markdown 直接编辑（没有「表单 / 源码」切换）", async () => {
    act(() => {
      root.render(<ConstraintsPanel />);
    });
    await flush();

    expect(container.textContent).toContain("AGENTS.md");
    expect(container.textContent).toContain("RULES.md");
    expect(container.textContent).toContain("no-any");
    // 列表摘要仍按 frontmatter 读出规则类型
    expect(container.textContent).toContain("实时注入");

    const labels = [...container.querySelectorAll("button")].map((button) => button.textContent?.trim());
    expect(labels).not.toContain("表单");
    expect(labels).not.toContain("源码");

    // 默认选中的 AGENTS.md：编辑框里就是整份文本
    const agentsArea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="AGENTS.md"]');
    expect(agentsArea?.value).toBe(agentsFile.content);

    // RULES.md 同样是整份文本（frontmatter 一起显示），不再有字段表单
    act(() => buttonContaining(container, "RULES.md")?.click());
    await flush();
    const rulesArea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="RULES.md"]');
    expect(rulesArea?.value).toBe(rulesFile.content);
    expect(container.querySelector('input[id^="constraint-description-"]')).toBeNull();
  });

  it("选中规则直接改整份 Markdown，保存原样写回并带乐观锁", async () => {
    act(() => {
      root.render(<ConstraintsPanel />);
    });
    await flush();

    const ruleButton = buttonContaining(container, "no-any");
    expect(ruleButton).toBeTruthy();
    act(() => ruleButton?.click());
    await flush();

    const area = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="no-any"]');
    expect(area?.value).toBe(ruleFile.content);

    const next = "---\ndescription: 禁止 any（新）\ncondition:\n  - ': any'\n---\n正文\n";
    act(() => setTextareaValue(area as HTMLTextAreaElement, next));
    await flush();

    const save = buttonByText(container, "保存");
    expect(save?.disabled).toBe(false);
    act(() => save?.click());
    await flush();

    expect(api.writeOmpConstraint).toHaveBeenCalledTimes(1);
    const [kind, name, content, expectHash] = vi.mocked(api.writeOmpConstraint).mock.calls[0];
    expect(kind).toBe("rule");
    expect(name).toBe("no-any.md");
    expect(content).toBe(next);
    expect(expectHash).toBe("rule-hash");
  });

  it("规则行尾的删除键走二次确认，确认后按目标文件删除", async () => {
    act(() => {
      root.render(<ConstraintsPanel />);
    });
    await flush();

    // 列表行上的删除键（hover / 聚焦显形）——不先选中该规则也能删，确认框针对它
    const rowDelete = container.querySelector<HTMLButtonElement>(
      'button[aria-label="删除规则：no-any"]',
    );
    expect(rowDelete).toBeTruthy();
    act(() => rowDelete?.click());
    await flush();

    expect(container.textContent).toContain("删除规则「no-any」？");
    act(() => buttonByText(container, "删除")?.click());
    await flush();

    expect(api.deleteOmpRule).toHaveBeenCalledWith("no-any.md");
    expect(container.textContent).not.toContain("no-any");
  });
});
