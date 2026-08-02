import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { Project } from '@shared/types'

interface StoreData {
  projects: Project[]
}

export interface Store {
  listProjects: () => Project[]
  getProject: (id: string) => Project | undefined
  createProject: (input: { title: string; source: Project['source']; sourceUrl?: string; localPath?: string }) => Project
  updateProject: (id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) => void
  deleteProject: (id: string) => void
}

export function createStore(): Store {
  const userDataDir = app.getPath('userData')
  const file = join(userDataDir, 'store.json')

  let data: StoreData = { projects: [] }
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf-8')) as StoreData
    } catch {
      data = { projects: [] }
    }
  }

  const persist = (): void => {
    mkdirSync(userDataDir, { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  }

  return {
    listProjects: () => data.projects,

    getProject: (id) => data.projects.find((p) => p.id === id),

    createProject: (input) => {
      const now = new Date().toISOString()
      const project: Project = {
        id: crypto.randomUUID(),
        title: input.title,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        localPath: input.localPath ?? null,
        stage: 'queued',
        progress: 0,
        createdAt: now,
        updatedAt: now
      }
      data.projects.unshift(project)
      persist()
      return project
    },

    deleteProject: (id) => {
      data.projects = data.projects.filter((p) => p.id !== id)
      persist()
    },

    updateProject: (id, patch) => {
      const idx = data.projects.findIndex((p) => p.id === id)
      if (idx === -1) return
      data.projects[idx] = { ...data.projects[idx], ...patch, updatedAt: new Date().toISOString() }
      persist()
    }
  }
}
