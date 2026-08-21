import { getConfig } from './config'

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export type MessageContent = string | ContentPart[]

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: MessageContent
}

export interface ChatOptions {
  maxTokens?: number
  jsonMode?: boolean
  temperature?: number
  timeoutMs?: number
  /** 覆盖当前总结模型（用于视觉模型等） */
  model?: string
  signal?: AbortSignal
  /** 用户自定义分析要求，作为独立系统层注入 */
  customPrompt?: string
}

class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** LLM 请求超时：可安全重试（区别于用户取消任务） */
class LlmTimeoutError extends Error {
  constructor(ms: number) {
    super(`LLM 请求超过 ${Math.round(ms / 1000)} 秒未返回（已按重试机制自动重试）`)
    this.name = 'LlmTimeoutError'
  }
}

/**
 * 请求超时按期望输出规模自动放大：基础 150s + 每 token 50ms。
 * 思考型模型（如 Qwen3）与长文档总结（8192 token）响应很慢，超时须留足余量。
 */
function pickTimeout(opts: ChatOptions): number {
  if (opts.timeoutMs) return opts.timeoutMs
  const tokens = opts.maxTokens ?? 4096
  return 150_000 + tokens * 50
}

function buildSignal(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const timed = AbortSignal.timeout(timeoutMs)
  if (!external) return timed
  try {
    return AbortSignal.any([timed, external])
  } catch {
    return external
  }
}

async function request(messages: ChatMessage[], opts: ChatOptions, jsonMode: boolean): Promise<string> {
  const { apiKey, llmModel, llmBaseUrl } = getConfig()
  if (!apiKey) throw new Error('尚未配置 API Key，请先在「设置」中填写')

  const baseSystem = { role: 'system' as const, content: '请用中文回答。' }
  const custom: ChatMessage[] =
    opts.customPrompt && opts.customPrompt.trim()
      ? [
          {
            role: 'system',
            content: `用户额外分析要求：\n${opts.customPrompt.trim()}\n\n请在实际分析中遵循此要求（影响分析重点与输出风格），但不得违反下面任务对输出格式与数据结构的硬性规定。`
          }
        ]
      : []

  const model = opts.model ?? llmModel
  const body: Record<string, unknown> = {
    model,
    messages: [baseSystem, ...custom, ...messages],
    temperature: opts.temperature ?? 0.3,
    max_tokens: opts.maxTokens ?? 4096
  }
  if (jsonMode) body.response_format = { type: 'json_object' }
  // Qwen3/Qwen3.5 系列是思考型模型：默认会在正文前输出大段推理内容，
  // 导致长总结请求轻松超过超时阈值。必须显式关闭思考：
  // - 硅基流动等 OpenAI 兼容网关用 enable_thinking: false
  // - 火山方舟等用 thinking: { type: 'disabled' }
  if (/^Qwen\/Qwen3/i.test(model)) {
    if (/siliconflow/i.test(llmBaseUrl)) body['enable_thinking'] = false
    else body['thinking'] = { type: 'disabled' }
  }

  const timeoutMs = opts.timeoutMs ?? pickTimeout(opts)

  let text: string
  try {
    const res = await fetch(`${llmBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(body),
      signal: buildSignal(timeoutMs, opts.signal)
    })
    // 响应体读取阶段同样受超时信号约束，须一并转成可重试的超时错误
    text = await res.text()
    if (!res.ok) throw new ApiError(res.status, `LLM 请求失败 HTTP ${res.status}: ${text.slice(0, 300)}`)
  } catch (err) {
    // 区分超时（可重试）与其他错误：超时信号会以 name=TimeoutError 的 Error 形式出现
    const causeName = err instanceof Error ? (err as Error & { cause?: Error }).cause?.name : undefined
    const isTimeout =
      (err instanceof Error && err.name === 'TimeoutError') ||
      causeName === 'TimeoutError' ||
      (err instanceof Error && /timed? ?out/i.test(err.message))
    if (isTimeout) throw new LlmTimeoutError(timeoutMs)
    // 用户主动取消：立即终止，不上报为超时
    if (err instanceof Error && err.name === 'AbortError') throw err
    throw err
  }

  let content = ''
  let detail = ''
  try {
    type Choice = {
      message?: { content?: string | null; refusal?: string | null; reasoning_content?: string | null }
      finish_reason?: string | null
    }
    const data = JSON.parse(text) as { choices?: Choice[] }
    const choice = data.choices?.[0]
    content = choice?.message?.content ?? ''
    const parts: string[] = []
    if (choice?.finish_reason) parts.push(`finish_reason=${choice.finish_reason}`)
    if (choice?.message?.refusal) parts.push(`refusal=${choice.message.refusal}`)
    if (!content && choice?.message?.reasoning_content) {
      detail = `（模型输出了 reasoning_content 但 content 为空，请检查模型是否支持在消息中直接返回正文）`
    }
    detail = parts.length ? `；详情: ${parts.join('; ')}` : detail
  } catch {
    throw new Error(`LLM 响应无法解析: ${text.slice(0, 200)}`)
  }
  if (!content.trim()) {
    throw new Error(`LLM 返回为空${detail}。可尝试：1) 在「设置」中检查模型名与 API Base URL；2) 换一个模型；3) 缩短视频/减少自定义要求。`)
  }
  return content
}

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const delays = [0, 2000, 5000]
  let jsonMode = opts.jsonMode ?? false
  let lastErr: unknown
  let emptyRetried = false
  let timeoutRetried = false

  for (const delay of delays) {
    if (delay) await sleep(delay)
    try {
      return await request(messages, opts, jsonMode)
    } catch (err) {
      lastErr = err
      // 超时：重试一次（并去掉 JSON 严格模式），避免多次全时长重试叠加账单
      if (err instanceof LlmTimeoutError) {
        if (!timeoutRetried) {
          timeoutRetried = true
          if (jsonMode) jsonMode = false
          continue
        }
        throw new Error(
          'LLM 请求超时：模型响应太慢或网络不稳定，已重试一次仍未完成。\n建议：在「设置」中换用 Qwen/Qwen2.5-7B-Instruct 等响应更快的模型，或稍后重试'
        )
      }
      if (err instanceof ApiError) {
        if (err.status === 429 || err.status === 503) continue
        if (jsonMode && err.status >= 400 && err.status < 500) {
          jsonMode = false
          continue
        }
      }
      // 空响应：可能是 JSON 严格模式 + 内容过滤导致，先去掉 json_mode 重试一次
      if (err instanceof Error && err.message.startsWith('LLM 返回为空')) {
        if (jsonMode && !emptyRetried) {
          emptyRetried = true
          jsonMode = false
          continue
        }
        throw err
      }
      if (err instanceof Error && err.name === 'AbortError') throw err
      throw err
    }
  }
  throw lastErr
}

export function extractJsonLoose(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  if (start === -1) throw new Error('无法解析 LLM 返回的 JSON')
  // 从第一个 { 开始，尝试从最右侧的 } 逐个回退解析，容忍截断或尾部噪声（最多回退 40 次）
  let end = candidate.lastIndexOf('}')
  for (let attempt = 0; attempt < 40 && end > start; attempt++) {
    try {
      return JSON.parse(candidate.slice(start, end + 1))
    } catch {
      const prev = candidate.lastIndexOf('}', end - 1)
      if (prev <= start) break
      end = prev
    }
  }
  throw new Error('无法解析 LLM 返回的 JSON')
}

export async function chatJson(messages: ChatMessage[], opts: ChatOptions = {}): Promise<unknown> {
  const content = await chat(messages, { ...opts, jsonMode: opts.jsonMode ?? true })
  try {
    return extractJsonLoose(content)
  } catch {
    const repaired = await chat(
      [
        ...messages,
        {
          role: 'user',
          content:
            '上面你的输出不是合法 JSON。请重新输出，只输出符合要求的 JSON，不要包含任何其他文字或代码块标记。'
        }
      ],
      opts
    )
    return extractJsonLoose(repaired)
  }
}