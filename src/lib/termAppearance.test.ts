import { describe, expect, it, vi } from "vitest";

/** `vi.mock` 的工厂会被提升：用 `vi.hoisted` 拿一个能在用例里改行为的 mock。 */
const mock = vi.hoisted(() => ({ ptyWrite: vi.fn(() => Promise.resolve()) }));
vi.mock("@shared/api", () => ({ api: { ptyWrite: mock.ptyWrite } }));

import { DISPLAY_RESET_SEQUENCE, notifyTerminalAppearance } from "./termAppearance";

describe("皮肤切换通知（PTY 通道）", () => {
 it("注入的是 Alt+L 的 legacy 编码（ESC + l），不带回车", () => {
  expect(DISPLAY_RESET_SEQUENCE).toBe("\u001bl");
  mock.ptyWrite.mockClear();
  notifyTerminalAppearance("t1");
  expect(mock.ptyWrite).toHaveBeenCalledWith("t1", "\u001bl");
 });
});
