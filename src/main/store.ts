import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { Project } from '@shared/types'

interface StoreData {
  projects: Project[]
}

const DEFAULT_DATA: StoreData = { projects: [] }

export interface Store {
  listProjects: () => Project[]
  getProject: (id: string) => Project | undefined
  createProject: (input: { title: string; source: Project['source']; sourceUrl?: string; localPath?: string }) => Project
  updateProject: (id: string, patch: Partial<Omit<Project, 'id' | 'createdAt'>>) => void
  deleteProject: (id: string) => void
  getData: () => StoreData
}

export function createStore(): Store {
  const file = join(app.getPath('userData'), 'store.json')

  let data: StoreData = DEFAULT_DATA
  if (existsSync(file)) {
    try {
      data = JSON.parse(readFileSync(file, 'utf-8')) as StoreData
    } catch {
      data = DEFAULT_DATA
    }
  }

  const persist = (): void => {
    mkdirSync(join(app.getPath('userData')), { recursive: true })
    writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
  }

  return {
    getData: () => data,

    listProjects: () => data.projects,

    getProject: (id) => data.projects.find((p) => p.id === id),

    createProject: (input) => {
      const project: Project = {
        id: crypto.randomUUID(),
        title: input.title,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        localPath: input.localPath ?? null,
        stage: 'queued',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
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
