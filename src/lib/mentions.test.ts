import { describe, expect, it } from "vitest";
import { extractMentions } from "./mentions";

/**
 * V2 M6b：`@文件` 解析必须与 omp 的 `extractFileMentions` 同规则，
 * 否则输入框芯片与 omp 实际读进上下文的文件会对不上。
 */
describe("extractMentions", () => {
  it("行首与空白后的 @ 都算提及", () => {
    expect(extractMentions("@docs/rpc-memo.md")).toEqual(["docs/rpc-memo.md"]);
    expect(extractMentions("看下 @src/lib/viewmsg.ts 这段")).toEqual(["src/lib/viewmsg.ts"]);
  });

  it("引号形式允许路径带空格", () => {
    expect(extractMentions('@"docs/my notes.md"')).toEqual(["docs/my notes.md"]);
    expect(extractMentions("看 @'a b/c.ts' 文件")).toEqual(["a b/c.ts"]);
  });

  it("非行首的 @（邮箱、装饰）不算提及", () => {
    expect(extractMentions("mail me at a@b.com")).toEqual([]);
    expect(extractMentions("价格 100@200")).toEqual([]);
  });

  it("只按 omp 的 ASCII 边界与句读修剪（全角标点会留在路径里）", () => {
    expect(extractMentions("见 (@src/a.ts),")).toEqual(["src/a.ts"]);
    expect(extractMentions("见 @src/a.ts.")).toEqual(["src/a.ts"]);
    // 全角括号不在 omp 的边界集合里 → 上游也不会展开，这里必须保持一致
    expect(extractMentions("见（@src/a.ts）")).toEqual([]);
    // 全角句号不在 omp 的 TRAILING 集合里 → 会被当成路径的一部分（上游同样如此）
    expect(extractMentions("见 @src/a.ts。")).toEqual(["src/a.ts。"]);
  });

  it("去重且保持出现顺序", () => {
    expect(extractMentions("@a.ts 和 @b.ts 再看 @a.ts")).toEqual(["a.ts", "b.ts"]);
  });

  it("空文本与只有 @ 的情况安全返回", () => {
    expect(extractMentions("")).toEqual([]);
    expect(extractMentions("@ ")).toEqual([]);
    expect(extractMentions("@@")).toEqual([]);
  });
});
