import { create } from 'zustand'
import type { AppConfig, ProgressPayload, Project } from '@shared/types'

export type PageKey = 'home' | 'library' | 'doc' | 'mindmap'

interface AppState {
  page: PageKey
  projects: Project[]
  selectedProjectId: string | null
  config: AppConfig | null
  settingsOpen: boolean
  setPage: (page: PageKey) => void
  setProjects: (projects: Project[]) => void
  applyProgress: (payload: ProgressPayload) => void
  setSelectedProject: (id: string | null) => void
  setConfig: (config: AppConfig) => void
  setSettingsOpen: (open: boolean) => void
}

export const useAppStore = create<AppState>((set) => ({
  page: 'home',
  projects: [],
  selectedProjectId: null,
  config: null,
  settingsOpen: false,

  setPage: (page) => set({ page }),

  setProjects: (projects) => set({ projects }),

  applyProgress: (payload) =>
    set((state) => ({
      projects: state.projects.map((p) =>
        p.id === payload.projectId
          ? {
              ...p,
              stage: payload.stage,
              progress: payload.progress,
              error: payload.stage === 'failed' ? payload.message : undefined
            }
          : p
      )
    })),

  setSelectedProject: (selectedProjectId) => set({ selectedProjectId }),

  setConfig: (config) => set({ config }),

  setSettingsOpen: (settingsOpen) => set({ settingsOpen })
}))
