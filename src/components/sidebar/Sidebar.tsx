import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  FolderPlus,
  Plus,
  Settings,
  Trash2,
} from "lucide-react";
import { api } from "@shared/api";
import { useApp } from "../../stores/app";
import { groupSessionsByProject } from "../../lib/sessions";
import { viewMsgFromJsonlLine } from "../../lib/viewmsg";
import type { SessionView } from "@shared/types";

function SessionRow({ s, onChanged }: { s: SessionView; onChanged: () => void }) {
  const { activeSessionId, set, appendEvents } = useApp();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const active = s.id === activeSessionId;
  return (
    <div
      className={`group rounded-lg px-2.5 py-2 transition-colors duration-150 ${
        active ? "bg-background shadow-[inset_0_0_0_1px_var(--color-border)]" : "hover:bg-background/60"
      }`}
    >
      <button
        onClick={async () => {
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
        }}
        className="block w-full cursor-pointer text-left"
        aria-label={`会话 ${s.title}`}
      >
        <div className="flex items-center gap-1.5">
          {s.running && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-label="运行中" />
          )}
          <div className={`truncate text-[13px] ${active ? "font-medium" : ""}`}>{s.title}</div>
        </div>
        <div className="mt-0.5 truncate pl-3 font-mono text-[11px] text-muted">
          {s.corrupt ? "已损坏，可删除" : new Date(s.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
        </div>
      </button>
      <div className="mt-0.5 hidden gap-0.5 pl-3 group-hover:flex">
        {!s.archived ? (
          <button
            onClick={() => api.archiveSession(s.id).then(onChanged)}
            className="cursor-pointer rounded-md p-1.5 text-muted opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-background hover:text-foreground"
            aria-label={s.running ? "先停止再归档" : "归档会话"}
          >
            <Archive size={13} />
          </button>
        ) : (
          <button
            onClick={() => api.unarchiveSession(s.id).then(onChanged)}
            className="cursor-pointer rounded-md p-1.5 text-muted opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-background hover:text-foreground"
            aria-label="取消归档"
          >
            <ArchiveRestore size={13} />
          </button>
        )}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="cursor-pointer rounded-md p-1.5 text-muted opacity-0 transition-all duration-150 group-hover:opacity-100 hover:bg-background hover:text-danger"
            aria-label="删除会话"
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <span className="flex items-center gap-1 text-xs">
            <span className="text-danger">不可恢复，确认？</span>
            <button
              onClick={() =>
                api.deleteSession(s.id).then(() => {
                  onChanged();
                  setConfirmDelete(false);
                })
              }
              className="cursor-pointer rounded-md bg-danger px-2 py-0.5 text-white"
              aria-label="确认删除"
            >
              删除
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="cursor-pointer rounded-md border border-border px-2 py-0.5"
              aria-label="取消删除"
            >
              取消
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export function Sidebar() {
  const { projects, sessions, activeProjectId, set } = useApp();

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

  const { groups, orphanActive, orphanArchived } = groupSessionsByProject(projects, sessions);

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-sidebar md:w-66">
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
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
          {groups.map(({ project, active, archived }) => (
            <details key={project.id} className="group/proj mt-1" open>
              <summary
                className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden"
                aria-label={`项目 ${project.name} 的会话，进行中 ${active.length}，已归档 ${archived.length}`}
              >
                <ChevronRight size={12} aria-hidden className="shrink-0 transition-transform duration-150 group-open/proj:rotate-90" />
                <span className="truncate font-medium text-foreground">{project.name}</span>
                <span className="ml-auto shrink-0 font-mono">
                  {active.length}{archived.length > 0 ? ` · ${archived.length}` : ""}
                </span>
                {project.missing && <span className="shrink-0 text-warn">缺失</span>}
              </summary>
              <div className="mt-0.5 space-y-0.5 border-l border-border pl-1.5">
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
          {(orphanActive.length > 0 || orphanArchived.length > 0) && (
            <details className="group/orphan mt-1">
              <summary className="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden">
                <ChevronRight size={12} aria-hidden className="transition-transform duration-150 group-open/orphan:rotate-90" />
                未归属会话
                <span className="ml-auto font-mono">{orphanActive.length + orphanArchived.length}</span>
              </summary>
              <div className="mt-0.5 space-y-0.5 border-l border-border pl-1.5">
                {orphanActive.map((s) => (
                  <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                ))}
                {orphanArchived.length > 0 && (
                  <details className="group/oarch">
                    <summary className="flex cursor-pointer items-center gap-1 rounded-md px-2.5 py-1 text-[11px] text-muted transition-colors duration-150 hover:bg-background/70 [&::-webkit-details-marker]:hidden">
                      <ChevronRight size={11} aria-hidden className="transition-transform duration-150 group-open/oarch:rotate-90" />
                      已归档（{orphanArchived.length}）
                    </summary>
                    <div className="space-y-0.5">
                      {orphanArchived.map((s) => (
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
