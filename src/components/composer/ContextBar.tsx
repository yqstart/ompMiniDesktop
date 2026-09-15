import { useCallback, useEffect, useState } from "react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { resolveContext } from "../../lib/context";
import { ProjectPicker } from "../pickers/ProjectPicker";
import { BranchPicker } from "../pickers/BranchPicker";
import type { GitInfo } from "@shared/types";

/**
 * 输入框上方的上下文条：左「项目」、右「git 分支」（截图那张就是这一行）。
 *
 * - 两者共用一个互斥槽 `composerMenu`，同一时刻只开一个下拉；都向上弹，
 *   只遮消息流、不遮正在打字的输入框。
 * - 项目 = 这条消息落到哪个项目；分支 = 该目录当前的 git 状态，**只读**。
 * - 一个项目都没有时整条不渲染：空态的「选择目录」已是唯一主入口，不在这里重复。
 * - 查不到就什么都不显示（不闪「非 Git 目录」）；确实不是仓库时才给那行灰字说明。
 */
export function ContextBar() {
  const { projects, sessions, activeSessionId, activeProjectId } = useApp();
  const { project, cwd } = resolveContext(projects, sessions, activeSessionId, activeProjectId);
  // git 结果连 cwd 一起存：目录一变旧结果立刻不认，避免短暂显示上一个目录的分支名
  const [snap, setSnap] = useState<{ cwd: string; info: GitInfo | null }>({ cwd: "", info: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  // 加载态由派生得出：当前 cwd 还没有对应结果 = 查询在途（避免在 effect 里同步 setState）
  const loading = !!cwd && snap.cwd !== cwd;

  useEffect(() => {
    // 目录为空（无项目/无会话）时什么都不查：snap.cwd !== cwd 已经保证旧结果不会被误用
    if (!cwd) return;
    let alive = true;
    api
      .getGitInfo(cwd)
      .then((info) => {
        if (alive) setSnap({ cwd, info });
      })
      .catch(() => {
        if (alive) setSnap({ cwd, info: null });
      });
    return () => {
      alive = false;
    };
  }, [cwd, tick]);

  if (projects.length === 0) return null;
  const git = snap.cwd === cwd ? snap.info : null;
  return (
    <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-1 gap-y-0.5 px-4 pb-1.5 text-[13px]">
      <ProjectPicker project={project} />
      {git?.isRepo ? (
        <BranchPicker git={git} loading={loading} onReload={reload} />
      ) : git && cwd ? (
        <span className="px-2 py-1 text-muted/60" title={git.error ?? undefined}>
          非 Git 目录
        </span>
      ) : null}
    </div>
  );
}
