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
};

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
  settingsOpen: false,
  sidebarOpen: false,
  update: { status: "idle" },
  updateDismissedVersion: null,
  updateDialogOpen: false,
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
