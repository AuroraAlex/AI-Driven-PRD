import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ProjectSession {
  canvasSessionId: string | null
  chatSessionId: string | null
  prdId: string | null
}

interface SessionState {
  /** project_id → currently active session ids */
  byProject: Record<string, ProjectSession>
  setCanvasSessionId: (projectId: string, sessionId: string | null) => void
  setChatSessionId: (projectId: string, sessionId: string | null) => void
  setPrdId: (projectId: string, prdId: string | null) => void
  getCanvasSessionId: (projectId: string) => string | null
  getChatSessionId: (projectId: string) => string | null
  getPrdId: (projectId: string) => string | null
}

const ensure = (state: SessionState, projectId: string): ProjectSession =>
  state.byProject[projectId] ?? { canvasSessionId: null, chatSessionId: null, prdId: null }

export const useSessionStore = create<SessionState>()(
  persist(
    (set, get) => ({
      byProject: {},
      setCanvasSessionId: (projectId, sessionId) =>
        set(s => ({
          byProject: {
            ...s.byProject,
            [projectId]: { ...ensure(s, projectId), canvasSessionId: sessionId },
          },
        })),
      setChatSessionId: (projectId, sessionId) =>
        set(s => ({
          byProject: {
            ...s.byProject,
            [projectId]: { ...ensure(s, projectId), chatSessionId: sessionId },
          },
        })),
      setPrdId: (projectId, prdId) =>
        set(s => ({
          byProject: {
            ...s.byProject,
            [projectId]: { ...ensure(s, projectId), prdId },
          },
        })),
      getCanvasSessionId: projectId => get().byProject[projectId]?.canvasSessionId ?? null,
      getChatSessionId: projectId => get().byProject[projectId]?.chatSessionId ?? null,
      getPrdId: projectId => get().byProject[projectId]?.prdId ?? null,
    }),
    { name: 'ai-prd-sessions' },
  ),
)
