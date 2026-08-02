import { getConfig } from './config'
import type { Chapter } from '@shared/types'

export interface SummaryResult {
  title: string
  overview: string
  chapters: Chapter[]
}

const CHUNK_CHARS = 5000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function chat(messages: { role: 'system' | 'user'; content: string }[], maxTokens = 4096): Promise<string> {
  const { apiKey, llmModel, llmBaseUrl } = getConfig()
  if (!apiKey) throw new Error('尚未配置 API Key，请先在「设置」中填写')

  const doFetch = async (jsonMode: boolean): Promise<string> => {
    const body: Record<string, unknown> = {
      model: llmModel,
      messages: [{ role: 'system', content: '请用中文回答。' }, ...messages],
      temperature: 0.3,
      max_tokens: maxTokens
    }
    if (jsonMode) body.response_format = { type: 'json_object' }

    const res = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body)
    })
    const text = await res.text()
    if (!res.ok) throw new ApiError(res.status, `LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)

    let content = ''
    try {
      const data = JSON.parse(text) as { choices?: { message?: { content?: string } }[] }
      content = data.choices?.[0]?.message?.content ?? ''
    } catch {
      throw new Error(`LLM 响应无法解析: ${text.slice(0, 200)}`)
    }
    if (!content.trim()) throw new Error('LLM 返回为空')
    return content
  }

  const withRetry = async (): Promise<string> => {
    let jsonMode = true
    const delays = [0, 2000, 5000]
    let lastErr: unknown

    for (const delay of delays) {
      if (delay) await sleep(delay)
      try {
        return await doFetch(jsonMode)
      } catch (err) {
        lastErr = err
        if (err instanceof ApiError && (err.status === 429 || err.status === 503)) continue
        if (err instanceof ApiError && jsonMode && err.status >= 400 && err.status < 500) {
          jsonMode = false
          continue
        }
        throw err
      }
    }
    throw lastErr
  }

  return withRetry()
}

function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('无法解析 LLM 返回的 JSON')
  return JSON.parse(candidate.slice(start, end + 1))
}

async function chatJson(messages: { role: 'system' | 'user'; content: string }[], maxTokens = 4096): Promise<unknown> {
  const content = await chat(messages, maxTokens)
  try {
    return extractJson(content)
  } catch {
    const repaired = await chat(
      [
        ...messages,
        { role: 'user' as const, content: '上面你的输出不是合法 JSON。请重新输出，只输出符合要求的 JSON，不要包含任何其他文字或代码块标记。' }
      ],
      maxTokens
    )
    return extractJson(repaired)
  }
}

function toChapters(data: unknown): Chapter[] {
  const obj = data as { chapters?: unknown }
  if (!Array.isArray(obj.chapters)) throw new Error('LLM 返回缺少 chapters 字段')
  return (obj.chapters as { title?: unknown; summary?: unknown; points?: unknown }[])
    .filter((c) => c && typeof c.title === 'string')
    .map((c) => ({
      title: c.title as string,
      summary: typeof c.summary === 'string' ? c.summary : '',
      points: Array.isArray(c.points)
        ? (c.points.filter((p): p is string => typeof p === 'string') as string[])
        : []
    }))
}

function splitChunks(text: string): string[] {
  const paragraphs = text.split(/\n+/).map((p) => p.trim()).filter(Boolean)
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

function compactChapters(chapters: Chapter[]): Chapter[] {
  return chapters.map((c) => ({
    title: c.title,
    summary: c.summary.length > 120 ? `${c.summary.slice(0, 120)}…` : c.summary,
    points: c.points.slice(0, 5).map((p) => (p.length > 80 ? `${p.slice(0, 80)}…` : p))
  }))
}

const CHUNK_PROMPT = (title: string, chunk: string): string => `你是一位专业的视频内容分析师。以下是视频《${title}》的一段文字稿片段：

---
${chunk}
---

请将这段内容按主题划分成若干章节。每个章节包含：
- title：简洁的章节标题
- summary：2~3 句概述
- points：3~6 个关键要点（短语或短句）

只输出 JSON，格式：{"chapters":[{"title":"...","summary":"...","points":["...","..."]}]}`

const FINAL_PROMPT = (title: string, chapters: Chapter[]): string => `你是一位专业的视频内容分析师。以下是视频《${title}》各章节的摘要：

${JSON.stringify(chapters, null, 2)}

请综合所有章节，生成：
- overview：2~4 句话概括整段视频的核心内容与价值
- chapters：按视频叙述顺序整理后的最终章节列表（合并重复主题、保持条理，章节标题、概述、要点可以基于已有摘要改写）

只输出 JSON，格式：{"overview":"...","chapters":[{"title":"...","summary":"...","points":["...","..."]}]}`

const SINGLE_PROMPT = (title: string, transcript: string): string => `你是一位专业的视频内容分析师。以下是视频《${title}》的完整文字稿：

---
${transcript}
---

请生成：
1. overview：2~4 句话概括整段视频的核心内容与价值
2. chapters：按主题划分的章节列表，每章包含 title（标题）、summary（2~3 句概述）、points（3~6 个关键要点）

只输出 JSON，格式：{"overview":"...","chapters":[{"title":"...","summary":"...","points":["...","..."]}]}`

export async function summarizeTranscript(
  transcript: string,
  title: string,
  onProgress: (pct: number) => void
): Promise<SummaryResult> {
  const chunks = splitChunks(transcript)
  const trimmed = title.trim() || '未命名视频'

  if (chunks.length <= 1) {
    const data = (await chatJson([{ role: 'user', content: SINGLE_PROMPT(trimmed, transcript.slice(0, CHUNK_CHARS * 2)) }], 8192)) as {
      overview?: unknown
      chapters?: unknown
    }
    onProgress(100)
    return {
      title: trimmed,
      overview: typeof data.overview === 'string' ? data.overview : '',
      chapters: toChapters({ chapters: data.chapters })
    }
  }

  const chapterLists: Chapter[][] = []
  for (let i = 0; i < chunks.length; i++) {
    const data = (await chatJson([{ role: 'user', content: CHUNK_PROMPT(trimmed, chunks[i]) }], 4096)) as {
      chapters?: unknown
    }
    chapterLists.push(toChapters(data))
    onProgress(Math.round(((i + 1) / chunks.length) * 90))
  }

  const data = (await chatJson([{ role: 'user', content: FINAL_PROMPT(trimmed, compactChapters(chapterLists.flat())) }], 8192)) as {
    overview?: unknown
    chapters?: unknown
  }
  onProgress(100)
  return {
    title: trimmed,
    overview: typeof data.overview === 'string' ? data.overview : '',
    chapters: toChapters({ chapters: data.chapters })
  }
}
