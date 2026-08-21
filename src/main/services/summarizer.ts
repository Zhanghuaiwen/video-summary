import type { Chapter, ChapterPoint, FrameRef } from '@shared/types'
import { chatJson } from './llm'
import type { ChatOptions } from './llm'
import { parallelMap } from './concurrency'
import { toErrorMessage } from '@shared/errors'
import { normalizeChapterPoints } from '@shared/summary-util'

export interface SummaryResult {
  title: string
  overview: string
  takeaways: string[]
  chapters: Chapter[]
}

const CHUNK_CHARS = 4000

// 输出 token 上限：够用但不过分。中文章节 JSON 通常与输入规模相当，2048 容易被截断，
// 抬高到 3072 避免长块输出被截断成非法 JSON（被当成分块失败丢弃）。
const CHUNK_MAX_TOKENS = 3072
// 聚合输出包含全部章节（含要点、子要点、画面引用），长视频下可能上千 token；8192 保证不因截断产出非法 JSON。
const FINAL_MAX_TOKENS = 8192

function toChapters(data: unknown): Chapter[] {
  const obj = data as { chapters?: unknown }
  if (!Array.isArray(obj.chapters)) throw new Error('LLM 返回缺少 chapters 字段')
  return (
    obj.chapters as { title?: unknown; summary?: unknown; points?: unknown; frames?: unknown }[]
  )
    .filter((c) => c && typeof c.title === 'string')
    .map((c) => {
      const rawFrames = Array.isArray(c.frames) ? c.frames : []
      const frames: FrameRef[] = []
      for (const f of rawFrames) {
        const o = f as Record<string, unknown>
        const time = typeof o['time'] === 'number' ? o['time'] : typeof o['time'] === 'string' ? Number(o['time']) : NaN
        const path = typeof o['path'] === 'string' ? o['path'] : ''
        if (!Number.isFinite(time) || !path) continue
        frames.push({
          time,
          path,
          ocr: typeof o['ocr'] === 'string' ? o['ocr'] : undefined,
          visual: typeof o['visual'] === 'string' ? o['visual'] : undefined
        })
      }
      return {
        title: c.title as string,
        summary: typeof c.summary === 'string' ? c.summary : '',
        points: normalizeChapterPoints(c.points),
        frames: frames.length ? frames.slice(0, 4) : undefined
      }
    })
}

/** 尽力解析章节，失败时返回空数组而不是抛出（保证任务不因单块/聚合 JSON 异常而失败） */
function safeChapters(data: unknown): Chapter[] {
  try {
    return toChapters(data)
  } catch {
    return []
  }
}

function safeTakeaways(data: unknown): string[] {
  const obj = data as { takeaways?: unknown }
  if (!Array.isArray(obj.takeaways)) return []
  return obj.takeaways.filter((t): t is string => typeof t === 'string' && t.trim().length > 0).map((t) => t.trim()).slice(0, 8)
}

function makeOverview(chapters: Chapter[]): string {
  if (!chapters.length) return '该视频未能生成概述。'
  return `该视频共涵盖 ${chapters.length} 个主题：${chapters.map((c) => c.title).join('、')}。`
}

function splitChunks(text: string): string[] {
  const paragraphs = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
  const chunks: string[] = []
  let current = ''
  for (const p of paragraphs) {
    if (current.length + p.length > CHUNK_CHARS && current) {
      chunks.push(current)
      current = p
    } else {
      current = current ? `${current}\n${p}` : p
    }
  }
  if (current) chunks.push(current)
  return chunks
}

function truncatePoints(points: ChapterPoint[]): ChapterPoint[] {
  return points.slice(0, 8).map((p) => ({
    text: p.text.length > 90 ? `${p.text.slice(0, 90)}…` : p.text,
    subPoints: p.subPoints
      ?.slice(0, 3)
      .map((s) => (s.length > 60 ? `${s.slice(0, 60)}…` : s))
  }))
}

function compactChapters(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => ({
    title: c.title,
    summary: c.summary.length > 140 ? `${c.summary.slice(0, 140)}…` : c.summary,
    points: truncatePoints(c.points)
  }))
}

const CHUNK_PROMPT = (title: string, chunk: string): string =>
  `你是一位专业的视频内容分析师。以下是视频《${title}》的一段文字稿片段：

---
${chunk}
---

请将这段内容按主题划分成若干章节。请用中文回答。每个章节包含：
- title：简洁的章节标题
- summary：2~3 句概述，尽量具体（提及关键数据、做法、结论）
- points：4~7 个关键要点，每个要点尽量具体（含数字、专有名词、步骤）；对重要要点可在 subPoints 里给出 1~3 条展开细节/论据

只输出 JSON，格式：{"chapters":[{"title":"...","summary":"...","points":[{"text":"...","subPoints":["...","..."]}]}]}`

const FINAL_PROMPT = (title: string, chapters: Chapter[], visionBrief: string): string =>
  `你是一位专业的视频内容分析师。以下是视频《${title}》各章节的摘要：

${JSON.stringify(chapters, null, 2)}
${visionBrief ? `\n另外附上视频关键帧画面信息（含画面文字 OCR 与描述）：\n${visionBrief}` : ''}

请综合所有章节与画面信息，用中文回答，生成一份内容更丰富、更具体的总结：
- overview：2~4 句话概括整段视频的核心内容与价值
- takeaways：3~6 条全片最值得记住的核心要点/结论（短句）
- chapters：按视频叙述顺序整理后的最终章节列表（合并重复主题、保持条理）。每章保持：
  - title：简洁标题
  - summary：2~4 句，写得具体一点（允许保留数字、专有名词、关键步骤）
  - points：5~8 个要点，按重要性排序；要点尽量具体，重要要点带 subPoints（1~3 条展开细节/论据）
  - frames：可选。若某章节的核心内容与某关键帧的画面/OCR 文字直接对应（如 PPT 标题、公式、表格、截图），附加 frames 数组，元素形如 {"time":<秒>,"path":"<从上面清单抄的 path>","ocr":"...","visual":"..."}，最多 3 个；只附加确实相关的帧，不相关就省略该字段

只输出 JSON，格式：
{"overview":"...","takeaways":["...","..."],"chapters":[{"title":"...","summary":"...","points":[{"text":"...","subPoints":["...","..."]}],"frames":[{"time":12,"path":"frames/xxx.jpg","ocr":"...","visual":"..."}]}]}`

const SINGLE_PROMPT = (title: string, transcript: string, visionBrief: string): string =>
  `你是一位专业的视频内容分析师。以下是视频《${title}》的完整文字稿：

---
${transcript}
---
${visionBrief ? `\n另外附上视频关键帧画面信息（含画面文字 OCR 与描述）：\n${visionBrief}` : ''}

请用中文回答，生成一份内容更丰富、更具体的总结：
1. overview：2~4 句话概括整段视频的核心内容与价值
2. takeaways：3~6 条全片最值得记住的核心要点/结论（短句）
3. chapters：按主题划分的章节列表，每章包含：
   - title（标题）
   - summary（2~4 句概述，尽量具体）
   - points（5~8 个关键要点，按重要性排序；重要要点带 subPoints 展开细节）
   - frames（可选，若某章节与某关键帧画面/OCR 直接对应则附加，最多 3 个；path 从上面画面信息中抄）

只输出 JSON，格式：
{"overview":"...","takeaways":["...","..."],"chapters":[{"title":"...","summary":"...","points":[{"text":"...","subPoints":["...","..."]}],"frames":[{"time":12,"path":"frames/xxx.jpg","ocr":"...","visual":"..."}]}]}`

export async function summarizeTranscript(
  transcript: string,
  title: string,
  onProgress: (pct: number) => void,
  opts: ChatOptions = {},
  visionBrief?: string
): Promise<SummaryResult> {
  const trimmed = title.trim() || '未命名视频'
  const chunks = splitChunks(transcript)

  if (chunks.length <= 1) {
    let data: { overview?: unknown; takeaways?: unknown; chapters?: unknown } = {}
    try {
      data = (await chatJson(
        [{ role: 'user', content: SINGLE_PROMPT(trimmed, transcript, visionBrief ?? '') }],
        { ...opts, maxTokens: FINAL_MAX_TOKENS }
      )) as { overview?: unknown; takeaways?: unknown; chapters?: unknown }
    } catch (err) {
      // 单段总结失败不致命：降级为一个可用的空章节结果，保证任务完成
      console.warn('[summarizer] 单段总结失败，使用降级结果', toErrorMessage(err))
    }
    onProgress(100)
    const chapters = safeChapters(data)
    return {
      title: trimmed,
      overview:
        typeof data.overview === 'string' && data.overview ? data.overview : makeOverview(chapters),
      takeaways: safeTakeaways(data),
      chapters
    }
  }

  const chapterLists = await parallelMap(chunks, 2, async (chunk) => {
    let data: { chapters?: unknown } = {}
    try {
      data = (await chatJson([{ role: 'user', content: CHUNK_PROMPT(trimmed, chunk) }], {
        ...opts,
        maxTokens: CHUNK_MAX_TOKENS
      })) as {
        chapters?: unknown
      }
    } catch (err) {
      // 单块失败不阻塞整体：丢弃该块，避免一次卡顿报废整个总结
      console.warn('[summarizer] 片段处理失败，已跳过', toErrorMessage(err))
    }
    return safeChapters(data)
  })
  for (let i = 0; i < chapterLists.length; i++) {
    onProgress(Math.round(((i + 1) / chapterLists.length) * 90))
  }

  let collected = chapterLists.flat()
  // 所有分块都失败时，最后再尝试用完整文字稿跑一遍单段总结，避免整个任务空手而归
  if (!collected.length && chunks.length > 1) {
    try {
      const single = (await chatJson(
        [{ role: 'user', content: SINGLE_PROMPT(trimmed, transcript, visionBrief ?? '') }],
        { ...opts, maxTokens: FINAL_MAX_TOKENS }
      )) as { overview?: unknown; takeaways?: unknown; chapters?: unknown }
      collected = safeChapters(single)
      return {
        title: trimmed,
        overview:
          typeof single.overview === 'string' && single.overview ? single.overview : makeOverview(collected),
        takeaways: safeTakeaways(single),
        chapters: collected
      }
    } catch (err) {
      console.warn('[summarizer] 全量兜底总结失败', toErrorMessage(err))
    }
  }

  let data: { overview?: unknown; takeaways?: unknown; chapters?: unknown } = {}
  try {
    data = (await chatJson(
      [
        {
          role: 'user',
          content: FINAL_PROMPT(trimmed, compactChapters(collected), visionBrief ?? '')
        }
      ],
      { ...opts, maxTokens: FINAL_MAX_TOKENS }
    )) as { overview?: unknown; takeaways?: unknown; chapters?: unknown }
  } catch (err) {
    // 聚合失败（超时/截断/非法 JSON）不致命：用已收集的章节降级出一个可用总结，保证任务完成
    console.warn('[summarizer] 最终聚合失败，使用分块章节降级', toErrorMessage(err))
  }
  onProgress(100)
  // 聚合 JSON 里拿不到可用章节时回退到分块章节；overview 缺失时同样回退
  const finalChapters = safeChapters(data)
  const chapters = finalChapters.length ? finalChapters : collected
  return {
    title: trimmed,
    overview:
      typeof data.overview === 'string' && data.overview ? data.overview : makeOverview(chapters),
    takeaways: safeTakeaways(data),
    chapters
  }
}