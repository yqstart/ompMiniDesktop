import { useCallback, useEffect, useState } from "react";
import { api } from "@shared/api";
import type { GitInfo } from "@shared/types";
import { useApp } from "../stores/app";

/**
 * 一个目录的 git 只读信息（`get_git_info`）：右栏「变更」区块与输入卡的项目/分支行共用。
 *
 * 结果**连 cwd 一起存**：目录一变旧结果立刻不认，避免短暂显示上一个目录的分支名；
 * 加载态由派生得出（当前 cwd 还没有对应结果 = 查询在途），不在 effect 里同步 setState。
 * `reload` 供分支刷新按钮与手动刷新入口使用；跨组件的变化（分支切换）走 store 的
 * `gitInfoSeq`——自增一次，全部实例一起重读。目录为空时什么都不查。
 */
export function useGitInfo(cwd: string) {
 const seq = useApp((s) => s.gitInfoSeq);
 const [snap, setSnap] = useState<{ cwd: string; info: GitInfo | null }>({ cwd: "", info: null });
 const [tick, setTick] = useState(0);
 const reload = useCallback(() => setTick((t) => t + 1), []);

 useEffect(() => {
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
 }, [cwd, tick, seq]);

 return {
  /** 当前目录的 git 信息（未回来时 null）。 */
  info: snap.cwd === cwd ? snap.info : null,
  /** 查询在途（当前目录还没有结果）。 */
  loading: !!cwd && snap.cwd !== cwd,
  reload,
 };
}
