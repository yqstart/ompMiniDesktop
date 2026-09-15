import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderPlus,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { groupSessionsByProject } from "../../lib/sessions";
import { viewMsgFromJsonlLine } from "../../lib/viewmsg";
import type { SessionView } from "@shared/types";

/**
 * 会话行：单行结构 `● 标题 … 时间/操作`，对齐截图。
 * - 标题单行省略；右侧固定 68px 槽位：平时显示 mono 时间，hover / focus-within 时
 *   时间 visibility 隐藏（占位保留），操作按钮绝对覆盖同一槽位淡入——两者互斥、
 *   外层布局零变化，悬浮不跳动。
 * - 归档、删除都在行内展示，不另起第二行；删除二次确认以浮层覆盖，不撑布局。
 */
function SessionRow({ s, onChanged }: { s: SessionView; onChanged: () => void }) {
  const { activeSessionId, set, appendEvents, selectedSessions, toggleSessionSelected } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = s.id === activeSessionId;
  const selected = !!selectedSessions[s.id];
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
        onClick={(e) => {
          // 修饰键点击 = 多选切换，不打开会话
          if (e.metaKey || e.ctrlKey || e.shiftKey) {
            toggleSessionSelected(s.id);
            return;
          }
          void (async () => {
            set({ activeSessionId: s.id });
            try {
              const history = await api.getHistory(s.id);
              appendEvents(
                s.id,
                history.flatMap((l) => viewMsgFromJsonlLine(l)),
              );
            } catch {
              // 历史加载失败不阻塞选中（横幅在 M1-6 补）
            }
          })();
        }}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left"
        aria-label={`会话 ${s.title}`}
      >
        <span
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? `取消选择会话 ${s.title}` : `选择会话 ${s.title}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleSessionSelected(s.id);
          }}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              e.stopPropagation();
              toggleSessionSelected(s.id);
            }
          }}
          tabIndex={0}
          className={`flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded border transition-colors duration-150 ${
            selected ? "border-accent bg-accent text-white" : "border-border text-transparent hover:border-muted"
          }`}
        >
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.running ? "bg-ok" : "bg-transparent"}`}
          aria-label={s.running ? "运行中" : undefined}
          aria-hidden={!s.running}
        />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? "font-medium" : ""}`}>{s.title}</span>
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
  const { projects, sessions, activeProjectId, selectedSessions, clearSessionSelected, set } = useApp();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // 会话一次全量拉取，前端按项目分组（修复：之前按 activeProjectId 传参，
    // 后端过滤不可靠会导致各项目会话全堆在“进行中”）。
    api
      .listSessions()
      .then((all) => set({ sessions: all }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSessions = () =>
    api
      .listSessions()
      .then((all) => set({ sessions: all }))
      .catch(() => undefined);

  /** 批量操作：ids 为空时 toast 提示；成功后清选择 + 刷新；失败逐条展示。 */
  const runBatch = async (kind: "archive" | "delete", ids: string[]) => {
    if (ids.length === 0) {
      setError("未选中任何会话");
      return;
    }
    if (kind === "delete" && !window.confirm(`确定删除选中的 ${ids.length} 个会话？不可恢复。`)) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = kind === "archive" ? await api.archiveSessions(ids) : await api.deleteSessions(ids);
      clearSessionSelected();
      await refreshSessions();
      if (res.failed.length > 0) {
        setError(`${kind === "archive" ? "归档" : "删除"}部分失败：${res.failed.map((f) => f.message || f.id).join("；")}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : `${kind === "archive" ? "归档" : "删除"}失败`);
    } finally {
      setBusy(false);
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
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 顶部：新建会话（DSH 式主入口） */}
        <button
          onClick={async () => {
            const targetId =
              activeProjectId ?? projects.find((p) => !p.missing)?.id ?? projects[0]?.id;
            if (!targetId) return;
            try {
              const created = await api.createSession(targetId);
              await refreshSessions();
              set({ activeProjectId: targetId, activeSessionId: created.id });
            } catch {
              // M1-6 补内联错误条
            }
          }}
          disabled={projects.length === 0 || projects.every((p) => p.missing)}
          className="mb-2 flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[13px] font-medium text-white transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="新建会话"
        >
          <Plus size={14} aria-hidden /> 新建会话
        </button>
        {/* 搜索入口（V1 仅占位过滤本地列表，后续接全局搜索） */}
        <div className="mb-2 flex items-center gap-2 rounded-lg bg-background/70 px-2.5 py-2 text-[13px] text-muted">
          <Search size={14} aria-hidden className="shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索会话…"
            aria-label="搜索会话"
            className="w-full bg-transparent outline-none placeholder:text-muted/70"
          />
        </div>
        <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-muted">项目</div>
        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-3 py-3 text-[13px] text-muted">
            暂无项目，先添加一个目录
          </div>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ activeProjectId: p.id })}
              className={`mb-0.5 block w-full cursor-pointer rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                p.id === activeProjectId ? "bg-background shadow-[inset_0_0_0_1px_var(--color-border)]" : "hover:bg-background/60"
              }`}
              aria-label={`项目 ${p.name}`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-[13px] font-medium">{p.name}</span>
                {p.missing && <span className="shrink-0 rounded bg-warn/15 px-1 py-px text-[11px] text-warn">目录缺失</span>}
                <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">{p.sessionCount}</span>
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-muted">{p.path}</div>
            </button>
          ))
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
          {Object.keys(selectedSessions).length > 0 && (
            <div className="mb-1 flex items-center gap-1 rounded-md border border-border bg-background/60 px-1.5 py-1 text-xs text-muted">
              <span>已选 {Object.keys(selectedSessions).length}</span>
              <button
                onClick={() => {
                  const ids = Object.keys(selectedSessions);
                  void runBatch("archive", ids);
                }}
                disabled={busy}
                className="ml-auto cursor-pointer rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
                aria-label="批量归档选中会话"
              >
                归档
              </button>
              <button
                onClick={() => {
                  const ids = Object.keys(selectedSessions);
                  void runBatch("delete", ids);
                }}
                disabled={busy}
                className="cursor-pointer rounded px-1.5 py-0.5 transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
                aria-label="批量删除选中会话"
              >
                删除
              </button>
              <button
                onClick={clearSessionSelected}
                className="cursor-pointer rounded px-1 py-0.5 transition-colors duration-150 hover:bg-background"
                aria-label="清空选择"
              >
                <X size={12} />
              </button>
            </div>
          )}
          {visibleGroups.map(({ project, active, archived }) => (
            <details key={project.id} className="group/proj mt-1" open>
              <summary
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden"
                aria-label={`项目 ${project.name} 的会话，进行中 ${active.length}，已归档 ${archived.length}`}
              >
                <ChevronRight size={12} aria-hidden className="shrink-0 transition-transform duration-150 group-open/proj:rotate-90" />
                <span className="truncate font-medium text-foreground">{project.name}</span>
                <span className="ml-auto flex shrink-0 items-center gap-0.5 font-mono">
                  {active.length}{archived.length > 0 ? ` · ${archived.length}` : ""}
                </span>
                {project.missing && <span className="shrink-0 text-warn">缺失</span>}
                {/* 项目级批量操作：归档/删除该项目全部进行中会话 */}
                <span className="hidden shrink-0 items-center gap-0.5 group-hover/proj:flex" onClick={(e) => e.preventDefault()}>
                  <button
                    onClick={() => void runBatch("archive", active.map((s) => s.id))}
                    disabled={busy || active.length === 0}
                    className="cursor-pointer rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
                    aria-label={`归档 ${project.name} 全部进行中会话`}
                    title="归档本项目全部进行中会话"
                  >
                    <Archive size={12} />
                  </button>
                  <button
                    onClick={() => void runBatch("delete", active.map((s) => s.id))}
                    disabled={busy || active.length === 0}
                    className="cursor-pointer rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
                    aria-label={`删除 ${project.name} 全部进行中会话`}
                    title="删除本项目全部进行中会话"
                  >
                    <Trash2 size={12} />
                  </button>
                </span>
              </summary>
              <div className="mt-0.5 space-y-px border-l border-border pl-1.5">
                <button
                  onClick={async () => {
                    try {
                      const created = await api.createSession(project.id);
                      await refreshSessions();
                      set({ activeProjectId: project.id, activeSessionId: created.id });
                    } catch {
                      // M1-6 补内联错误条
                    }
                  }}
                  disabled={project.missing}
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
          ))}
          {(visibleOrphanActive.length > 0 || visibleOrphanArchived.length > 0) && (
            <details className="group/orphan mt-1">
              <summary className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={12} aria-hidden className="transition-transform duration-150 group-open/orphan:rotate-90" />
                未归属会话
                <span className="ml-auto font-mono">{visibleOrphanActive.length + visibleOrphanArchived.length}</span>
                <span className="hidden shrink-0 items-center gap-0.5 group-hover/orphan:flex" onClick={(e) => e.preventDefault()}>
                  <button
                    onClick={() => void runBatch("archive", visibleOrphanActive.map((s) => s.id))}
                    disabled={busy || visibleOrphanActive.length === 0}
                    className="cursor-pointer rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-foreground disabled:opacity-40"
                    aria-label="归档全部未归属会话"
                    title="归档全部未归属会话"
                  >
                    <Archive size={12} />
                  </button>
                  <button
                    onClick={() => void runBatch("delete", visibleOrphanActive.map((s) => s.id))}
                    disabled={busy || visibleOrphanActive.length === 0}
                    className="cursor-pointer rounded p-1 text-muted transition-colors duration-150 hover:bg-background hover:text-danger disabled:opacity-40"
                    aria-label="删除全部未归属会话"
                    title="删除全部未归属会话"
                  >
                    <Trash2 size={12} />
                  </button>
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
      <div className="shrink-0 border-t border-border px-2 py-2">
        <button
          onClick={async () => {
            const dir = await open({ directory: true });
            if (typeof dir !== "string" || !dir) return;
            try {
              const p = await api.addProject(dir);
              const all = await api.listProjects();
              set({ projects: all, activeProjectId: p.id });
            } catch {
              // M1-6 补 toast
            }
          }}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-150 hover:bg-background/70"
          aria-label="添加项目"
        >
          <FolderPlus size={15} /> 添加项目
        </button>
        <button
          onClick={() => set({ settingsOpen: true, sidebarOpen: false })}
          className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] transition-colors duration-150 hover:bg-background/70"
          aria-label="设置"
        >
          <Settings size={15} /> 设置
        </button>
      </div>
    </aside>
  );
}

export function SessionList() {
  return null;
}
