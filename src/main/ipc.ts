import { app, dialog, ipcMain, BrowserWindow, shell } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { getConfig, setConfig, saveRecentPrompt, summaryFallbackModel } from './services/config'
import { startPipeline, cancelPipeline, type ProgressEmitter } from './services/pipeline'
import { parseJson, parseOpml, parseFreeMind, parseXMindBytes, parseXMind8Xml, detectFormat, serializeJson, serializeOpml, serializeFreeMind, serializeXMind, serializeMarkdown, fromImported, EXPORT_EXTENSIONS } from './services/mindmap-formats'
import { searchProjects } from './services/search'
import type { Store } from './store'
import { toErrorMessage } from '@shared/errors'
import {
  IpcChannels,
  type AppConfig,
  type CreateProjectInput,
  type DialogResult,
  type IpcResult,
  type ImportResult,
  type MindMapDoc,
  type MindMapExportFormat,
  type Project,
  type SaveMindMapInput,
  type SummaryDoc
} from '@shared/types'

const sendProgress: ProgressEmitter = (p) => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.events.progress, p)
  }
}

export const sendProjectUpdated = (project: Project): void => {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IpcChannels.events.projectUpdated, { project })
  }
}

const VIDEO_FILTERS = [
  { name: '视频/音频', extensions: ['mp4', 'mkv', 'webm', 'mov', 'avi', 'flv', 'm4v', 'mp3', 'm4a', 'wav', 'flac'] }
]

const MINDMAP_OPEN_FILTERS = [
  { name: '思维导图', extensions: ['xmind', 'mm', 'opml', 'json', 'xml'] },
  { name: '所有文件', extensions: ['*'] }
]

async function handle<T>(fn: () => T | Promise<T>): Promise<IpcResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    return { ok: false, error: toErrorMessage(err) }
  }
}

function projectWorkDir(projectId: string): string {
  return join(app.getPath('userData'), 'projects', projectId)
}

function readMindMapDoc(store: Store, projectId: string): MindMapDoc {
  const doc = store.getMindMap(projectId)
  if (!doc || !doc.root || typeof doc.root.title !== 'string') throw new Error('该项目尚无思维导图')
  return doc
}

export function registerIpc(store: Store): void {
  ipcMain.handle(IpcChannels.appInfo, () =>
    handle((): { name: string; version: string } => ({ name: app.getName(), version: app.getVersion() }))
  )

  ipcMain.handle(IpcChannels.config.get, () => handle(() => getConfig()))

  ipcMain.handle(IpcChannels.config.set, (_e, patch: Partial<AppConfig>) =>
    handle(() => setConfig(patch))
  )

  ipcMain.handle(IpcChannels.config.recentPrompt, (_e, prompt: string) =>
    handle(() => saveRecentPrompt(prompt))
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
    (_e, input: CreateProjectInput) =>
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

  // 重新分析：清空已有产物/断点后从头跑管线
  // （媒体文件按需修复/下载：已有完整视频直接复用，纯音频半成品自动补下）
  ipcMain.handle(IpcChannels.project.restart, (_e, id: string) =>
    handle(() => {
      const project = store.getProject(id)
      if (!project) throw new Error('项目不存在')
      store.clearProjectAnalysis(id)
      void startPipeline(id, store, sendProgress, { noCache: true })
      return { id }
    })
  )

  ipcMain.handle(IpcChannels.project.getTranscript, (_e, id: string) =>
    handle(() => {
      const t = store.getTranscript(id)
      if (t == null) throw new Error('尚无转写结果')
      return t
    })
  )

  ipcMain.handle(IpcChannels.project.getSummary, (_e, id: string) =>
    handle(() => {
      const s = store.getSummary(id)
      if (!s) throw new Error('尚无总结结果')
      return s
    })
  )

  // 重新生成总结：仅重跑总结阶段（复用已有转写/视觉产物），不动媒体与思维导图
  ipcMain.handle(IpcChannels.project.regenerateSummary, (_e, id: string) =>
    handle(async (): Promise<SummaryDoc> => {
      const project = store.getProject(id)
      if (!project) throw new Error('项目不存在')
      const transcriptText = store.getTranscript(id)
      if (transcriptText == null) throw new Error('尚无转写文字稿，无法生成总结')
      const { summarizeTranscript } = await import('./services/summarizer')
      const { buildVisionBrief } = await import('./services/vision')
      const { attachChapterFrames } = await import('./services/frame-attach')
      const vision = store.getVision(id)
      const visionBrief = vision && vision.frames.length > 0 ? buildVisionBrief(vision.frames) : undefined
      const customPrompt = project.analysisConfig?.customPrompt?.trim() || undefined
      const result = await summarizeTranscript(
        transcriptText,
        project.title,
        (pct) =>
          sendProgress({ projectId: id, stage: 'summarizing', progress: pct, message: '正在重新生成总结…' }),
        { customPrompt, model: getConfig().llmModel, fallbackModel: summaryFallbackModel() },
        visionBrief
      )
      const summary: SummaryDoc = { ...result, projectId: id, createdAt: new Date().toISOString() }
      if (vision && vision.frames.length > 0 && summary.chapters.length > 0) {
        attachChapterFrames(summary, vision.frames)
      }
      store.saveSummary(id, summary)
      store.updateProject(id, {
        checkpoint: { ...(project.checkpoint ?? {}), llmModel: getConfig().llmModel, summaryDone: true },
        progress: 100
      })
      sendProgress({ projectId: id, stage: 'done', progress: 100, message: '总结已重新生成' })
      return summary
    })
  )

  ipcMain.handle(IpcChannels.project.getVision, (_e, id: string) =>
    handle(() => {
      const v = store.getVision(id)
      if (!v) throw new Error('尚无视觉分析结果')
      return v
    })
  )

  ipcMain.handle(IpcChannels.project.openFolder, (_e, id: string) =>
    handle(async () => {
      const project = store.getProject(id)
      if (!project) throw new Error('项目不存在')
      const dir = projectWorkDir(id)
      mkdirSync(dir, { recursive: true })
      const err = await shell.openPath(dir)
      if (err) throw new Error(err)
      return { path: dir }
    })
  )

  ipcMain.handle(IpcChannels.project.playMedia, (_e, id: string) =>
    handle(async () => {
      const project = store.getProject(id)
      if (!project?.mediaPath || !existsSync(project.mediaPath)) throw new Error('该任务没有可播放的媒体文件')
      const err = await shell.openPath(project.mediaPath)
      if (err) throw new Error(err)
      return { path: project.mediaPath }
    })
  )

  // ---------- 思维导图 ----------

  ipcMain.handle(IpcChannels.mindmap.get, (_e, id: string) =>
    handle(() => {
      const project = store.getProject(id)
      if (!project) throw new Error('项目不存在')
      return readMindMapDoc(store, id)
    })
  )

  ipcMain.handle(IpcChannels.mindmap.save, (_e, input: SaveMindMapInput) =>
    handle(() => {
      const project = store.getProject(input.projectId)
      if (!project) throw new Error('项目不存在')
      const doc = input.doc
      if (!doc || !doc.root || typeof doc.root.title !== 'string') throw new Error('思维导图数据无效')
      doc.updatedAt = new Date().toISOString()
      store.saveMindMap(input.projectId, doc)
      return doc
    })
  )

  ipcMain.handle(IpcChannels.mindmap.export, (_e, input: { projectId: string; format: MindMapExportFormat }) =>
    handle(async (): Promise<DialogResult> => {
      const project = store.getProject(input.projectId)
      if (!project) throw new Error('项目不存在')
      const doc = readMindMapDoc(store, input.projectId)
      const ext = EXPORT_EXTENSIONS[input.format] ?? '.mindmap.json'
      const safeName = (doc.title || project.title || 'mindmap').replace(/[\\/:*?"<>|]/g, '_')
      const res = await dialog.showSaveDialog({
        title: '导出思维导图',
        defaultPath: join(app.getPath('downloads'), `${safeName}${ext}`),
        filters: [{ name: '思维导图', extensions: [ext.replace(/^\./, '')] }]
      })
      if (res.canceled || !res.filePath) return { path: null, canceled: true }
      const bytes = serializeForExport(input.format, doc)
      writeFileSync(res.filePath, bytes)
      return { path: res.filePath, canceled: false }
    })
  )

  ipcMain.handle(IpcChannels.mindmap.import, (_e, projectId: string) =>
    handle(async (): Promise<ImportResult> => {
      const res = await dialog.showOpenDialog({
        title: '导入思维导图',
        properties: ['openFile'],
        filters: MINDMAP_OPEN_FILTERS
      })
      if (res.canceled || res.filePaths.length === 0) throw new Error('已取消导入')
      const file = res.filePaths[0]
      const raw = readFileSync(file)
      const format = detectFormat(new Uint8Array(raw))
      let imported
      if (format === 'xmind') {
        imported = parseXMindBytes(new Uint8Array(raw))
      } else {
        const text = raw.toString('utf-8')
        if (format === 'json') imported = parseJson(text)
        else if (format === 'opml') imported = parseOpml(text)
        else if (format === 'freemind') imported = parseFreeMind(text)
        else if (format === 'xmind8') imported = parseXMind8Xml(text)
        else throw new Error('无法识别的格式')
      }
      const root = fromImported(imported)
      const now = new Date().toISOString()
      const baseName = file.split(/[\\/]/).pop() ?? '导入'
      const doc: MindMapDoc = {
        id: crypto.randomUUID(),
        projectId,
        title: imported.title || baseName.replace(/\.[^.]+$/, ''),
        root,
        createdAt: now,
        updatedAt: now
      }
      return { doc, format }
    })
  )

ipcMain.handle(IpcChannels.mindmap.regenerate, (_e, projectId: string) =>
    handle(async (): Promise<MindMapDoc> => {
      const project = store.getProject(projectId)
      if (!project) throw new Error('项目不存在')
      if (store.getTranscript(projectId) == null || !store.getSummary(projectId)) throw new Error('尚无文字稿与总结，无法生成思维导图')
      const summary = store.getSummary(projectId)!
      const vision = store.getVision(projectId)
      if (!vision) throw new Error('尚无时间轴数据，无法生成思维导图')
      const { generateMindMap, createMindMapDoc, clampMindMapTimes } = await import('./services/mindmap')
      const { capTimedTranscript, buildSummaryDigest } = await import('./services/pipeline')
      const { attachNodeFrames } = await import('./services/frame-attach')
      const { buildVisionBrief } = await import('./services/vision')
      const { probeMediaDuration } = await import('./services/video')
      const { buildTimeline } = await import('./services/timeline')
      const { SEGMENT_SECONDS } = await import('./services/audio')
      const { getConfig } = await import('./services/config')
      // 用真实媒体时长修复旧版时间轴，避免把「0~10:00」的伪标签喂给导图模型
      const mediaDuration = project.mediaPath ? await probeMediaDuration(project.mediaPath).catch(() => undefined) : undefined
      if (mediaDuration && mediaDuration > 0 && vision.segments.length > 0) {
        const blocks = vision.segments.map((s) => ({ text: s.transcript, startTime: s.startTime }))
        const fixed = buildTimeline(blocks, vision.frames ?? [], SEGMENT_SECONDS, mediaDuration)
        if (fixed.length > 0) {
          vision.segments = fixed
          // 写回修复后的时间轴，后续断点续跑/再次生成不再拿到未钳制的伪标签
          store.saveVision(projectId, vision)
        }
      }
      const root = await generateMindMap(
        {
          title: summary.title,
          timedTranscript: capTimedTranscript(vision.segments),
          summaryDigest: buildSummaryDigest(summary),
          visionBrief: vision.frames.length > 0 ? buildVisionBrief(vision.frames) : undefined,
          durationSec: mediaDuration
        },
        { customPrompt: project.analysisConfig?.customPrompt?.trim() || undefined, model: getConfig().llmModel }
      )
      clampMindMapTimes(root, mediaDuration ?? 0)
      attachNodeFrames(root, vision.frames)
      const doc = createMindMapDoc(projectId, summary.title, root)
      store.saveMindMap(projectId, doc)
      store.updateProject(projectId, {
        checkpoint: { ...(project.checkpoint ?? {}), llmModel: getConfig().llmModel, mindmapDone: true }
      })
      return doc
    })
  )

  ipcMain.handle(IpcChannels.mindmap.recent, () =>
    handle(() => {
      return store
        .listProjects()
        .filter((p) => store.hasMindMap(p.id))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
        .slice(0, 8)
        .map((p) => ({ id: p.id, title: p.title, updatedAt: p.updatedAt }))
    })
  )

  // ---------- 全文检索 ----------

  ipcMain.handle(IpcChannels.search.query, (_e, query: string) =>
    handle(() => searchProjects(query, store))
  )
}

function serializeForExport(format: MindMapExportFormat, doc: MindMapDoc): string | Uint8Array {
  switch (format) {
    case 'json':
      return serializeJson(doc)
    case 'opml':
      return serializeOpml(doc)
    case 'freemind':
      return serializeFreeMind(doc)
    case 'xmind':
      return serializeXMind(doc)
    case 'markdown':
      return serializeMarkdown(doc)
  }
}