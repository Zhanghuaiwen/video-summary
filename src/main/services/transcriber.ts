import { readFileSync } from 'fs'
import { getConfig } from './config'
import type { TranscriptBlock } from './timeline'
import { parallelMap } from './concurrency'

export type { TranscriptBlock }

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

function isTimeoutErr(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === 'TimeoutError' || /timed? ?out|aborted due to timeout/i.test(err.message))
  )
}

export async function transcribeFile(audioPath: string): Promise<string> {
  const { apiKey, asrModel, llmBaseUrl } = getConfig()
  if (!apiKey) throw new Error('尚未配置 API Key，请先在「设置」中填写')

  const form = new FormData()
  form.append('file', new Blob([readFileSync(audioPath)], { type: 'audio/mpeg' }), 'audio.mp3')
  form.append('model', asrModel)

  let lastErr: unknown
  for (const delay of [0, 1500, 4000]) {
    if (delay) await sleep(delay)
    try {
      const res = await fetch(`${llmBaseUrl}/audio/transcriptions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: AbortSignal.timeout(300_000)
      })
      if (!res.ok) {
        throw new Error(`转写失败 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
      }
      const data = (await res.json()) as { text?: string }
      const text = (data.text ?? '').trim()
      if (!text) throw new Error('转写结果为空')
      return text
    } catch (err) {
      lastErr = err
      // 超时（可重试）必须与用户取消区分开：超时信号以 name=TimeoutError 出现
      if (err instanceof Error && err.name === 'AbortError' && !isTimeoutErr(err)) throw err
      const status = err instanceof Error && /HTTP (\d+)/.exec(err.message)?.[1]
      const retriable = isTimeoutErr(err) || status === '429' || status === '503' || status === '500'
      if (!retriable) throw err
    }
  }
  if (isTimeoutErr(lastErr)) {
    throw new Error(
      '语音转写超时：识别服务响应过慢或网络不稳定，已自动重试仍失败。请点击「继续」重试（进度已保存）'
    )
  }
  throw lastErr
}

export async function transcribeBatch(
  files: string[],
  segmentSeconds: number,
  onProgress: (done: number, total: number) => void
): Promise<TranscriptBlock[]> {
  // 并发转写提速（3 路）：60s 细分段的请求数是旧 300s 分段的 5 倍，
  // 靠并发把总耗时压回与旧方案接近的水平
  const parts = await parallelMap(files, 3, async (file, i) => {
    const text = await transcribeFile(file)
    return { text, startTime: i * segmentSeconds } satisfies TranscriptBlock
  })
  parts.forEach((_, i) => onProgress(i + 1, files.length))
  return parts
}