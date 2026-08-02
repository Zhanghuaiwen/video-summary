import { readFileSync } from 'fs'
import { getConfig } from './config'

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface Transcript {
  text: string
  segments: TranscriptSegment[]
}

export async function transcribeFile(audioPath: string): Promise<Transcript> {
  const { apiKey, asrModel, llmBaseUrl } = getConfig()
  if (!apiKey) throw new Error('尚未配置 API Key，请先在「设置」中填写')

  const form = new FormData()
  form.append('file', new Blob([readFileSync(audioPath)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', asrModel)

  const res = await fetch(`${llmBaseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })

  if (!res.ok) {
    throw new Error(`转写失败 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  }

  const data = (await res.json()) as { text?: string; segments?: TranscriptSegment[] }
  const text = (data.text ?? '').trim()
  if (!text) throw new Error('转写结果为空')
  return { text, segments: data.segments ?? [] }
}

export async function transcribeBatch(
  files: string[],
  onProgress: (done: number, total: number) => void
): Promise<string> {
  const parts: string[] = []
  for (let i = 0; i < files.length; i++) {
    const t = await transcribeFile(files[i])
    parts.push(t.text)
    onProgress(i + 1, files.length)
  }
  return parts.filter(Boolean).join('\n')
}
