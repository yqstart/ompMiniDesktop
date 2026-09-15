import { describe, expect, it } from "vitest";
import { filterPalette, type PaletteEntry } from "./commandPalette";

/**
 * 命令中心过滤（V41）：标题 / hint 子串与英文关键词面、前缀优先、空查询保序。
 */
const entries: PaletteEntry[] = [
 { kind: "action", id: "status", title: "会话统计" },
 { kind: "action", id: "find", title: "会话内查找" },
 { kind: "session", sid: "s1", title: "演示会话", hint: "/tmp/demo", running: false },
];

describe("filterPalette（命令中心过滤）", () => {
 it("空查询（与纯空白）保持原序", () => {
  expect(filterPalette(entries, "")).toEqual(entries);
  expect(filterPalette(entries, "   ")).toEqual(entries);
 });

 it("标题子串命中（中文）；未命中剔除", () => {
  const out = filterPalette(entries, "统计");
  expect(out).toHaveLength(1);
  expect(out[0]).toMatchObject({ kind: "action", id: "status" });
  expect(filterPalette(entries, "不存在的东西")).toEqual([]);
 });

 it("hint（会话 cwd）也参与匹配", () => {
  const out = filterPalette(entries, "demo");
  expect(out).toHaveLength(1);
  expect(out[0].kind).toBe("session");
 });

 it("英文关键词命中动作（keywords 面）", () => {
  const out = filterPalette(entries, "stats");
  expect(out[0]).toMatchObject({ kind: "action", id: "status" });
 });

 it("前缀优先于子串（同为命中时按质量排序）", () => {
  const list: PaletteEntry[] = [
   { kind: "action", id: "find", title: "查找 xx" },
   { kind: "action", id: "status", title: "xx 查找" },
  ];
  const out = filterPalette(list, "查找");
  expect(out.map((e) => (e.kind === "action" ? e.id : ""))).toEqual(["find", "status"]);
 });
});
