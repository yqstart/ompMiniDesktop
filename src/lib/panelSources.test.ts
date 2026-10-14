import { describe, expect, it } from "vitest";
import type { ViewMsg } from "@shared/types";
import { recentSourceFiles, splitSourcePath } from "./panelSources";

const user = (id: string): ViewMsg => ({ kind: "user", id, text: id, mentions: [] });
const tool = (id: string, path?: string): ViewMsg => ({
 kind: "tool",
 id,
 toolCallId: id,
 name: "read",
 intent: "",
 argsSummary: "",
 state: "ok",
 output: "",
 streamIndex: 0,
 ...(path ? { path } : {}),
});
const files = (id: string, paths: string[]): ViewMsg => ({
 kind: "files",
 id,
 files: paths.map((p) => ({ path: p, lineCount: 1 })),
});

describe("recentSourceFiles", () => {
 it("只取最后一次用户消息之后的读取 / 引用，保序去重并计数", () => {
  const events = [
   user("u1"),
   tool("t1", "/w/a.ts"),
   user("u2"),
   tool("t2", "/w/b.ts"),
   tool("t3", "/w/a.ts"),
   files("f1", ["/w/a.ts", "/w/c.ts"]),
  ];
  const out = recentSourceFiles(events);
  // 最近的排在前面（按首次出现序倒排）：b 最早出现 → 最后；c 最晚 → 最前
  expect(out.map((x) => x.path)).toEqual(["/w/c.ts", "/w/a.ts", "/w/b.ts"]);
  expect(out.find((x) => x.path === "/w/a.ts")?.reads).toBe(2);
 });

 it("没有用户消息（打开历史中段）时从流首开始算；无路径的工具行不计入", () => {
  const events = [tool("t1"), tool("t2", "/w/x.ts")];
  expect(recentSourceFiles(events).map((x) => x.path)).toEqual(["/w/x.ts"]);
 });

 it("超过上限保最近的 max 条", () => {
  const events = [user("u1"), ...Array.from({ length: 30 }, (_, i) => tool(`t${i}`, `/w/f${i}.ts`))];
  const out = recentSourceFiles(events, 5);
  expect(out).toHaveLength(5);
  expect(out[0].path).toBe("/w/f29.ts");
 });
});

describe("splitSourcePath", () => {
 it("剥掉会话 cwd 前缀，拆成基名与前缀", () => {
  expect(splitSourcePath("/w/proj/src/lib/a.ts", "/w/proj")).toEqual({ base: "a.ts", prefix: "src/lib" });
  expect(splitSourcePath("/w/proj/a.ts", "/w/proj/")).toEqual({ base: "a.ts", prefix: "" });
  expect(splitSourcePath("a.ts", "/w/proj")).toEqual({ base: "a.ts", prefix: "" });
  // cwd 外（绝对路径不同目录）保留原样前缀
  expect(splitSourcePath("/other/x.ts", "/w/proj")).toEqual({ base: "x.ts", prefix: "/other" });
 });
});
