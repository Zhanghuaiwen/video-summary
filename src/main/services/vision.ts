import { readFileSync } from 'fs'
import { join } from 'path'
import { chatJson, type ChatMessage, type MessageContent } from './llm'
import type { KeyFrameInfo } from '@shared/types'
import { fmtTime } from './timeline'

const BATCH_SIZE = 4
// 视觉模型单次/全任务的安全上限（用户配置的 maxKeyFrames 不得突破此值）
const MAX_FRAMES = 240
// 进入总结/思维导图提示词的帧清单上限
const BRIEF_FRAMES = 40

export interface VisionAnalysis {
  frames: KeyFrameInfo[]
  failedCount: number
  usedModel: string
}

interface RawResult {
  idx?: unknown
  ocr?: unknown
  visual?: unknown
  relation?: unknown
}

export interface FrameTarget {
  time: number
  path: string
}

function toDataUrl(workDir: string, relPath: string): string {
  const full = join(workDir, relPath)
  const base64 = readFileSync(full).toString('base64')
  return `data:image/jpeg;base64,${base64}`
}

function normalizeText(t: string): string {
  return t.replace(/\s+/g, ' ').trim().toLowerCase()
}

function isSimilarTo(kept: string[], candidate: string): boolean {
  const c = normalizeText(candidate)
  if (!c) return true
  for (const k of kept) {
    const nk = normalizeText(k)
    if (!nk) continue
    if (nk === c) return true
    const da = new Set(nk.split(/[，。；！？、,.;!?:\s，,]/).filter(Boolean))
    const db = new Set(c.split(/[，。；！？、,.;!?:\s，,]/).filter(Boolean))
    if (da.size === 0 || db.size === 0) continue
    let inter = 0
    for (const w of da) if (db.has(w)) inter++
    if (inter / Math.min(da.size, db.size) > 0.8) return true
  }
  return false
}

function parseResults(raw: unknown): RawResult[] {
  const obj = raw as { results?: unknown }
  if (!Array.isArray(obj.results)) {
    // 兼容单帧返回 {"ocr":..,"visual":..,"relation":..}
    if (obj && typeof obj === 'object') return [obj as RawResult]
    throw new Error('视觉模型返回缺少 results 字段')
  }
  return obj.results as RawResult[]
}

async function analyzeBatch(
  workDir: string,
  batch: FrameTarget[],
  opts: {
    model: string
    customPrompt?: string
    signal?: AbortSignal
    transcriptByTime: (time: number) => string
  }
): Promise<KeyFrameInfo[]> {
  const intro =
    '你是一个视频画面分析引擎。下面给你一组从视频中截取的关键帧（按顺序编号 idx=0,1,2...，输入顺序即编号顺序），' +
    '每个编号还会附带该时刻附近的语音内容（音频上下文）。请对每一帧输出：\n' +
    '- ocr：画面中出现的重要文字（PPT/公式/代码/表格/屏幕文字等），按行用纯文本给出；没有文字则为空字符串\n' +
    '- visual：一句话描述画面内容\n' +
    "- relation：画面与语音内容的关联（语音在讲什么、画面补充/印证了什么），没有语音则为空字符串\n\n" +
    '只输出 JSON，格式：{"results":[{"idx":0,"ocr":"...","visual":"...","relation":"..."}]}'

  const content: MessageContent = [{ type: 'text', text: intro }]
  let listing = '关键帧列表：\n'
  batch.forEach((f, i) => {
    const ctx = opts.transcriptByTime(f.time)
    listing += `- idx ${i}，时间约 ${Math.round(f.time)}s，音频上下文：${ctx.slice(0, 160)}\n`
  })
  content.push({ type: 'text', text: listing })
  batch.forEach((f) => {
    content.push({ type: 'image_url', image_url: { url: toDataUrl(workDir, f.path) } })
  })

  const messages: ChatMessage[] = [{ role: 'user', content }]
  const raw = await chatJson(messages, {
    model: opts.model,
    customPrompt: opts.customPrompt,
    signal: opts.signal,
    timeoutMs: 240_000,
    maxTokens: 4096
  })

  const results = parseResults(raw)
  const out: KeyFrameInfo[] = []
  for (const r of results) {
    const idx = typeof r.idx === 'number' ? r.idx : typeof r.idx === 'string' ? Number(r.idx) : out.length
    const target = batch[Number.isFinite(idx) ? idx : 0]
    if (!target) continue
    out.push({
      time: target.time,
      path: target.path,
      ocr: typeof r.ocr === 'string' ? r.ocr : '',
      visual: typeof r.visual === 'string' ? r.visual : '',
      relation: typeof r.relation === 'string' ? r.relation : ''
    })
  }
  return out
}

/**
 * 视觉分析主入口：分批交给视觉 LLM，OCR 结果按相似度去重，单个批次失败不影响其余。
 */
export async function analyzeFrames(
  workDir: string,
  frames: FrameTarget[],
  opts: {
    model: string
    customPrompt?: string
    signal?: AbortSignal
    transcriptByTime?: (time: number) => string
    maxKeyFrames?: number
    onProgress?: (done: number, total: number) => void
  }
): Promise<VisionAnalysis> {
  const transcriptByTime =
    opts.transcriptByTime ?? (() => {
      return ''
    })
  const max = Math.max(4, Math.min(MAX_FRAMES, opts.maxKeyFrames ?? 30))
  const targets = frames.slice(0, max)
  const results: KeyFrameInfo[] = []
  let failedCount = 0

  for (let i = 0; i < targets.length; i += BATCH_SIZE) {
    const batch = targets.slice(i, i + BATCH_SIZE)
    try {
      const r = await analyzeBatch(workDir, batch, {
        model: opts.model,
        customPrompt: opts.customPrompt,
        signal: opts.signal,
        transcriptByTime
      })
      results.push(...r)
    } catch (err) {
      // 单批失败降级，不阻塞其它阶段
      failedCount += batch.length
      console.warn('[vision] 批次失败', err instanceof Error ? err.message : err)
    }
    opts.onProgress?.(Math.min(i + BATCH_SIZE, targets.length), targets.length)
  }

  // OCR 去重：保留视觉内容唯一（或 OCR 明显不同）的帧
  const keptOcr: string[] = []
  const deduped: KeyFrameInfo[] = []
  for (const r of results) {
    const ocrKey = r.ocr ?? ''
    if (isSimilarTo(keptOcr, ocrKey)) continue
    keptOcr.push(ocrKey)
    deduped.push(r)
  }

  return { frames: deduped, failedCount, usedModel: opts.model }
}

/**
 * 把视觉分析结果压缩成文本简报，供总结/思维导图提示词引用：
 * 优先收含有 OCR 文字的帧（对总结最有用），超出 BRIEF_FRAMES 则截断。
 */
export function buildVisionBrief(frames: KeyFrameInfo[]): string {
  if (!frames.length) return ''
  const withOcr = frames.filter((f) => (f.ocr ?? '').trim().length > 0)
  const picked = (withOcr.length > 0 ? withOcr : frames).slice(0, BRIEF_FRAMES)
  const lines = picked.map((f) => {
    const ocr = (f.ocr ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
    const visual = (f.visual ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
    return `- path=${f.path} time=${fmtTime(f.time)}${ocr ? ` ocr="${ocr}"` : ''}${visual ? ` visual="${visual}"` : ''}`
  })
  return `视频关键帧画面信息（含画面文字 OCR 与描述，对总结最有价值的参考）：
${lines.join('\n')}`
}