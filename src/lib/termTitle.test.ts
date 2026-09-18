import { describe, expect, it } from "vitest";
import { parseTermTitle } from "./termTitle";

describe("omp 标题解析（π <状态> <会话名>）", () => {
 it("四套转轮字形 + WSL 的静态 `:` 都读成 working，展示名剥掉前缀", () => {
  for (const sep of ["⠋", "⠏", "○", "◕", "●", "⡀", "⠈", "-", "\\", "|", "/", ":"]) {
   expect(parseTermTitle(`π ${sep} 会话名`), sep).toEqual({ phase: "working", label: "会话名" });
  }
 });
 it("`!` = agent 在等你，`>` = 轮到你", () => {
  expect(parseTermTitle("π ! 修登录 bug")).toEqual({ phase: "attention", label: "修登录 bug" });
  expect(parseTermTitle("π > 修登录 bug")).toEqual({ phase: "ready", label: "修登录 bug" });
 });
 it("会话名缺省（`π ⠋` / `π >`）时展示名为空串，由调用方回退到工作区名", () => {
  expect(parseTermTitle("π ⠋")).toEqual({ phase: "working", label: "" });
  expect(parseTermTitle("π >")).toEqual({ phase: "ready", label: "" });
 });
 it("`tui.titleState` 关掉（`π: 会话名` / `π`）时状态未知，但名字仍剥掉前缀", () => {
  expect(parseTermTitle("π: 会话名")).toEqual({ phase: "unknown", label: "会话名" });
  expect(parseTermTitle("π:")).toEqual({ phase: "unknown", label: "" });
  expect(parseTermTitle("π")).toEqual({ phase: "unknown", label: "" });
 });
 it("非 omp 标题（OSC 还没来过 / 扩展覆盖）状态未知、原样保留", () => {
  expect(parseTermTitle("ompMiniDesktop · main")).toEqual({
   phase: "unknown",
   label: "ompMiniDesktop · main",
  });
  // 前缀在、分隔符不认识：状态未知，但仍剥掉 π 前缀
  expect(parseTermTitle("π x 未知分隔符")).toEqual({ phase: "unknown", label: "未知分隔符" });
 });
});
