import { describe, expect, it, vi } from "vitest";

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿一个能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({ ptyWrite: vi.fn(() => Promise.resolve()) }));
vi.mock("@shared/api", () => ({ api: { ptyWrite: mock.ptyWrite } }));

import { canInjectReference, insertFileReference, PASTE_END, PASTE_START } from "./termRef";

describe("引用注入（PTY 通道）", () => {
 it("只有 omp 明确空闲（π = 等待输入）时才允许注入", () => {
  expect(canInjectReference({ status: "running", state: "ready" })).toBe(true);
  expect(canInjectReference({ status: "running", state: "working" })).toBe(false);
  expect(canInjectReference({ status: "running", state: "attention" })).toBe(false);
  expect(canInjectReference({ status: "running", state: "unknown" })).toBe(false);
  expect(canInjectReference({ status: "exited", state: "exited" })).toBe(false);
 });

 it("注入 bracketed paste 包住的 @路径 + 尾空格（不回车）", () => {
  mock.ptyWrite.mockClear();
  insertFileReference("t1", "/a/b.ts");
  expect(mock.ptyWrite).toHaveBeenCalledWith("t1", `${PASTE_START}@/a/b.ts ${PASTE_END}`);
 });

 it("含空白路径走引号形式", () => {
  mock.ptyWrite.mockClear();
  insertFileReference("t1", "/a/b c.ts");
  expect(mock.ptyWrite).toHaveBeenCalledWith("t1", `${PASTE_START}@"/a/b c.ts" ${PASTE_END}`);
 });
});
