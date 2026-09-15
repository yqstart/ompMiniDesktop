import type { ProjectView, SessionView } from "@shared/types";

/**
 * 输入框上方上下文条要展示的「项目 + 目录」，取值规则只有两条：
 *
 * 1. 目录：会话的 `cwd` 是真相（会话可能属于已解绑的目录），没有会话才退回项目路径。
 * 2. 项目：会话存在时**只认会话归属**——`projectId` 为 null 就是「未归属」，
 *    绝不回退到左栏的 `activeProjectId`，否则会显示成「消息在 A 项目里」，
 *    实际却发进了未归属目录的会话。
 */
export function resolveContext(
  projects: ProjectView[],
  sessions: SessionView[],
  activeSessionId: string | null,
  activeProjectId: string | null,
): { project: ProjectView | null; cwd: string } {
  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const wantedId = session ? session.projectId : activeProjectId;
  const project = projects.find((p) => p.id === wantedId) ?? null;
  const cwd = session?.cwd || project?.path || "";
  return { project, cwd };
}
