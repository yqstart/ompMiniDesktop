// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@shared/api";
import type { ConstraintFile, ConstraintsView } from "@shared/types";
import { useApp } from "../../stores/app";
import { ConstraintsPanel } from "./ConstraintsPanel";

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
 it("列出全局文件与规则；选中规则后表单回填，改描述保存走 write_omp_constraint", async () => {
  act(() => {
   root.render(<ConstraintsPanel />);
  });
  await flush();

  expect(container.textContent).toContain("AGENTS.md");
  expect(container.textContent).toContain("RULES.md");
  expect(container.textContent).toContain("no-any");
  expect(container.textContent).toContain("实时注入");

  const ruleButton = [...container.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
   button.textContent?.includes("no-any"),
  );
  expect(ruleButton).toBeTruthy();
  act(() => ruleButton?.click());
  await flush();

  const description = container.querySelector<HTMLInputElement>('input[id^="constraint-description-"]');
  expect(description?.value).toBe("禁止 any");

  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  act(() => {
   setter?.call(description, "禁止 any（新）");
   description?.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();

  const save = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
   (button) => button.textContent?.trim() === "保存",
  );
  expect(save?.disabled).toBe(false);
  act(() => save?.click());
  await flush();

  expect(api.writeOmpConstraint).toHaveBeenCalledTimes(1);
  const [kind, name, content, expectHash] = vi.mocked(api.writeOmpConstraint).mock.calls[0];
  expect(kind).toBe("rule");
  expect(name).toBe("no-any.md");
  expect(content).toContain("description: 禁止 any（新）");
  // 未编辑的 condition 原样保留（值没变不重写）
  expect(content).toContain("condition:");
  expect(expectHash).toBe("rule-hash");
 });
});
