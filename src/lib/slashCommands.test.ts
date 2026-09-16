import { describe, expect, it } from "vitest";
import { applyCommand, filterCommands, isExactCommand, matchesToken, normalizeCommands } from "./slashCommands";

describe("normalizeCommands", () => {
 it("抬平 input.hint，保留 description / aliases", () => {
  const out = normalizeCommands([
   {
    name: "compact",
    description: "Compact the conversation",
    input: { hint: "[soft|remote|snapcompact] [focus]" },
    subcommands: [{ name: "soft" }],
   },
   { name: "models", aliases: ["model"], description: "Show current model selection" },
  ]);
  expect(out).toEqual([
   {
    name: "compact",
    description: "Compact the conversation",
    aliases: undefined,
    hint: "[soft|remote|snapcompact] [focus]",
   },
   { name: "models", description: "Show current model selection", aliases: ["model"], hint: undefined },
  ]);
 });

 it("丢弃没有 name 的条目，非数组返回空", () => {
  expect(normalizeCommands([{ description: "x" }, null, 3, { name: "" }])).toEqual([]);
  expect(normalizeCommands(undefined)).toEqual([]);
  expect(normalizeCommands({ name: "compact" })).toEqual([]);
 });
});

describe("filterCommands", () => {
 const cmds = normalizeCommands([
  { name: "compact", description: "压缩" },
  { name: "model", aliases: ["models"], description: "模型" },
  { name: "memory", description: "记忆" },
  { name: "rename", description: "改名" },
 ]);

 it("空 token 全命中且保持上游顺序", () => {
  expect(filterCommands(cmds, "", 8).map((c) => c.name)).toEqual(["compact", "model", "memory", "rename"]);
 });

 it("按名字前缀匹配", () => {
  expect(filterCommands(cmds, "mo", 8).map((c) => c.name)).toEqual(["model"]);
  expect(filterCommands(cmds, "m", 8).map((c) => c.name)).toEqual(["model", "memory"]);
 });

 it("别名也参与匹配", () => {
  expect(filterCommands(cmds, "models", 8).map((c) => c.name)).toEqual(["model"]);
 });

 it("limit 截断候选", () => {
  expect(filterCommands(cmds, "", 2).map((c) => c.name)).toEqual(["compact", "model"]);
 });

 it("无命中返回空数组", () => {
  expect(filterCommands(cmds, "zzz", 8)).toEqual([]);
 });
});

describe("matchesToken", () => {
 it("名字或任一别名前缀命中即可", () => {
  expect(matchesToken({ name: "model", aliases: ["models"] }, "mode")).toBe(true);
  expect(matchesToken({ name: "model", aliases: ["models"] }, "models")).toBe(true);
  expect(matchesToken({ name: "model", aliases: ["models"] }, "modelss")).toBe(false);
 });
});

describe("isExactCommand", () => {
 const cmds = normalizeCommands([{ name: "compact" }, { name: "model", aliases: ["models"] }]);

 it("名字精确命中算打全", () => {
  expect(isExactCommand(cmds, "compact")).toBe(true);
 });

 it("别名精确命中也算打全（/models 与 /model 等价）", () => {
  expect(isExactCommand(cmds, "models")).toBe(true);
 });

 it("前缀不算打全、空 token 与 null 都不算", () => {
  expect(isExactCommand(cmds, "comp")).toBe(false);
  expect(isExactCommand(cmds, "")).toBe(false);
  expect(isExactCommand(cmds, null)).toBe(false);
 });
});

describe("applyCommand", () => {
 it("行首 `/` 后替换命令名并补一个空格", () => {
  expect(applyCommand("/com", 4, "compact")).toBe("/compact ");
 });

 it("命令后已有参数：光标停在命令词里时只换命令，空格不重复补", () => {
  expect(applyCommand("/compact soft", 8, "usage")).toBe("/usage soft");
 });

 it("换行后起算的 `/` 也算命令", () => {
  expect(applyCommand("第一行\n/us", 7, "usage")).toBe("第一行\n/usage ");
 });

 it("光标后的文本原样保留", () => {
  expect(applyCommand("/mo 尾巴", 3, "model")).toBe("/model 尾巴");
 });

 it("光标已越过命令词（打了空格）就不再算补全态：原样返回", () => {
  expect(applyCommand("/compact soft", 13, "usage")).toBe("/compact soft");
 });

 it("没有可替换处原样返回", () => {
  expect(applyCommand("hello", 5, "compact")).toBe("hello");
 });
});
