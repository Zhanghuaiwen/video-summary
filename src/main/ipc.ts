import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { getConfig, setConfig } from './services/config'
import { startPipeline, cancelPipeline, type ProgressEmitter } from './services/pipeline'
import type { Store } from './store'
import {
  IpcChannels,
  type AppConfig,
  type IpcResult,
  type Project,
  type SummaryDoc
} from '@shared/types'

const sendProgress: ProgressEmitter = (p) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.events.progress, p)
  }
}

const VIDEO_FILTERS = [
  { name: '视频/音频', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'mp3', 'm4a', 'wav', 'flac'] }
]

export function registerIpc(store: Store): void {
  ipcMain.handle(IpcChannels.appInfo, (): IpcResult<{ name: string; version: string }> => {
    return { ok: true, data: { name: app.getName(), version: app.getVersion() } }
  })

  ipcMain.handle(IpcChannels.config.get, (): IpcResult<AppConfig> => {
    return { ok: true, data: getConfig() }
  })

  ipcMain.handle(IpcChannels.config.set, (_e, patch: Partial<AppConfig>): IpcResult<AppConfig> => {
    try {
      return { ok: true, data: setConfig(patch) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.dialog.pickVideo, async (): Promise<IpcResult<string | null>> => {
    const res = await dialog.showOpenDialog({
      title: '选择视频文件',
      properties: ['openFile'],
      filters: VIDEO_FILTERS
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: true, data: null }
    return { ok: true, data: res.filePaths[0] }
  })

  ipcMain.handle(IpcChannels.project.list, (): IpcResult<Project[]> => {
    return { ok: true, data: store.listProjects() }
  })

  ipcMain.handle(
    IpcChannels.project.create,
    (
      _e,
      input: { title: string; source: Project['source']; sourceUrl?: string; localPath?: string }
    ): IpcResult<Project> => {
      try {
        return { ok: true, data: store.createProject(input) }
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) }
      }
    }
  )

  ipcMain.handle(IpcChannels.project.delete, (_e, id: string): IpcResult<{ id: string }> => {
    try {
      store.deleteProject(id)
      return { ok: true, data: { id } }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.project.start, (_e, id: string): IpcResult<{ id: string }> => {
    const project = store.getProject(id)
    if (!project) return { ok: false, error: '项目不存在' }
    void startPipeline(id, store, sendProgress)
    return { ok: true, data: { id } }
  })

  ipcMain.handle(IpcChannels.project.cancel, (_e, id: string): IpcResult<{ id: string }> => {
    cancelPipeline(id)
    return { ok: true, data: { id } }
  })

  ipcMain.handle(IpcChannels.project.getTranscript, (_e, id: string): IpcResult<string> => {
    const project = store.getProject(id)
    if (!project?.transcriptPath) return { ok: false, error: '尚无转写结果' }
    try {
      return { ok: true, data: readFileSync(project.transcriptPath, 'utf-8') }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IpcChannels.project.getSummary, (_e, id: string): IpcResult<SummaryDoc> => {
    const project = store.getProject(id)
    if (!project?.summaryPath) return { ok: false, error: '尚无总结结果' }
    try {
      return { ok: true, data: JSON.parse(readFileSync(project.summaryPath, 'utf-8')) as SummaryDoc }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
