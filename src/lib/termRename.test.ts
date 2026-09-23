import { describe, expect, it } from "vitest";
import { canRenameSession, renameTerminalSession, sanitizeSessionTitle, SESSION_TITLE_MAX } from "./termRename";

describe("会话重命名（走 omp 原生 /rename 的 PTY 注入）", () => {
 it("清洗：去控制字符（含换行）、去首尾空白；清洗后为空 = 非法标题", () => {
  expect(sanitizeSessionTitle("  修登录 bug  ")).toBe("修登录 bug");
  // 换行 / 回车会把注入文本拆成第二次输入，必须去掉而不是保留
  expect(sanitizeSessionTitle("a\nb")).toBe("ab");
  expect(sanitizeSessionTitle("a\r/b\u001b[0m")).toBe("a/b[0m");
  expect(sanitizeSessionTitle("   ")).toBeNull();
  expect(sanitizeSessionTitle("")).toBeNull();
  expect(sanitizeSessionTitle("\n\t")).toBeNull();
 });

 it("超长标题截断到上限", () => {
  const long = "x".repeat(SESSION_TITLE_MAX + 10);
  expect(sanitizeSessionTitle(long)).toBe("x".repeat(SESSION_TITLE_MAX));
 });

 it("只有 omp 明确空闲（π = 等待输入）时才允许注入", () => {
  expect(canRenameSession({ status: "running", state: "ready" })).toBe(true);
  // 工作态注入会排进会话当用户输入；等待确认（!）时注入会答到审批提示上
  expect(canRenameSession({ status: "running", state: "working" })).toBe(false);
  expect(canRenameSession({ status: "running", state: "attention" })).toBe(false);
  expect(canRenameSession({ status: "running", state: "unknown" })).toBe(false);
  expect(canRenameSession({ status: "exited", state: "exited" })).toBe(false);
 });

 it("非法标题不注入（返回 false，调用方给重试提示）", () => {
  expect(renameTerminalSession("t1", "   ")).toBe(false);
  expect(renameTerminalSession("t1", "\n")).toBe(false);
 });
});
