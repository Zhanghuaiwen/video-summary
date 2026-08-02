import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import type { PipelineStage, ProgressPayload, Project } from '@shared/types'
import { toErrorMessage } from '@shared/errors'
import type { Store } from '../store'
import { fetchVideoTitle, downloadAudio } from './video'
import { prepareAudioSegments } from './audio'
import { transcribeBatch } from './transcriber'
import { summarizeTranscript } from './summarizer'

export type ProgressEmitter = (p: ProgressPayload) => void

const running = new Map<string, { cancelled: boolean }>()

export function cancelPipeline(projectId: string): void {
  const ctx = running.get(projectId)
  if (ctx) ctx.cancelled = true
}

function workDir(projectId: string): string {
  return join(app.getPath('userData'), 'projects', projectId)
}

export async function startPipeline(projectId: string, store: Store, emit: ProgressEmitter): Promise<void> {
  const ctx = { cancelled: false }
  running.set(projectId, ctx)

  const getProject = (): Project => {
    const p = store.getProject(projectId)
    if (!p) throw new Error(`项目不存在: ${projectId}`)
    return p
  }

  const setStage = (stage: PipelineStage, progress: number, message?: string): void => {
    store.updateProject(projectId, { stage, progress, error: undefined })
    emit({ projectId, stage, progress, message })
  }

  const dir = workDir(projectId)
  mkdirSync(dir, { recursive: true })
  const checkCancelled = (): void => {
    if (ctx.cancelled) throw new Error('任务已取消')
  }

  try {
    const project = getProject()

    let mediaPath = ''
    if (project.source === 'bilibili' && project.sourceUrl) {
      setStage('downloading', 1, '正在获取视频信息…')
      const title = await fetchVideoTitle(project.sourceUrl)
      store.updateProject(projectId, { title })
      setStage('downloading', 2, '正在下载音频…')
      mediaPath = await downloadAudio(project.sourceUrl, dir, (pct) => {
        setStage('downloading', pct, '正在下载音频…')
      })
    } else if (project.localPath) {
      mediaPath = project.localPath
    } else {
      throw new Error('项目缺少视频来源')
    }
    checkCancelled()

    setStage('extracting', 5, '正在提取音频并分段…')
    const segments = await prepareAudioSegments(mediaPath, dir)
    checkCancelled()
    if (segments.length === 0) throw new Error('未能生成音频分段')

    setStage('transcribing', 0, '正在转写语音…')
    const transcript = await transcribeBatch(segments, (done, total) => {
      setStage('transcribing', Math.round((done / total) * 100), `正在转写 ${done}/${total} 段…`)
    })
    checkCancelled()
    if (!transcript.trim()) throw new Error('转写结果为空')

    const transcriptPath = join(dir, 'transcript.txt')
    writeFileSync(transcriptPath, transcript, 'utf-8')

    setStage('summarizing', 0, 'AI 正在生成总结…')
    const summary = await summarizeTranscript(transcript, getProject().title, (pct) => {
      setStage('summarizing', pct, 'AI 正在生成总结…')
    })
    checkCancelled()

    const summaryPath = join(dir, 'summary.json')
    const doc = { ...summary, projectId, createdAt: new Date().toISOString() }
    writeFileSync(summaryPath, JSON.stringify(doc, null, 2), 'utf-8')

    store.updateProject(projectId, {
      stage: 'done',
      progress: 100,
      transcriptPath,
      summaryPath,
      error: undefined
    })
    emit({ projectId, stage: 'done', progress: 100, message: '完成' })
  } catch (err) {
    const message = toErrorMessage(err)
    store.updateProject(projectId, { stage: 'failed', error: message })
    emit({ projectId, stage: 'failed', progress: 0, message })
  } finally {
    running.delete(projectId)
  }
}
