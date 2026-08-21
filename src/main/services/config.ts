import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/types'

let cache: AppConfig | null = null

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

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
    const saved = JSON.parse(readFileSync(configFile(), 'utf-8')) as Partial<AppConfig>
    cache = sanitizeConfig(saved)
  } catch {
    cache = { ...DEFAULT_CONFIG }
  }
  return cache
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = sanitizeConfig({ ...getConfig(), ...patch })
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf-8')
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