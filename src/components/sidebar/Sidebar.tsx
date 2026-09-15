import { useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Archive,
  ArchiveRestore,
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
      className={`group rounded px-2 py-1.5 ${active ? "bg-background" : "hover:bg-background"}`}
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
        <div className="truncate text-sm">{s.title}</div>
        <div className="truncate text-xs text-muted">
          {s.corrupt ? "已损坏，可删除" : new Date(s.timestamp).toLocaleString("zh-CN")}
        </div>
      </button>
      <div className="mt-0.5 hidden gap-1 group-hover:flex">
        {!s.archived ? (
          <button
            onClick={() => api.archiveSession(s.id).then(onChanged)}
            className="cursor-pointer rounded p-1.5 text-muted transition-colors duration-200 hover:text-foreground"
            aria-label={s.running ? "先停止再归档" : "归档会话"}
          >
            <Archive size={14} />
          </button>
        ) : (
          <button
            onClick={() => api.unarchiveSession(s.id).then(onChanged)}
            className="cursor-pointer rounded p-1.5 text-muted transition-colors duration-200 hover:text-foreground"
            aria-label="取消归档"
          >
            <ArchiveRestore size={14} />
          </button>
        )}
        {!confirmDelete ? (
          <button
            onClick={() => setConfirmDelete(true)}
            className="cursor-pointer rounded p-1.5 text-muted transition-colors duration-200 hover:text-danger"
            aria-label="删除会话"
          >
            <Trash2 size={14} />
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
              className="cursor-pointer rounded bg-danger px-2 py-1 text-white"
              aria-label="确认删除"
            >
              删除
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="cursor-pointer rounded border border-border px-2 py-1"
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
    <aside className="flex h-full w-full flex-col border-r border-border bg-surface md:w-66">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="px-3 pt-3 pb-1 text-xs text-muted">项目</div>
        {projects.length === 0 ? (
          <div className="px-3 py-2 text-sm text-muted">暂无项目，先添加一个目录</div>
        ) : (
          projects.map((p) => (
            <button
              key={p.id}
              onClick={() => set({ activeProjectId: p.id })}
              className={`block w-full cursor-pointer px-3 py-2 text-left transition-colors duration-200 hover:bg-background ${
                p.id === activeProjectId ? "bg-background" : ""
              }`}
              aria-label={`项目 ${p.name}`}
            >
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">{p.name}</span>
                {p.missing && <span className="text-xs text-warn">目录缺失</span>}
                <span className="ml-auto text-xs text-muted">{p.sessionCount}</span>
              </div>
              <div className="truncate font-mono text-xs text-muted">{p.path}</div>
            </button>
          ))
        )}
        <div className="px-2 py-1">
          {groups.map(({ project, active, archived }) => (
            <details key={project.id} className="mt-1" open>
              <summary
                className="cursor-pointer rounded px-1 py-1 text-xs text-muted transition-colors duration-200 hover:bg-background"
                aria-label={`项目 ${project.name} 的会话，进行中 ${active.length}，已归档 ${archived.length}`}
              >
                <span className="font-medium text-foreground">{project.name}</span>
                <span className="ml-1">
                  进行中 {active.length} · 已归档 {archived.length}
                </span>
                {project.missing && <span className="ml-1 text-warn">目录缺失</span>}
              </summary>
              <div className="px-1 pt-1">
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
                  className="mb-1 ml-auto flex cursor-pointer items-center gap-1 rounded border border-accent px-2 py-1 text-xs text-accent transition-colors duration-200 hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                  aria-label={`在 ${project.name} 新建会话`}
                >
                  <Plus size={12} /> 新建会话
                </button>
                {active.length === 0 && (
                  <div className="px-1 py-1 text-xs text-muted">暂无进行中的会话</div>
                )}
                {active.map((s) => (
                  <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                ))}
                {archived.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer px-1 py-1 text-xs text-muted">
                      已归档（{archived.length}）
                    </summary>
                    {archived.map((s) => (
                      <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                    ))}
                  </details>
                )}
              </div>
            </details>
          ))}
          {(orphanActive.length > 0 || orphanArchived.length > 0) && (
            <details className="mt-1">
              <summary className="cursor-pointer px-1 py-1 text-xs text-muted">
                未归属会话（{orphanActive.length + orphanArchived.length}）
              </summary>
              {orphanActive.map((s) => (
                <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
              ))}
              {orphanArchived.length > 0 && (
                <details className="mt-1">
                  <summary className="cursor-pointer px-1 py-1 text-xs text-muted">
                    已归档（{orphanArchived.length}）
                  </summary>
                  {orphanArchived.map((s) => (
                    <SessionRow key={s.id} s={s} onChanged={refreshSessions} />
                  ))}
                </details>
              )}
            </details>
          )}
          {projects.length === 0 && (
            <div className="px-1 py-1 text-xs text-muted">暂无会话，先添加项目</div>
          )}
        </div>
      </div>
      <div className="shrink-0 border-t border-border p-2">
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
          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm transition-colors duration-200 hover:bg-background"
          aria-label="添加项目"
        >
          <FolderPlus size={16} /> 添加项目
        </button>
        <button
          onClick={() => set({ settingsOpen: true, sidebarOpen: false })}
          className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-2 text-sm transition-colors duration-200 hover:bg-background"
          aria-label="设置"
        >
          <Settings size={16} /> 设置
        </button>
      </div>
    </aside>
  );
}

export function SessionList() {
  return null;
}
