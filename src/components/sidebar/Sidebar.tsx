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
import { useApp, activeSessionsOf } from "../../stores/app";
import { viewMsgFromJsonlLine } from "../../lib/viewmsg";
import type { SessionView } from "@shared/types";

function SessionRow({ s }: { s: SessionView }) {
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
            onClick={() => api.archiveSession(s.id).then(() => api.listSessions().then((all) => set({ sessions: all })))}
            className="cursor-pointer rounded p-1.5 text-muted transition-colors duration-200 hover:text-foreground"
            aria-label={s.running ? "先停止再归档" : "归档会话"}
          >
            <Archive size={14} />
          </button>
        ) : (
          <button
            onClick={() => api.unarchiveSession(s.id).then(() => api.listSessions().then((all) => set({ sessions: all })))}
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
                api.deleteSession(s.id).then(() =>
                  api.listSessions().then((all) => {
                    set({ sessions: all });
                    setConfirmDelete(false);
                  }),
                )
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
  const app = useApp();
  const { projects, activeProjectId, set } = app;

  useEffect(() => {
    api
      .listSessions(activeProjectId ?? undefined)
      .then((all) => set({ sessions: all }))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId]);

  const active = activeSessionsOf(app, false);
  const archived = activeSessionsOf(app, true);

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
        <div className="mt-2 border-t border-border px-3 pt-2 pb-1">
          <div className="flex items-center">
            <span className="text-xs text-muted">会话</span>
            <button
              onClick={async () => {
                if (!activeProjectId) return;
                try {
                  const created = await api.createSession(activeProjectId);
                  const all = await api.listSessions(activeProjectId);
                  set({ sessions: all, activeSessionId: created.id });
                } catch {
                  // M1-6 补内联错误条
                }
              }}
              disabled={!activeProjectId}
              className="ml-auto flex cursor-pointer items-center gap-1 rounded border border-accent px-2 py-1 text-xs text-accent transition-colors duration-200 hover:bg-accent hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="新建会话"
            >
              <Plus size={12} /> 新建会话
            </button>
          </div>
        </div>
        <div className="px-2 py-1">
          <div className="px-1 py-1 text-xs text-muted">进行中（{active.length}）</div>
          {active.map((s) => (
            <SessionRow key={s.id} s={s} />
          ))}
          <details className="mt-1">
            <summary className="cursor-pointer px-1 py-1 text-xs text-muted">
              已归档（{archived.length}）
            </summary>
            {archived.map((s) => (
              <SessionRow key={s.id} s={s} />
            ))}
          </details>
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
