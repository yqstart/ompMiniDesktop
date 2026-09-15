import { useEffect, useState } from "react";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderSearch,
  FolderMinus,
  FolderPlus,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { pickAndAddProject, switchProject } from "../../lib/projects";
import { groupSessionsByProject } from "../../lib/sessions";
import { createSessionIn, openSessionWithHistory } from "../../lib/sessionOpen";
import { SCAN_MAX, SCAN_STEP, loadSessions, scanMoreSessions } from "../../lib/sessionList";
import { ConfirmDialog } from "../ConfirmDialog";
import type { SessionView } from "@shared/types";

/** 后端 archive_sessions / delete_sessions 单次上限，前端按此分批调用。 */
const BATCH_LIMIT = 200;

/**
 * 会话行：单行结构 `● 标题 … 时间/操作`，对齐截图。
 * - 标题单行省略；右侧固定 68px 槽位：平时显示 mono 时间，hover / focus-within 时
 *   时间 visibility 隐藏（占位保留），操作按钮绝对覆盖同一槽位淡入——两者互斥、
 *   外层布局零变化，悬浮不跳动。
 * - 归档、删除都在行内展示，不另起第二行；删除二次确认以浮层覆盖，不撑布局。
 * - 行首无复选框：批量归档/删除收归项目分组头（见 Sidebar），行内只做单个会话操作。
 */
function SessionRow({ s, onChanged }: { s: SessionView; onChanged: () => void }) {
  const { activeSessionId } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = s.id === activeSessionId;
  const time = s.corrupt
    ? "已损坏"
    : new Date(s.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  return (
    <div
      className={`group relative flex h-9 min-w-0 items-center rounded-lg pr-1.5 pl-2 transition-colors duration-150 ${
        active ? "bg-background shadow-[inset_0_0_0_1px_var(--color-border)]" : "hover:bg-background/60"
      }`}
    >
      <button
        // 打开逻辑与输入框上方项目下拉共用一份（lib/sessionOpen）
        onClick={() => void openSessionWithHistory(s.id)}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        aria-label={`会话 ${s.title}`}
      >
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.running ? "bg-ok" : "bg-transparent"}`}
          aria-label={s.running ? "运行中" : undefined}
          aria-hidden={!s.running}
        />
        <span className={`min-w-0 flex-1 truncate text-sm ${active ? "font-medium" : ""}`}>{s.title}</span>
        <span className="w-[68px] shrink-0 truncate text-right font-mono text-[11px] text-muted/80 group-focus-within:invisible group-hover:invisible">
          {time}
        </span>
      </button>
      {!confirmDelete ? (
        <span className="invisible absolute top-1/2 right-1.5 flex w-[68px] -translate-y-1/2 items-center justify-end gap-0.5 opacity-0 transition-opacity duration-150 group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
          {!s.archived ? (
            <button
              onClick={() => api.archiveSession(s.id).then(onChanged)}
              className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
              aria-label={s.running ? "先停止再归档" : "归档会话"}
              title={s.running ? "先停止再归档" : "归档会话"}
            >
              <Archive size={13} />
            </button>
          ) : (
            <button
              onClick={() => api.unarchiveSession(s.id).then(onChanged)}
              className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
              aria-label="取消归档"
              title="取消归档"
            >
              <ArchiveRestore size={13} />
            </button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="cursor-pointer rounded-md p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-danger"
            aria-label="删除会话"
            title="删除会话"
          >
            <Trash2 size={13} />
          </button>
        </span>
      ) : (
        <span className="absolute top-1/2 right-1 z-10 flex -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-surface px-1.5 py-1 text-xs whitespace-nowrap shadow-lg">
          <span className="text-danger">确认删？</span>
          <button
            onClick={() =>
              api.deleteSession(s.id).then(() => {
                onChanged();
                setConfirmDelete(false);
              })
            }
            className="cursor-pointer rounded-md bg-danger px-1.5 py-0.5 text-white"
            aria-label="确认删除"
          >
            删除
          </button>
          <button
            onClick={() => setConfirmDelete(false)}
            className="cursor-pointer rounded-md border border-border px-1.5 py-0.5"
            aria-label="取消删除"
          >
            取消
          </button>
        </span>
      )}
    </div>
  );
}

export function Sidebar() {
  const { projects, sessions, activeProjectId, set, sessionScan, sessionScanLimit } = useApp();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 正在二次确认的项目操作（浮层确认，不撑布局；一次只确认一个）：
  // purge = 删除该工作区全部对话（真删 jsonl）；remove = 删除工作区（解绑 + 名下对话全部归档）
  const [confirmProject, setConfirmProject] = useState<{ id: string; kind: "purge" | "remove" } | null>(null);
  /** 批量删除的通用二次确认（ConfirmDialog）；项目内联浮层仍走 confirmProject。 */
  const [confirmBatch, setConfirmBatch] = useState<{ ids: string[]; title: string; detail: string } | null>(null);

  useEffect(() => {
    // 会话一次全量拉取，前端按项目分组（修复：之前按 activeProjectId 传参，
    // 后端过滤不可靠会导致各项目会话全堆在“进行中”）。
    void loadSessions();
  }, []);

  const refreshAll = () =>
    Promise.all([
      api.listProjects().then((all) => set({ projects: all })).catch(() => undefined),
      loadSessions(),
    ]).then(() => undefined);

  const refreshSessions = () => loadSessions();

  // 打开/切换项目时刷新项目与会话：终端里新建的会话（同 cwd）会实时归属进来，
  // 而不是等下次启动才出现在项目下。左栏分组头只切上下文，不抢着打开会话；
  // 「切完顺手打开最近会话」只由输入框上方的项目下拉触发（openRecent）。
  const openProject = (id: string) => {
    void switchProject(id);
  };

  /**
   * 目录缺失时的重定位：只改覆盖层里的项目路径（会话文件、备注、归档标记都不动），
   * 改完立刻刷新——原先按 cwd 归不到组的会话会重新回到该项目下。
   */
  const relocate = async (id: string, name: string) => {
    const picked = await open({ directory: true, multiple: false, title: `为「${name}」重新选择目录` });
    if (typeof picked !== "string" || !picked) return;
    setError(null);
    try {
      await api.relocateProject(id, picked);
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "重定位失败");
    }
  };

  /** 删除成功后清掉被删会话的前端痕迹：正在看的会话退回空态，不留幽灵消息。 */
  const pruneDeletedSessions = (ids: string[]) => {
    const st = useApp.getState();
    const gone = new Set(ids);
    const eventsBySession = { ...st.eventsBySession };
    const statusBySession = { ...st.statusBySession };
    for (const id of ids) {
      delete eventsBySession[id];
      delete statusBySession[id];
    }
    set({
      eventsBySession,
      statusBySession,
      activeSessionId: st.activeSessionId && gone.has(st.activeSessionId) ? null : st.activeSessionId,
    });
  };

  /** 项目 / 分组级批量操作：按 BATCH_LIMIT 分批、聚合失败明细。
   *  delete 先弹通用 ConfirmDialog（MASTER §8）；项目内浮层已二次确认时传 confirmed 跳过。
   *  会话行本身不做批量，只做单个会话的归档、取消归档与删除。 */
  const runBatch = async (
    kind: "archive" | "delete",
    ids: string[],
    opts: { confirmed?: boolean } = {},
  ) => {
    if (ids.length === 0) return;
    if (kind === "delete" && !opts.confirmed) {
      // 统一走 ConfirmDialog：此前这里用 window.confirm，成了第二种确认样式
      setConfirmBatch({
        ids,
        title: `删除这 ${ids.length} 个对话？`,
        detail: "会连同 jsonl 会话文件一起删除，不可恢复。",
      });
      return;
    }
    setBusy(true);
    setError(null);
    const failed: string[] = [];
    const failedIds = new Set<string>();
    try {
      for (let i = 0; i < ids.length; i += BATCH_LIMIT) {
        const chunk = ids.slice(i, i + BATCH_LIMIT);
        const res = kind === "archive" ? await api.archiveSessions(chunk) : await api.deleteSessions(chunk);
        for (const f of res.failed) {
          failed.push(f.message || f.id);
          failedIds.add(f.id);
        }
      }
      // 只清真正删掉的：失败的那些还在列表里，保留缓存供继续阅读
      if (kind === "delete") pruneDeletedSessions(ids.filter((id) => !failedIds.has(id)));
      await refreshSessions();
      if (failed.length > 0) {
        setError(`${kind === "archive" ? "归档" : "删除"}部分失败：${failed.join("；")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${kind === "archive" ? "归档" : "删除"}失败`);
    } finally {
      setBusy(false);
    }
  };

  /** 删除工作区（解绑）：只摘掉项目条目，不删任何会话文件；
   *  名下全部对话由后端按 cwd 扫描后标记归档保留（含进行中与已归档）。 */
  const removeWorkspace = async (projectId: string) => {
    try {
      await api.removeProject(projectId);
      setConfirmProject(null);
      const st = useApp.getState();
      const nextProjects = st.projects.filter((p) => p.id !== projectId);
      // 被删工作区若是当前上下文，切到首个剩余项目；正看的会话若归属它，不断开阅读。
      set({
        projects: nextProjects,
        activeProjectId:
          st.activeProjectId === projectId
            ? (nextProjects.find((p) => !p.missing)?.id ?? nextProjects[0]?.id ?? null)
            : st.activeProjectId,
      });
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除工作区失败");
    }
  };

  const { groups, orphanActive, orphanArchived } = groupSessionsByProject(projects, sessions);
  const q = query.trim().toLowerCase();
  const matchSession = (s: (typeof sessions)[number]) =>
    q ? s.title.toLowerCase().includes(q) : true;
  const visibleGroups = groups.map((g) => ({
    ...g,
    active: g.active.filter(matchSession),
    archived: g.archived.filter(matchSession),
  }));
  const visibleOrphanActive = orphanActive.filter(matchSession);
  const visibleOrphanArchived = orphanArchived.filter(matchSession);

  return (
    <aside className="flex h-full w-full flex-col overflow-hidden border-r border-border bg-sidebar">
      {/* macOS Overlay 红绿灯占位：与添加项目按钮错开，避免重叠 */}
      <div data-tauri-drag-region className="h-9 shrink-0" aria-hidden />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {/* 顶部：添加项目（DSH 式主入口）——原先这里是「新建会话」，
            现在唯一主入口让给添加项目；新建会话下放到各项目分组内（分组头下方
            与空态），不与主入口抢位。 */}
        <button
          onClick={async () => {
            const res = await pickAndAddProject();
            if (res && !res.ok) setError(res.message);
          }}
          className="mb-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white transition-opacity duration-150 hover:opacity-90"
          aria-label="添加项目"
        >
          <FolderPlus size={14} aria-hidden /> 添加项目
        </button>
        {/* 搜索入口：Cursor / DSH 式一体搜索框——图标内置、整块圆角、
            focus-within 时 accent 描边；清除按钮只在有字时出现，不占位跳动 */}
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-border/60 bg-background px-2.5 py-2 text-sm text-muted transition-colors duration-150 focus-within:border-accent/60 focus-within:text-foreground">
          <Search size={14} aria-hidden className="shrink-0" />
          <label htmlFor="sidebar-search" className="sr-only">
            搜索会话
          </label>
          <input
            id="sidebar-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话…"
            className="w-full min-w-0 bg-transparent outline-none placeholder:text-muted/70"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="shrink-0 cursor-pointer rounded-full p-0.5 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground"
              aria-label="清空搜索"
            >
              <X size={12} aria-hidden />
            </button>
          )}
        </div>
        {/* 项目分组（Cursor / Codex 式单层结构）：分组头即项目入口，
            点击展开/折叠（details 原生），不再另起一排快捷卡片——之前红框那排
            快捷卡片与下方分组重复，造成“一个项目出现两次”，已删除。 */}
        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-sm text-muted">
            暂无项目，先添加一个目录
          </div>
        ) : (
          q && (
            <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted">
              {visibleGroups.reduce((n, g) => n + g.active.length + g.archived.length, 0) +
                visibleOrphanActive.length +
                visibleOrphanArchived.length}{" "}
              个匹配
            </div>
          )
        )}
        <div className="mt-2 px-1">
          {error && (
            <div role="alert" className="mb-1 rounded-md border border-danger/50 px-2 py-1.5 text-xs text-danger">
              {error}
              <button onClick={() => setError(null)} className="ml-2 cursor-pointer underline" aria-label="关闭错误提示">
                关闭
              </button>
            </div>
          )}
          {visibleGroups.map(({ project, active, archived }) => {
            // 分组头槽位显示「进行中 · 已归档」；批量删除覆盖两者，先算总数
            const total = active.length + archived.length;
            return (
              <details
                key={project.id}
                className="group/proj mt-1"
                open={!q || active.length + archived.length > 0}
              >
                <summary
                  className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-1.5 py-1.5 text-xs transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden ${
                    project.id === activeProjectId
                      ? "bg-background text-foreground shadow-[inset_0_0_0_1px_var(--color-border)]"
                      : "text-muted"
                  }`}
                  aria-label={`项目 ${project.name} 的会话，进行中 ${active.length}，已归档 ${archived.length}`}
                  onClick={(e) => {
                    // Cursor 式：点分组头即切换项目上下文（新建会话落到它），
                    // 展开/折叠仍走 chevron 原生行为。
                    if ((e.target as HTMLElement).closest("button")) return;
                    openProject(project.id);
                  }}
                >
                  <ChevronRight size={12} aria-hidden className="shrink-0 transition-transform duration-150 group-open/proj:rotate-90" />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium text-foreground">{project.name}</span>
                    {project.missing ? (
                      <span className="ml-1.5 rounded bg-warn/15 px-1 py-px text-[11px] text-warn">目录缺失</span>
                    ) : (
                      <span className="ml-1.5 truncate font-mono text-[11px] text-muted/70">{project.path}</span>
                    )}
                  </span>
                  {/* 右侧固定槽位：数量与批量按钮同槽互斥，垂直居中，悬浮零跳动。
                      三个批量入口常驻 hover 操作区——归档全部对话 / 删除全部对话 /
                      删除工作区（解绑 + 名下对话归档）；缺失态同样保留，保证可清理。 */}
                  <span className="relative flex h-5 w-[76px] shrink-0 items-center justify-end">
                    <span className="font-mono group-hover/proj:invisible">
                      {active.length}{archived.length > 0 ? ` · ${archived.length}` : ""}
                    </span>
                    <span className="absolute inset-y-0 right-0 hidden items-center gap-0.5 group-hover/proj:flex" onClick={(e) => e.preventDefault()}>
                      <button
                        onClick={() => void runBatch("archive", active.map((s) => s.id))}
                        disabled={busy || active.length === 0}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
                        aria-label={`归档 ${project.name} 全部对话`}
                        title="归档本项目全部对话（已归档的保持归档，可取消归档）"
                      >
                        <Archive size={12} />
                      </button>
                      <button
                        onClick={() => setConfirmProject({ id: project.id, kind: "purge" })}
                        disabled={busy || total === 0}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
                        aria-label={`删除 ${project.name} 全部对话`}
                        title={`删除本项目全部对话（含已归档，共 ${total} 个，二次确认）`}
                      >
                        <Trash2 size={12} />
                      </button>
                      <button
                        onClick={() => setConfirmProject({ id: project.id, kind: "remove" })}
                        disabled={busy}
                        className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
                        aria-label={`删除工作区 ${project.name}`}
                        title="删除工作区（只解绑目录，不删会话文件；名下对话全部归档保留）"
                      >
                        <FolderMinus size={12} />
                      </button>
                    </span>
                  </span>
                </summary>
                {/* 项目二次确认浮层：purge = 真删全部对话（不可恢复）；remove = 删除工作区（解绑，对话归档保留）。 */}
                {confirmProject?.id === project.id && (
                  <div className="mx-1.5 mt-1 flex flex-col gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-2 text-xs shadow-lg">
                    {confirmProject.kind === "purge" ? (
                      <>
                        <div>
                          删除 <span className="font-medium text-foreground">{project.name}</span> 下全部 {total} 个对话？
                        </div>
                        <div className="leading-5 text-muted">
                          进行中 {active.length} · 已归档 {archived.length}，对应 jsonl 会话文件将被永久删除，不可恢复；
                          只想摘掉项目就用「删除工作区」。
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            onClick={() => setConfirmProject(null)}
                            className="cursor-pointer rounded-md border border-border px-2.5 py-1 transition-colors duration-150 hover:bg-background"
                            aria-label="取消"
                          >
                            取消
                          </button>
                          <button
                            onClick={() =>
                              void runBatch(
                                "delete",
                                [...active, ...archived].map((s) => s.id),
                                { confirmed: true },
                              ).then(() => setConfirmProject(null))
                            }
                            disabled={busy}
                            className="cursor-pointer rounded-md bg-danger px-2.5 py-1 text-white transition-opacity duration-150 hover:opacity-90 disabled:opacity-40"
                            aria-label={`确认删除 ${project.name} 全部对话`}
                          >
                            删除 {total} 个对话
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div>
                          删除工作区 <span className="font-medium text-foreground">{project.name}</span>？
                        </div>
                        <div className="leading-5 text-muted">
                          {total > 0
                            ? `只解绑目录，不删任何 jsonl 文件；名下 ${total} 个对话将全部归档保留（含进行中 ${active.length}），可在「未归属会话」的已归档里找回。`
                            : "只解绑目录，不删任何文件；名下暂无对话。"}
                        </div>
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            onClick={() => setConfirmProject(null)}
                            className="cursor-pointer rounded-md border border-border px-2.5 py-1 transition-colors duration-150 hover:bg-background"
                            aria-label="取消"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => void removeWorkspace(project.id)}
                            disabled={busy}
                            className="cursor-pointer rounded-md border border-danger/60 px-2.5 py-1 text-danger transition-colors duration-150 hover:bg-danger/10 disabled:opacity-40"
                            aria-label={`确认删除工作区 ${project.name}`}
                          >
                            删除工作区
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                {project.missing && (
                  <div className="mx-1.5 mb-1 flex items-center gap-1.5 rounded-lg bg-warn/10 px-2 py-1.5 text-[11px] text-warn">
                    <FolderSearch size={12} aria-hidden className="shrink-0" />
                    <span className="min-w-0 flex-1 truncate">目录已不存在，会话仍可回放</span>
                    <button
                      onClick={() => void relocate(project.id, project.name)}
                      className="shrink-0 cursor-pointer rounded border border-warn/40 px-1.5 py-0.5 transition-colors duration-150 hover:bg-warn/15"
                      aria-label={`重定位项目 ${project.name}`}
                      title="重新选择该项目的目录（只改绑定路径，不动会话文件）"
                    >
                      重定位
                    </button>
                  </div>
                )}
                <div className="mt-0.5 space-y-px border-l border-border pl-1.5">
                  <button
                    onClick={async () => {
                      const res = await createSessionIn(project.id, { projectName: project.name });
                      setError(res.ok ? null : res.message);
                    }}
                    disabled={project.missing || busy}
                    className="flex w-full cursor-pointer items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted transition-colors duration-150 hover:bg-background/70 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                    aria-label={`在 ${project.name} 新建会话`}
                  >
                    <Plus size={12} /> 新建会话
                  </button>
                  {active.length === 0 && (
                    <div className="px-2.5 py-1 text-xs text-muted/70">暂无进行中的会话</div>
                  )}
                  {active.map((s) => (
                    <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                  ))}
                  {archived.length > 0 && (
                    <details className="group/arch">
                      <summary className="flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden">
                        <ChevronRight size={11} aria-hidden className="transition-transform duration-150 group-open/arch:rotate-90" />
                        已归档（{archived.length}）
                      </summary>
                      <div className="space-y-0.5">
                        {archived.map((s) => (
                          <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </details>
            );
          })}
          {(visibleOrphanActive.length > 0 || visibleOrphanArchived.length > 0) && (
            <details className="group/orphan mt-1">
              <summary className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={12} aria-hidden className="transition-transform duration-150 group-open/orphan:rotate-90" />
                <span className="min-w-0 flex-1 truncate">未归属会话</span>
                <span className="relative flex h-5 w-[52px] shrink-0 items-center justify-end">
                  <span className="font-mono group-hover/orphan:invisible">{visibleOrphanActive.length + visibleOrphanArchived.length}</span>
                  <span className="absolute inset-y-0 right-0 hidden items-center gap-0.5 group-hover/orphan:flex" onClick={(e) => e.preventDefault()}>
                    <button
                      onClick={() => void runBatch("archive", visibleOrphanActive.map((s) => s.id))}
                      disabled={busy || visibleOrphanActive.length === 0}
                      className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
                      aria-label="归档全部未归属对话"
                      title="归档全部未归属对话（已归档的保持归档）"
                    >
                      <Archive size={12} />
                    </button>
                    <button
                      onClick={() =>
                        void runBatch("delete", [...visibleOrphanActive, ...visibleOrphanArchived].map((s) => s.id))
                      }
                      disabled={busy || visibleOrphanActive.length + visibleOrphanArchived.length === 0}
                      className="flex cursor-pointer items-center justify-center rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
                      aria-label="删除全部未归属对话"
                      title="删除全部未归属对话（含已归档，二次确认）"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </span>
              </summary>
              <div className="mt-0.5 space-y-px border-l border-border pl-1.5">
                {visibleOrphanActive.map((s) => (
                  <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                ))}
                {visibleOrphanArchived.length > 0 && (
                  <details className="group/oarch">
                    <summary className="flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden">
                      <ChevronRight size={11} aria-hidden className="transition-transform duration-150 group-open/oarch:rotate-90" />
                      已归档（{visibleOrphanArchived.length}）
                    </summary>
                    <div className="space-y-0.5">
                      {visibleOrphanArchived.map((s) => (
                        <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                      ))}
                    </div>
                  </details>
                )}
              </div>
            </details>
          )}
          {projects.length === 0 && (
            <div className="px-1.5 py-1 text-xs text-muted">暂无会话，先添加项目</div>
          )}
        </div>
      </div>
      {/* 扫描窗口提示（V2 M7a）：超出窗口的老会话不是不存在，给一次性入口继续往老里扫 */}
      {sessionScan.totalFiles > sessionScan.scannedFiles && (
        <div className="shrink-0 border-t border-border/70 px-3 py-2 text-[11px] text-muted">
          <div>
            已扫描最近 {sessionScan.scannedFiles} 个会话（共 {sessionScan.totalFiles} 个）
          </div>
          <button
            onClick={() => void scanMoreSessions()}
            disabled={sessionScanLimit >= SCAN_MAX}
            className="mt-1 cursor-pointer rounded-lg border border-border px-2 py-0.5 transition-colors duration-150 hover:bg-background hover:text-foreground disabled:cursor-default disabled:opacity-50"
          >
            {sessionScanLimit >= SCAN_MAX ? `已达上限（${SCAN_MAX}）` : `继续扫描更早的 ${SCAN_STEP} 个`}
          </button>
        </div>
      )}
      <div className="shrink-0 border-t border-border px-2 py-2">
        {/* 底部只留设置：「添加项目」已上移到顶部主入口，不在两处重复。 */}
        <button
          onClick={() => set({ settingsOpen: true, sidebarOpen: false })}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150 hover:bg-background/70"
          aria-label="设置"
        >
          <Settings size={15} /> 设置
        </button>
      </div>
      <ConfirmDialog
        open={confirmBatch !== null}
        title={confirmBatch?.title ?? ""}
        detail={confirmBatch?.detail}
        confirmLabel="删除"
        danger
        onCancel={() => setConfirmBatch(null)}
        onConfirm={() => {
          const batch = confirmBatch;
          setConfirmBatch(null);
          if (batch) void runBatch("delete", batch.ids, { confirmed: true });
        }}
      />
    </aside>
  );
}
