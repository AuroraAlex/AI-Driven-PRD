import { create } from 'zustand'
import type { Project } from '../api/client'

interface ProjectState {
  projects: Project[]
  current: Project | null
  setProjects: (p: Project[]) => void
  setCurrent: (p: Project | null) => void
  upsert: (p: Project) => void
  remove: (id: string) => void
}

export const useProjectStore = create<ProjectState>(set => ({
  projects: [],
  current: null,
  setProjects: projects => set({ projects }),
  setCurrent: current => set({ current }),
  upsert: p =>
    set(s => {
      const idx = s.projects.findIndex(x => x.id === p.id)
      const projects = idx >= 0
        ? s.projects.map(x => (x.id === p.id ? p : x))
        : [p, ...s.projects]
      return { projects, current: s.current?.id === p.id ? p : s.current }
    }),
  remove: id =>
    set(s => ({
      projects: s.projects.filter(x => x.id !== id),
      current: s.current?.id === id ? null : s.current,
    })),
}))
