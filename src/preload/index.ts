import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type AppConfig,
  type IpcResult,
  type ProgressPayload,
  type Project,
  type SummaryDoc
} from '@shared/types'

const api = {
  appInfo: (): Promise<IpcResult<{ name: string; version: string }>> => ipcRenderer.invoke(IpcChannels.appInfo),

  getConfig: (): Promise<IpcResult<AppConfig>> => ipcRenderer.invoke(IpcChannels.config.get),
  setConfig: (patch: Partial<AppConfig>): Promise<IpcResult<AppConfig>> =>
    ipcRenderer.invoke(IpcChannels.config.set, patch),

  pickVideo: (): Promise<IpcResult<string | null>> => ipcRenderer.invoke(IpcChannels.dialog.pickVideo),

  listProjects: (): Promise<IpcResult<Project[]>> => ipcRenderer.invoke(IpcChannels.project.list),
  createProject: (input: {
    title: string
    source: Project['source']
    sourceUrl?: string
    localPath?: string
  }): Promise<IpcResult<Project>> => ipcRenderer.invoke(IpcChannels.project.create, input),
  deleteProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.delete, id),
  startProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.start, id),
  cancelProject: (id: string): Promise<IpcResult<{ id: string }>> =>
    ipcRenderer.invoke(IpcChannels.project.cancel, id),
  getTranscript: (id: string): Promise<IpcResult<string>> =>
    ipcRenderer.invoke(IpcChannels.project.getTranscript, id),
  getSummary: (id: string): Promise<IpcResult<SummaryDoc>> =>
    ipcRenderer.invoke(IpcChannels.project.getSummary, id),

  onProgress: (cb: (payload: ProgressPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: ProgressPayload): void => cb(payload)
    ipcRenderer.on(IpcChannels.events.progress, listener)
    return () => ipcRenderer.removeListener(IpcChannels.events.progress, listener)
  }
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('api', api)
