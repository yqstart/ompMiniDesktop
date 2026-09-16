import { describe, expect, it } from "vitest";
import { capabilityCommand, isFresh, parseCapabilityProbe, PROBE_TTL_MS } from "./capabilities";

// 下面这些正文是从真机 `omp --mode rpc` 实测输出里逐字抄来的（改解析规则时先看这里）
const ADVISOR_ON = "Advisor is enabled (commandcode/gpt-5.6-sol). Context: 0 / 1,050,000 tokens (0%). Spend: 0 input, 0 output, $0.0000.";
const ADVISOR_OFF = "Advisor is disabled.";
const COMPUTER_ON = "Computer use: enabled · prelude: active · configured: display=all, maxWidth=3840, maxHeight=2400";

describe("parseCapabilityProbe", () => {
 it("认 advisor 的启用行，并取出接手的模型", () => {
  expect(parseCapabilityProbe(ADVISOR_ON)).toEqual({
   id: "advisor",
   value: "on",
   detail: "commandcode/gpt-5.6-sol",
  });
 });

 it("认 advisor 的关闭行（没有细节）", () => {
  expect(parseCapabilityProbe(ADVISOR_OFF)).toEqual({ id: "advisor", value: "off", detail: undefined });
 });

 it("认 computer 的状态行，细节只留 prelude（configured 那截太长不上行）", () => {
  const p = parseCapabilityProbe(COMPUTER_ON);
  expect(p?.id).toBe("computer");
  expect(p?.value).toBe("on");
  expect(p?.detail).toBe("prelude: active");
 });

 it("开关自己的回执不算状态（那行没有状态前缀，必须靠随后的 status 确认）", () => {
  expect(parseCapabilityProbe("Computer use enabled for this session.")).toBeNull();
  expect(parseCapabilityProbe("Computer use disabled for this session.")).toBeNull();
  expect(parseCapabilityProbe("Advisor enabled.")).toBeNull();
  expect(parseCapabilityProbe("Advisor disabled.")).toBeNull();
 });

 it("普通命令输出不进这个面", () => {
  expect(parseCapabilityProbe("```\nUsage (3m ago)\n\nOpencode Go\n  …")).toBeNull();
  expect(parseCapabilityProbe("Skill listing: on (session override; default from the skillful setting).")).toBeNull();
  expect(parseCapabilityProbe("")).toBeNull();
 });

 it("前后空白与尾随句号不影响识别", () => {
  expect(parseCapabilityProbe("  Computer use: disabled \n")).toEqual({
   id: "computer",
   value: "off",
   detail: undefined,
  });
 });
});

describe("capabilityCommand", () => {
 it("不给 on 就是读状态，给了就是开 / 关", () => {
  expect(capabilityCommand("advisor")).toBe("/advisor status");
  expect(capabilityCommand("computer", true)).toBe("/computer on");
  expect(capabilityCommand("computer", false)).toBe("/computer off");
 });
});

describe("isFresh", () => {
 it("没读到过 = 不新鲜；超过 TTL = 不新鲜", () => {
  expect(isFresh(undefined, 1000)).toBe(false);
  expect(isFresh({ value: "on", at: 1000 }, 1000 + PROBE_TTL_MS - 1)).toBe(true);
  expect(isFresh({ value: "on", at: 1000 }, 1000 + PROBE_TTL_MS)).toBe(false);
 });
});
