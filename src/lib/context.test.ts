import { describe, expect, it } from "vitest";
import { resolveContext } from "./context";
import type { ProjectView, SessionView } from "@shared/types";

const project = (id: string, path: string): ProjectView => ({
  id,
  path,
  name: id,
  missing: false,
  sessionCount: 0,
});

const session = (id: string, projectId: string | null, cwd: string): SessionView => ({
  id,
  projectId,
  title: id,
  cwd,
  timestamp: 0,
  archived: false,
  corrupt: false,
  note: null,
  running: false,
});

const projects = [project("a", "/work/a"), project("b", "/work/b")];

describe("resolveContext", () => {
  it("会话归属优先于左栏上下文", () => {
    const got = resolveContext(projects, [session("s1", "a", "/work/a")], "s1", "b");
    expect(got.project?.id).toBe("a");
    expect(got.cwd).toBe("/work/a");
  });

  it("会话未归属时显示未归属，不回退 activeProjectId", () => {
    const got = resolveContext(projects, [session("s1", null, "/tmp/loose")], "s1", "b");
    expect(got.project).toBeNull();
    expect(got.cwd).toBe("/tmp/loose");
  });

  it("没有会话时用左栏项目与它的路径", () => {
    const got = resolveContext(projects, [], null, "b");
    expect(got.project?.id).toBe("b");
    expect(got.cwd).toBe("/work/b");
  });

  it("会话 cwd 为空才退回项目路径", () => {
    const got = resolveContext(projects, [session("s1", "a", "")], "s1", null);
    expect(got.cwd).toBe("/work/a");
  });

  it("什么都没有时给空上下文（上下文条据此整条不渲染）", () => {
    const got = resolveContext([], [], null, null);
    expect(got.project).toBeNull();
    expect(got.cwd).toBe("");
  });
});
