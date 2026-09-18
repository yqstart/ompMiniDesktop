import { Channel } from "@tauri-apps/api/core";
import { api } from "@shared/api";
import type { CommitEvent, CommitPhase, CommitTaskView } from "@shared/types";
import { useApp } from "../stores/app";

/**
 * 工作区「提交并推送」的前端编排（V14，后端见 `src-tauri/src/git_commit.rs`）。
 *
 * - `startCommitTask` / `pushCommits`：发起任务（立即落 store 视图 + 聚焦浮层；输出经 Channel 回流）；
 * - `cancelCommitTask`：取消（后端杀进程组，落 `canceled` 终态）；
 * - `closeCommitPanel`：关浮层（运行中 = 转后台；终态 = 清除记录——行徽章由 git 快照接管）；
 * - `refreshWorkspaceGitState` / `scheduleWorkspaceGitRefresh`：行徽章的 git 快照（不轮询）。
 */

/** 运行中的阶段判定（浮层按钮与行徽章共用）。 */
export function isCommitTaskRunning(phase: CommitPhase): boolean {
 return phase === "checking" || phase === "committing" || phase === "pushing";
}

/** 第一段入口：左栏行内「提交并推送」。后端预检自己选路——有改动 → 提交；仅 ahead → 推送快路径；都没有 → noop。 */
export function startCommitTask(cwd: string): void {
 const existing = useApp.getState().commitTasks[cwd];
 if (existing && isCommitTaskRunning(existing.phase)) return;
 openTask(cwd);
 runCommand(cwd, (channel) => api.startCommitPush(cwd, channel));
}

/** 第二段入口：推送已有提交（浮层的「推送」、行上待推送徽章都走它）。 */
export function pushCommits(cwd: string): void {
 const existing = useApp.getState().commitTasks[cwd];
 if (existing && isCommitTaskRunning(existing.phase)) return;
 openTask(cwd);
 runCommand(cwd, (channel) => api.pushCommits(cwd, channel));
}

/** 取消运行中的任务（终态由后端事件落定）。 */
export function cancelCommitTask(cwd: string): void {
 void api.cancelCommitPush(cwd).catch(() => undefined);
}

/**
 * 关闭浮层：运行中只转后台（任务继续，行徽章指示）；终态顺带清除任务记录
 * （「待推送」由行徽章的 git 快照接管，失败详情属于「已阅即清」）。
 */
export function closeCommitPanel(): void {
 const s = useApp.getState();
 const cwd = s.activeCommitCwd;
 if (cwd) {
  const task = s.commitTasks[cwd];
  if (task && !isCommitTaskRunning(task.phase)) s.dropCommitTask(cwd);
 }
 s.setActiveCommitCwd(null);
}

function openTask(cwd: string): void {
 const task: CommitTaskView = {
  cwd,
  phase: "checking",
  log: [],
  commits: [],
  error: null,
  hint: null,
  startedAt: Date.now(),
 };
 const s = useApp.getState();
 s.setCommitTask(task);
 s.setActiveCommitCwd(cwd);
}

function runCommand(cwd: string, invoke: (channel: Channel<CommitEvent>) => Promise<void>): void {
 const channel = new Channel<CommitEvent>();
 channel.onmessage = (e) => {
  const s = useApp.getState();
  if (e.type === "line") {
   s.appendCommitLog(cwd, e.text);
  } else if (e.type === "phase") {
   s.patchCommitTask(cwd, { phase: e.phase });
  } else {
   s.finishCommitTask(cwd, e.outcome);
   // 任务结束：该工作区的 git 快照立刻重拉（行徽章从任务态切回 git 真相）。
   void refreshWorkspaceGitState([cwd]);
  }
 };
 invoke(channel).catch((err) => {
  // 命令本身失败（omp 缺失 / 不是仓库 / BUSY / 启动失败）：任务落 failed，错误原样展示。
  const message = err instanceof Error ? err.message : String(err);
  useApp.getState().finishCommitTask(cwd, { phase: "failed", commits: [], error: message, hint: null });
  void refreshWorkspaceGitState([cwd]);
 });
}

/** 刷新代际：并发刷新时旧响应不得覆盖新结果。 */
let refreshSeq = 0;

/** 批量刷新工作区 git 快照（行徽章）；`paths` 省略 = 全部未缺失的工作区。失败静默。 */
export async function refreshWorkspaceGitState(paths?: string[]): Promise<void> {
 const list = paths ?? useApp.getState().workspaces.filter((w) => !w.missing).map((w) => w.path);
 if (list.length === 0) return;
 const seq = ++refreshSeq;
 try {
  const states = await api.getWorkspaceGitState(list);
  if (seq !== refreshSeq) return;
  useApp.getState().setWorkspaceGitStates(states);
 } catch {
  // 静默：行徽章是提示，不是关键路径（点按钮时的后端预检仍会给出真结论）。
 }
}

/** 终端刚干完活（π 转就绪 / 等待确认）时的防抖刷新——最可能有新改动的时点（零轮询成本的聪明时机）。 */
let readyTimer: number | undefined;
export function scheduleWorkspaceGitRefresh(delayMs = 2000): void {
 clearTimeout(readyTimer);
 readyTimer = window.setTimeout(() => {
  readyTimer = undefined;
  void refreshWorkspaceGitState();
 }, delayMs);
}
