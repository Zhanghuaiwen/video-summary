import { app } from 'electron'
import { join, extname } from 'path'
import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
import type { KeyFrameInfo, MindMapDoc, PipelineStage, ProgressPayload, Project, ProjectCheckpoint, SummaryDoc, TimelineSegment, VisionDoc } from '@shared/types'
import { DEFAULT_ANALYSIS_CONFIG } from '@shared/types'
import { toErrorMessage } from '@shared/errors'
import type { Store } from '../store'
import { getConfig } from './config'
import { fetchVideoTitle, downloadMedia, probeMediaDuration } from './video'
import { prepareAudioSegments, detectSilences, SEGMENT_SECONDS } from './audio'
import { transcribeBatch, type TranscriptBlock } from './transcriber'
import { summarizeTranscript } from './summarizer'
import { clearFramesDir, extractKeyFrames } from './frames'
import { analyzeFrames, buildVisionBrief } from './vision'
import { blocksToText, buildTimeline, buildTimedTranscript } from './timeline'
import { generateMindMap, createMindMapDoc, clampMindMapTimes } from './mindmap'
import { buildCacheKey, loadCacheDocs, saveCacheDocs, saveFramesDir, restoreFramesDir, sha1File } from './cache'
import { normalizeChapterPoints } from '@shared/summary-util'

export type ProgressEmitter = (p: ProgressPayload) => void

interface RunningCtx {
  cancelled: boolean
  controller: AbortController
}

const running = new Map<string, RunningCtx>()

export function cancelPipeline(projectId: string): void {
  const ctx = running.get(projectId)
  if (ctx) {
    ctx.cancelled = true
    ctx.controller.abort()
  }
}

function workDir(projectId: string): string {
  return join(app.getPath('userData'), 'projects', projectId)
}

/** 读取转写断点数据（分段时间 + 文本），用于跳过转写直接续跑视觉/总结 */
function parseBlocks(json: string | undefined): TranscriptBlock[] | undefined {
  if (!json) return undefined
  try {
    const d = JSON.parse(json) as { blocks?: TranscriptBlock[] }
    return Array.isArray(d.blocks) ? d.blocks : undefined
  } catch {
    return undefined
  }
}

export function buildSummaryDigest(summary: Pick<SummaryDoc, 'overview' | 'takeaways' | 'chapters'>): string {
  const chapters = summary.chapters.map((c) => ({
    title: c.title,
    summary: c.summary.slice(0, 300),
    points: normalizeChapterPoints(c.points).slice(0, 8).map((p) => ({
      text: p.text.slice(0, 100),
      subPoints: p.subPoints?.slice(0, 3).map((s) => s.slice(0, 60))
    }))
  }))
  return JSON.stringify({ overview: summary.overview, takeaways: summary.takeaways ?? [], chapters }, null, 2)
}

/** 裁剪带时间的文字稿，控制思维导图生成时的 token 用量 */
export function capTimedTranscript(segments: TimelineSegment[]): string {
  return buildTimedTranscript(segments)
}

export async function startPipeline(projectId: string, store: Store, emit: ProgressEmitter): Promise<void> {
  const ctx: RunningCtx = { cancelled: false, controller: new AbortController() }
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
    if (ctx.cancelled) {
      const err = new Error('任务已取消')
      err.name = 'AbortError'
      throw err
    }
  }

  try {
    const project = getProject()
    const analysis = { ...DEFAULT_ANALYSIS_CONFIG, ...(project.analysisConfig ?? {}) }
    const { asrModel, llmModel, visionModel } = getConfig()
    const customPrompt = analysis.customPrompt?.trim() || undefined

    // ---- 断点续跑：各阶段产物与其所用模型已记录时跳过该阶段；产物缺失或模型变更则重做该阶段及后续 ----
    let cp: ProjectCheckpoint = project.checkpoint ?? {}
    const saveCheckpoint = (): void => {
      store.updateProject(projectId, { checkpoint: cp })
    }
    const reuseTranscribe =
      !!cp.transcribeDone &&
      cp.asrModel === asrModel &&
      !!store.getBlocks(projectId) &&
      !!store.getTranscript(projectId)
    const reuseVision =
      !!cp.visionDone && cp.visionModel === visionModel && reuseTranscribe && !!store.getVision(projectId)
    const reuseSummary =
      !!cp.summaryDone && cp.llmModel === llmModel && !!store.getSummary(projectId)
    const reuseMindmap =
      !!cp.mindmapDone && cp.llmModel === llmModel && reuseSummary && reuseVision && !!store.getMindMap(projectId)

    // ---- 1. 媒体（已下载/本地文件则跳过下载） ----
    // B 站下载产物本应合并成 mp4 视频；若 mediaPath 只是纯音频（合并失败遗留的 m4a），
    // 界面播放器会变成无画面的音频，且可能丢掉视频流。此类产物须重新下载合并。
    const AUDIO_ONLY_EXTS = new Set(['m4a', 'mp3', 'aac', 'wav', 'flac', 'ogg'])
    const existingMedia = project.mediaPath ?? ''
    const bilibiliPureAudio =
      project.source === 'bilibili' &&
      !!project.sourceUrl &&
      !!existingMedia &&
      existsSync(existingMedia) &&
      AUDIO_ONLY_EXTS.has(extname(existingMedia).slice(1).toLowerCase())

    let mediaPath = project.mediaPath ?? ''
    if (mediaPath && existsSync(mediaPath) && !bilibiliPureAudio) {
      // 已有可用媒体文件，跳过下载
    } else {
      if (mediaPath && existsSync(mediaPath)) {
        // 清理旧 B 站纯音频产物的残留部分文件（media.f30080.mp4 / media.f30280.m4a 等），
        // 避免重下载时与旧文件冲突
        for (const f of readdirSync(dir)) {
          if (/^media\./.test(f)) {
            try {
              unlinkSync(join(dir, f))
            } catch {
              // 忽略清理失败
            }
          }
        }
        store.updateProject(projectId, { mediaPath: '' })
      }
      mediaPath = ''
      if (project.source === 'bilibili' && project.sourceUrl) {
        setStage('downloading', 1, '正在获取视频信息…')
        const title = await fetchVideoTitle(project.sourceUrl)
        store.updateProject(projectId, { title })
        setStage('downloading', 2, '正在下载音视频…')
        mediaPath = await downloadMedia(project.sourceUrl, dir, (pct) => {
          setStage('downloading', Math.max(2, pct), '正在下载音视频…')
        })
        store.updateProject(projectId, { mediaPath })
      } else if (project.localPath) {
        mediaPath = project.localPath
        store.updateProject(projectId, { mediaPath })
      } else {
        throw new Error('项目缺少视频来源')
      }
    }
    checkCancelled()

    // ---- 2. 内容指纹 + 分析缓存 ----
    setStage('extracting', 1, '正在计算内容指纹（用于分析缓存）…')
    let mediaHash = project.mediaHash ?? ''
    if (!mediaHash) {
      mediaHash = await sha1File(mediaPath)
      store.updateProject(projectId, { mediaHash })
    }
    // 真实媒体时长（秒）：用于钳制时间轴 endTime，避免短视频出现虚假的 10 分钟结尾
    const mediaDuration = await probeMediaDuration(mediaPath).catch(() => undefined)
    if (!mediaDuration) {
      console.warn('[pipeline] 未能探测媒体时长，时间轴末端将不做钳制（请检查 ffmpeg 是否可用）')
    }
    const cacheKey = buildCacheKey({ mediaHash, asrModel, llmModel, visionModel, analysis })

    // ---- 缓存命中：把缓存的文档写回项目行，帧图从 cache/<key>/frames 还原 ----
    const cached = loadCacheDocs(cacheKey)
    if (cached) {
      try {
        restoreFramesDir(cacheKey, dir)
        const now = new Date().toISOString()
        if (cached.transcript != null) store.saveTranscript(projectId, cached.transcript)
        if (cached.blocksJson != null) store.saveBlocks(projectId, cached.blocksJson)
        if (cached.summaryJson) {
          const s = JSON.parse(cached.summaryJson) as SummaryDoc
          s.projectId = projectId
          s.createdAt = now
          store.saveSummary(projectId, s)
        }
        if (cached.visionJson) {
          store.saveVision(projectId, JSON.parse(cached.visionJson) as VisionDoc)
        }
        if (cached.mindmapJson) {
          const m = JSON.parse(cached.mindmapJson) as MindMapDoc
          m.projectId = projectId
          m.createdAt = now
          m.updatedAt = now
          store.saveMindMap(projectId, m)
        }
        cp = { asrModel, llmModel, visionModel, transcribeDone: true, visionDone: true, summaryDone: true, mindmapDone: true }
        saveCheckpoint()
        store.updateProject(projectId, {
          stage: 'done',
          progress: 100,
          error: undefined
        })
        emit({ projectId, stage: 'done', progress: 100, message: '命中缓存，已完成' })
        return
      } catch (err) {
        // 缓存数据损坏则忽略，走全新管线
        console.warn('[pipeline] 缓存还原失败，重新分析', toErrorMessage(err))
      }
    }

    // ---- 3. 转写（含音频分段；转写已完成则从断点数据恢复） ----
    let blocks: TranscriptBlock[] | undefined
    let silenceTimes: number[] = []
    // 关键帧提取与转写并行：二者都只依赖媒体文件（提取耗时省在转写的网络等待里）
    const signal = ctx.controller.signal
    let framesPromise: Promise<KeyFrameInfo[] | null> = Promise.resolve(null)
    if (analysis.enableVision && !reuseVision) {
      framesPromise = clearFramesDir(dir)
        .then(() =>
          extractKeyFrames(mediaPath, dir, {
            interval: analysis.keyFrameInterval,
            sceneThreshold: analysis.sceneThreshold,
            maxKeyFrames: analysis.maxKeyFrames
          })
        )
        .catch((err) => {
          console.warn('[pipeline] 关键帧提取失败，跳过视觉阶段', toErrorMessage(err))
          return []
        })
    }
    if (!reuseVision) {
      if (reuseTranscribe) {
        blocks = parseBlocks(store.getBlocks(projectId))
        if (!blocks) throw new Error('转写断点数据缺失，请删除项目重新运行')
        // 断点恢复：复用上次检测到的真实停顿点，句子级时间轴无需重跑静音检测
        if (cp.silenceTimes && cp.silenceTimes.length > 0) silenceTimes = cp.silenceTimes
        setStage('transcribing', 100, '转写已完成（断点续跑）')
      } else {
        setStage('extracting', 5, '正在提取音频并分段…')
        const segments = await prepareAudioSegments(mediaPath, dir)
        checkCancelled()
        if (segments.length === 0) throw new Error('未能生成音频分段')
        // 在整段音频上检测真实停顿点，作为句子级时间戳的锚点（无需额外模型）
        setStage('extracting', 8, '正在检测语音停顿点…')
        silenceTimes = await detectSilences(join(dir, 'audio', 'audio.mp3')).catch(() => [])
        checkCancelled()
        setStage('transcribing', 0, '正在转写语音…')
        blocks = await transcribeBatch(segments, SEGMENT_SECONDS, (done, total) => {
          setStage('transcribing', Math.round((done / total) * 100), `正在转写 ${done}/${total} 段…`)
        })
        checkCancelled()
        const transcript = blocksToText(blocks)
        if (!transcript.trim()) throw new Error('转写结果为空：该视频没有可识别的语音内容')
        store.saveTranscript(projectId, transcript)
        store.saveBlocks(projectId, JSON.stringify({ asrModel, blocks }))
        cp = { ...cp, asrModel, transcribeDone: true, silenceTimes }
        saveCheckpoint()
      }
    }
    checkCancelled()

    // ---- 4. 视觉分析（OCR + 画面描述）；转写后执行（先于总结，总结需要引用画面/OCR 信息） ----
    const runVision = async (silenceTimes: number[] = []): Promise<VisionDoc> => {
      if (reuseVision) {
        const visionDoc = store.getVision(projectId)
        if (!visionDoc) throw new Error('视觉分析产物缺失')
        // 修复旧版时间轴：用真实媒体时长重算 segments，避免「短视频结束时间 = 10:00」的虚假结尾
        if (mediaDuration && mediaDuration > 0) {
          const fixedSegments = buildTimeline(blocks!, visionDoc.frames ?? [], SEGMENT_SECONDS, mediaDuration)
          if (fixedSegments.length > 0) {
            visionDoc.segments = fixedSegments
            store.saveVision(projectId, visionDoc)
          }
        }
        setStage('analyzing', 100, '视觉分析已完成（断点续跑）')
        return visionDoc
      }
      try {
        setStage('analyzing', 1, '正在提取关键帧…')
        const frames = await framesPromise
        const visionDoc = await runVisionStage(mediaPath, dir, blocks!, analysis, visionModel, customPrompt, signal, setStage, mediaDuration, frames, silenceTimes)
        store.saveVision(projectId, visionDoc)
        cp = { ...cp, visionModel, visionDone: true }
        saveCheckpoint()
        return visionDoc
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        console.warn('[pipeline] 视觉分析失败，已跳过', toErrorMessage(err))
        return { frames: [], segments: [], createdAt: new Date().toISOString() }
      }
    }

    // ---- 5. 文字总结（顺次执行：需要视觉分析产出的画面/OCR 简报） ----
    const runSummary = async (
      visionBrief?: string
    ): Promise<{ summary: SummaryDoc; saved: boolean; summaryError: string | undefined }> => {
      if (reuseSummary) {
        const summary = store.getSummary(projectId)
        if (!summary) throw new Error('总结产物缺失')
        setStage('summarizing', 100, '总结已生成（断点续跑）')
        return { summary, saved: true, summaryError: undefined }
      }
      setStage('summarizing', 0, 'AI 正在生成总结…')
      const transcriptText = store.getTranscript(projectId)
      if (transcriptText == null) throw new Error('缺少转写文字稿，无法生成总结')
      let summary: SummaryDoc = {
        projectId,
        title: getProject().title,
        overview: '',
        takeaways: [],
        chapters: [],
        createdAt: new Date().toISOString()
      }
      let saved = false
      let summaryError: string | undefined
      try {
        const result = await summarizeTranscript(
          transcriptText,
          getProject().title,
          (pct) => setStage('summarizing', pct, 'AI 正在生成总结…'),
          { customPrompt, signal, model: llmModel },
          visionBrief
        )
        checkCancelled()
        summary = { ...result, projectId, createdAt: new Date().toISOString() }
        store.saveSummary(projectId, summary)
        saved = true
        cp = { ...cp, llmModel, summaryDone: true }
        saveCheckpoint()
        setStage('summarizing', 100, '总结已生成')
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') throw err
        summaryError = toErrorMessage(err)
        console.warn('[pipeline] 总结生成失败，已跳过（保留转写与视觉分析）', summaryError)
        summary = {
          projectId,
          title: getProject().title,
          overview: '总结生成失败，无法生成摘要。',
          takeaways: [],
          chapters: [],
          createdAt: new Date().toISOString()
        }
        setStage('summarizing', 100, `总结生成失败：${summaryError}`)
      }
      return { summary, saved, summaryError }
    }

    const visionDoc = await runVision(silenceTimes)
    const visionBrief = visionDoc.frames.length > 0 ? buildVisionBrief(visionDoc.frames) : undefined
    checkCancelled()

    const summaryRes = await runSummary(visionBrief)
    const summary = summaryRes.summary
    const summaryError = summaryRes.summaryError
    checkCancelled()

    // ---- 6. 思维导图生成（失败不阻塞整体完成） ----
    if (store.getSummary(projectId) && visionDoc.segments.length > 0) {
      if (reuseMindmap) {
        setStage('mindmap', 100, '思维导图已生成（断点续跑）')
      } else {
        setStage('mindmap', 5, 'AI 正在生成思维导图…')
        // 思维导图是单次大 LLM 请求，没有中间进度回调；用耗时驱动的进度条让用户看到任务仍在进行
        const started = Date.now()
        const ticker = setInterval(() => {
          const elapsed = Math.round((Date.now() - started) / 1000)
          const pct = Math.min(90, 5 + Math.round((elapsed / 180) * 85))
          setStage('mindmap', pct, `正在生成思维导图… 已用时 ${elapsed} 秒（单次请求通常需 1~3 分钟）`)
        }, 1000)
        try {
          const digest = buildSummaryDigest(summary)
          const timed = capTimedTranscript(visionDoc.segments)
          const root = await generateMindMap(
            {
              title: summary.title,
              timedTranscript: timed,
              summaryDigest: digest,
              visionBrief,
              durationSec: mediaDuration
            },
            { customPrompt, signal, model: llmModel }
          )
          clampMindMapTimes(root, mediaDuration ?? 0)
          const mmDoc = createMindMapDoc(projectId, summary.title, root)
          store.saveMindMap(projectId, mmDoc)
          cp = { ...cp, llmModel, mindmapDone: true }
          saveCheckpoint()
          setStage('mindmap', 100, '思维导图已生成')
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') throw err
          console.warn('[pipeline] 思维导图生成失败，已跳过', toErrorMessage(err))
          setStage('mindmap', 100, '思维导图生成失败（可在思维导图页重试）')
        } finally {
          clearInterval(ticker)
        }
      }
    }
    checkCancelled()

    // ---- 7. 写缓存 + 完成 ----
    try {
      saveCacheDocs(cacheKey, {
        transcript: store.getTranscript(projectId),
        blocksJson: store.getBlocks(projectId),
        summaryJson: store.getSummary(projectId) ? JSON.stringify(store.getSummary(projectId)) : undefined,
        visionJson: store.getVision(projectId) ? JSON.stringify(store.getVision(projectId)) : undefined,
        mindmapJson: store.getMindMap(projectId) ? JSON.stringify(store.getMindMap(projectId)) : undefined
      })
      saveFramesDir(dir, cacheKey)
    } catch (err) {
      console.warn('[pipeline] 缓存写入失败', toErrorMessage(err))
    }

    store.updateProject(projectId, {
      stage: summaryRes.saved ? 'done' : 'failed',
      progress: 100,
      error: summaryRes.saved ? undefined : (summaryError ?? '总结生成失败：请在「设置」检查模型/网络后，点击「继续」从断点续跑')
    })
    emit({
      projectId,
      stage: summaryRes.saved ? 'done' : 'failed',
      progress: 100,
      message: summaryRes.saved ? '完成' : `总结失败：${summaryError ?? '请在「设置」检查模型/网络后，点击「继续」从断点续跑'}`
    })
  } catch (err) {
    const cancelled = ctx.cancelled || (err instanceof Error && err.name === 'AbortError')
    const message = cancelled ? '任务已取消（已保存进度，可点击「继续」续跑）' : toErrorMessage(err)
    store.updateProject(projectId, { stage: 'failed', error: message })
    emit({ projectId, stage: 'failed', progress: 0, message })
  } finally {
    running.delete(projectId)
  }
}

async function runVisionStage(
  mediaPath: string,
  dir: string,
  blocks: TranscriptBlock[],
  analysis: { enableVision: boolean; keyFrameInterval: number; sceneThreshold: number; maxKeyFrames: number },
  visionModel: string,
  customPrompt: string | undefined,
  signal: AbortSignal,
  setStage: (stage: PipelineStage, progress: number, message?: string) => void,
  mediaDuration?: number,
  preFrames?: KeyFrameInfo[] | null,
  silenceTimes: number[] = []
): Promise<VisionDoc> {
  let frames: KeyFrameInfo[] = []

  if (analysis.enableVision) {
    // preFrames 由转写阶段并行提取（避免重复解码）；为空则此处再提取
    const extracted =
      preFrames ??
      (await clearFramesDir(dir)
        .then(() =>
          extractKeyFrames(mediaPath, dir, {
            interval: analysis.keyFrameInterval,
            sceneThreshold: analysis.sceneThreshold,
            maxKeyFrames: analysis.maxKeyFrames
          })
        )
        .catch((err) => {
          console.warn('[pipeline] 关键帧提取失败，跳过视觉阶段', toErrorMessage(err))
          return []
        }))
    setStage('analyzing', 10, `已提取 ${extracted.length} 个关键帧，正在视觉分析…`)

    if (extracted.length > 0) {
      const segments = buildTimeline(blocks, [], SEGMENT_SECONDS, mediaDuration, silenceTimes)
      const transcriptByTime = (t: number): string => {
        const seg = segments.find((s) => t >= s.startTime && t < s.endTime)
        return seg?.transcript ?? ''
      }
      const res = await analyzeFrames(dir, extracted, {
        model: visionModel,
        customPrompt,
        signal,
        transcriptByTime,
        maxKeyFrames: analysis.maxKeyFrames,
        onProgress: (done, total) =>
          setStage('analyzing', 10 + Math.round((done / total) * 85), `正在视觉分析 ${done}/${total}…`)
      }).catch((err) => {
        if (err instanceof Error && err.name === 'AbortError') throw err
        console.warn('[pipeline] 视觉分析失败，跳过', toErrorMessage(err))
        return { frames: [], failedCount: extracted.length, usedModel: visionModel }
      })
      frames = res.frames
    }
  }

  const timeline = buildTimeline(blocks, frames, SEGMENT_SECONDS, mediaDuration, silenceTimes)
  return { frames, segments: timeline, createdAt: new Date().toISOString() }
}