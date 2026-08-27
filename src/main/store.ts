import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import type { CreateProjectInput, Project } from '@shared/types'

interface StoreData {
  projects: Project[]
}

export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt'>>

export interface Store {
  listProjects: () => Project[]
  getProject: (id: string) => Project | undefined
  createProject: (input: CreateProjectInput) => Project
  updateProject: (id: string, patch: ProjectPatch) => void
  deleteProject: (id: string) => void
  projectWorkDir: (id: string) => string
}

export function createStore(onProjectUpdated?: (project: Project) => void): Store {
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

  const projectWorkDir = (id: string): string => join(userDataDir, 'projects', id)

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
        analysisConfig: input.analysisConfig,
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
      // 清理工作目录，避免磁盘垃圾累积
      try {
        rmSync(projectWorkDir(id), { recursive: true, force: true })
      } catch {
        // 忽略清理失败
      }
    },

    updateProject: (id, patch) => {
      const idx = data.projects.findIndex((p) => p.id === id)
      if (idx === -1) return
      data.projects[idx] = { ...data.projects[idx], ...patch, updatedAt: new Date().toISOString() }
      persist()
      onProjectUpdated?.(data.projects[idx])
    },

    projectWorkDir
  }
}