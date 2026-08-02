import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { DEFAULT_CONFIG, type AppConfig } from '@shared/types'

let cache: AppConfig | null = null

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function getConfig(): AppConfig {
  if (cache) return cache
  try {
    const saved = JSON.parse(readFileSync(configFile(), 'utf-8')) as Partial<AppConfig>
    cache = { ...DEFAULT_CONFIG, ...saved }
  } catch {
    cache = { ...DEFAULT_CONFIG }
  }
  return cache
}

export function setConfig(patch: Partial<AppConfig>): AppConfig {
  const next = { ...getConfig(), ...patch }
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(configFile(), JSON.stringify(next, null, 2), 'utf-8')
  cache = next
  return next
}
