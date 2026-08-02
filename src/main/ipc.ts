import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { readFileSync } from 'fs'
import { getConfig, setConfig } from './services/config'
import { startPipeline, cancelPipeline, type ProgressEmitter } from './services/pipeline'
import type { Store } from './store'
import { toErrorMessage } from '@shared/errors'
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

async function handle<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) }
  }
}

export function registerIpc(store: Store): void {
  ipcMain.handle(IpcChannels.appInfo, () =>
    handle((): { name: string; version: string } => ({ name: app.getName(), version: app.getVersion() }))
  )

  ipcMain.handle(IpcChannels.config.get, () => handle(() => getConfig()))

  ipcMain.handle(IpcChannels.config.set, (_e, patch: Partial<AppConfig>) =>
    handle(() => setConfig(patch))
  )

  ipcMain.handle(IpcChannels.dialog.pickVideo, () =>
    handle(async (): Promise<string | null> => {
      const res = await dialog.showOpenDialog({
        title: '选择视频文件',
        properties: ['openFile'],
        filters: VIDEO_FILTERS
      })
      if (res.canceled || res.filePaths.length === 0) return null
      return res.filePaths[0]
    })
  )

  ipcMain.handle(IpcChannels.project.list, () => handle(() => store.listProjects()))

  ipcMain.handle(
    IpcChannels.project.create,
    (_e, input: { title: string; source: Project['source']; sourceUrl?: string; localPath?: string }) =>
      handle(() => store.createProject(input))
  )

  ipcMain.handle(IpcChannels.project.delete, (_e, id: string) =>
    handle(() => {
      store.deleteProject(id)
      return { id }
    })
  )

  ipcMain.handle(IpcChannels.project.start, (_e, id: string) =>
    handle(() => {
      if (!store.getProject(id)) throw new Error('项目不存在')
      void startPipeline(id, store, sendProgress)
      return { id }
    })
  )

  ipcMain.handle(IpcChannels.project.cancel, (_e, id: string) =>
    handle(() => {
      cancelPipeline(id)
      return { id }
    })
  )

  ipcMain.handle(IpcChannels.project.getTranscript, (_e, id: string) =>
    handle(() => {
      const project = store.getProject(id)
      if (!project?.transcriptPath) throw new Error('尚无转写结果')
      return readFileSync(project.transcriptPath, 'utf-8')
    })
  )

  ipcMain.handle(IpcChannels.project.getSummary, (_e, id: string) =>
    handle(() => {
      const project = store.getProject(id)
      if (!project?.summaryPath) throw new Error('尚无总结结果')
      return JSON.parse(readFileSync(project.summaryPath, 'utf-8')) as SummaryDoc
    })
  )
}
