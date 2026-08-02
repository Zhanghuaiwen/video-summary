import { app } from 'electron'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import type { AppConfig } from '@shared/types'

export const DEFAULT_CONFIG: AppConfig = {
  apiKey: '',
  asrModel: 'FunAudioLLM/SenseVoiceSmall',
  llmModel: 'Qwen/Qwen2.5-7B-Instruct',
  llmBaseUrl: 'https://api.siliconflow.cn/v1'
}

let cache: AppConfig | null = null

function configFile(): string {
  return join(app.getPath('userData'), 'config.json')
}

export function getConfig(): AppConfig {
  if (cache) return cache
  try {
    if (existsSync(configFile())) {
      cache = { ...DEFAULT_CONFIG, ...(JSON.parse(readFileSync(configFile(), 'utf-8')) as Partial<AppConfig>) }
    } else {
      cache = { ...DEFAULT_CONFIG }
    }
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
