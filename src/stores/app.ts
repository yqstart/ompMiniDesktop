import { create } from "zustand";
import type { HealthInfo, ModelCatalog, ProjectView, SessionStatus, SessionView, UpdateState, ViewMsg } from "@shared/types";

type AppState = {
  health: HealthInfo | null;
  projects: ProjectView[];
  activeProjectId: string | null;
  sessions: SessionView[];
  activeSessionId: string | null;
  eventsBySession: Record<string, ViewMsg[]>;
  statusBySession: Record<string, SessionStatus>;
  drafts: Record<string, string>;
  models: ModelCatalog | null;
  currentModel: string | null;
  currentThinking: string | null;
  sessionApprovals: Record<string, string>;
  /** 输入框工具行下拉互斥：model | thinking | permission | null。 */
  composerMenu: "model" | "thinking" | "permission" | null;
  settingsOpen: boolean;
  sidebarOpen: boolean;
  update: UpdateState;
  updateDismissedVersion: string | null;
  /** 更新弹窗显隐（available 常驻入口，弹窗可单独关闭=稍后）。 */
  updateDialogOpen: boolean;
  set: (p: Partial<AppState>) => void;
  draftOf: (sid: string | null) => string;
  setDraft: (sid: string | null, text: string) => void;
  appendEvents: (sid: string, msgs: ViewMsg[]) => void;
  /** 左侧栏宽度（220–480，默认 264，持久化 localStorage）。 */
  sidebarWidth: number;
  setSidebarWidth: (w: number) => void;
  /** 会话多选（批量归档/删除用，key 为 session id）。 */
  selectedSessions: Record<string, boolean>;
  toggleSessionSelected: (id: string) => void;
  clearSessionSelected: () => void;
};

export const SIDEBAR_MIN = 220;
export const SIDEBAR_MAX = 480;
export const SIDEBAR_DEFAULT = 264;

function loadSidebarWidth(): number {
  try {
    if (typeof localStorage === "undefined") return SIDEBAR_DEFAULT;
    const v = Number(localStorage.getItem("omp.sidebarWidth"));
    if (!Number.isFinite(v)) return SIDEBAR_DEFAULT;
    return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, v));
  } catch {
    // 无痕模式等取不到持久化时回默认宽度
    return SIDEBAR_DEFAULT;
  }
}

export const useApp = create<AppState>((set, get) => ({
  health: null,
  projects: [],
  activeProjectId: null,
  sessions: [],
  activeSessionId: null,
  eventsBySession: {},
  statusBySession: {},
  drafts: {},
  models: null,
  currentModel: null,
  currentThinking: null,
  sessionApprovals: {},
  composerMenu: null,
  settingsOpen: false,
  sidebarOpen: false,
  update: { status: "idle" },
  updateDismissedVersion: null,
  updateDialogOpen: false,
  sidebarWidth: loadSidebarWidth(),
  setSidebarWidth: (w) => {
    const v = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));
    try {
      localStorage.setItem("omp.sidebarWidth", String(v));
    } catch {
      // 持久化失败不阻断本次拖拽
    }
    set({ sidebarWidth: v });
  },
  selectedSessions: {},
  toggleSessionSelected: (id) =>
    set((s) => {
      const next = { ...s.selectedSessions };
      if (next[id]) delete next[id];
      else next[id] = true;
      return { selectedSessions: next };
    }),
  clearSessionSelected: () => set({ selectedSessions: {} }),
  set: (p) => set(p),
  draftOf: (sid) => (sid ? (get().drafts[sid] ?? "") : ""),
  setDraft: (sid, text) =>
    set((s) => ({ drafts: sid ? { ...s.drafts, [sid]: text } : s.drafts })),
  appendEvents: (sid, msgs) =>
    set((s) => ({
      eventsBySession: {
        ...s.eventsBySession,
        [sid]: [...(s.eventsBySession[sid] ?? []), ...msgs],
      },
    })),
}));

export const activeSessionsOf = (s: AppState, archived: boolean) =>
  s.sessions.filter((x) => x.archived === archived);
