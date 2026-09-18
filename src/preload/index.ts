import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type AppConfig,
  type CreateProjectInput,
  type DialogResult,
  type ImportResult,
  type IpcResult,
  type MindMapDoc,
  type MindMapExportFormat,
  type ProgressPayload,
  type ProjectUpdatedPayload,
  type Project,
  type ProjectSearchHit,
  type SaveMindMapInput,
  type SummaryDoc,
  type VisionDoc
} from '@shared/types'

const api = {
  appInfo: (): Promise<IpcResult<{ name: string; version: string }>> => ipcRenderer.invoke(IpcChannels.appInfo),

  getConfig: (): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.config.get),
  setConfig: (patch: Partial<AppConfig>): Promise<IpcResult<AppConfig>> =>
    ipcRenderer.invoke(IpcChannels.config.set, patch),
  saveRecentPrompt: (prompt: string): Promise<IpcResult<AppConfig>> =>
    ipcRenderer.invoke(IpcChannels.config.recentPrompt, prompt),

  pickVideo: (): Promise<IpcResult<string | null>> => ipcRenderer.invoke(IpcChannels.dialog.pickVideo),

  listProjects: (): Promise<IpcResult<Project[]>> => ipcRenderer.invoke(IpcChannels.project.list),
  createProject: (input: CreateProjectInput): Promise<IpcResult<Project>> =>
    ipcRenderer.invoke(IpcChannels.project.create, input),
  deleteProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.delete, id),
  startProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.start, id),
  cancelProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.cancel, id),
  restartProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.restart, id),
  getTranscript: (id: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannels.project.getTranscript, id),
  getSummary: (id: string): Promise<IpcResult<SummaryDoc>> =>
    ipcRenderer.invoke(IpcChannels.project.getSummary, id),
  regenerateSummary: (id: string): Promise<IpcResult<SummaryDoc>> =>
    ipcRenderer.invoke(IpcChannels.project.regenerateSummary, id),
  getVision: (id: string): Promise<IpcResult<VisionDoc>> =>
    ipcRenderer.invoke(IpcChannels.project.getVision, id),
  openFolder: (id: string): Promise<IpcResult<{ path: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.openFolder, id),
  playMedia: (id: string): Promise<IpcResult<{ path: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.playMedia, id),

  mindmapGet: (id: string): Promise<IpcResult<MindMapDoc>> => ipcRenderer.invoke(IpcChannels.mindmap.get, id),
  mindmapSave: (input: SaveMindMapInput): Promise<IpcResult<MindMapDoc>> =>
    ipcRenderer.invoke(IpcChannels.mindmap.save, input),
  mindmapExport: (input: { projectId: string; format: MindMapExportFormat }): Promise<IpcResult<DialogResult>> =>
    ipcRenderer.invoke(IpcChannels.mindmap.export, input),
  mindmapImport: (projectId: string): Promise<IpcResult<ImportResult>> =>
    ipcRenderer.invoke(IpcChannels.mindmap.import, projectId),
  mindmapRegenerate: (projectId: string): Promise<IpcResult<MindMapDoc>> =>
    ipcRenderer.invoke(IpcChannels.mindmap.regenerate, projectId),
  mindmapRecent: (): Promise<IpcResult<{ id: string; title: string; updatedAt: string }[]>> =>
    ipcRenderer.invoke(IpcChannels.mindmap.recent),

  searchProjects: (query: string): Promise<IpcResult<ProjectSearchHit[]>> =>
    ipcRenderer.invoke(IpcChannels.search.query, query),

  onProgress: (cb: (payload: ProgressPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ProgressPayload): void => cb(payload)
    ipcRenderer.on(IpcChannels.events.progress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.events.progress, listener)
  },

  onProjectUpdated: (cb: (payload: ProjectUpdatedPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ProjectUpdatedPayload): void => cb(payload)
    ipcRenderer.on(IpcChannels.events.projectUpdated, listener)
    return () => ipcRenderer.removeListener(IpcChannels.events.projectUpdated, listener)
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('api', api)