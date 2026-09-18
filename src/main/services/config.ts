import { getDb } from '../db'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/types'

let cache: AppConfig | null = null

const KEY = 'app'

function sanitizeConfig(raw: Partial<AppConfig>): AppConfig {
  const base = { ...DEFAULT_CONFIG, ...raw }
  const theme = base.theme === 'light' ? 'light' : 'dark'
  const accent = base.accent === 'blue' ? 'blue' : 'orange'
  const recent = Array.isArray(base.recentPrompts)
    ? base.recentPrompts
        .map((p) => (typeof p === 'string' ? p.slice(0, 2000) : ''))
        .filter((p) => p.length > 0)
        .slice(0, 5)
    : []
  return { ...base, theme, accent, recentPrompts: recent }
}

export function getConfig(): AppConfig {
  if (cache) return cache
  try {
    const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(KEY) as
      | { value: string }
      | undefined
    cache = sanitizeConfig(row ? (JSON.parse(row.value) as Partial<AppConfig>) : {})
  } catch {
    cache = { ...DEFAULT_CONFIG }
  }
  return cache
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = sanitizeConfig({ ...getConfig(), ...patch })
  getDb()
    .prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(KEY, JSON.stringify(next))
  cache = next
  return next
}

export function saveRecentPrompt(prompt: string): AppConfig {
  const p = (prompt ?? '').trim()
  if (!p) return getConfig()
  const cur = getConfig()
  const list = [p, ...cur.recentPrompts.filter((x) => x !== p)].slice(0, 5)
  return setConfig({ recentPrompts: list })
}

/**
 * 总结失败/返回空结果时自动切换的备用模型。
 * 当用户把主模型从默认快速模型换成较慢/不稳定的模型时返回默认模型（如硅基流动的 Qwen2.5-7B-Instruct），
 * 其它情况返回 undefined（无备用）。
 */
export function summaryFallbackModel(): string | undefined {
  const cfg = getConfig()
  if (!/siliconflow/i.test(cfg.llmBaseUrl)) return undefined
  const primary = cfg.llmModel || DEFAULT_CONFIG.llmModel
  if (primary === DEFAULT_CONFIG.llmModel) return undefined
  return DEFAULT_CONFIG.llmModel
}