import { app } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, mkdirSync, existsSync, copyFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { AnalysisConfig } from '@shared/types'

function cacheDir(): string {
  return join(app.getPath('userData'), 'cache')
}

export async function sha1File(path: string): Promise<string> {
  const hash = createHash('sha1')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

function hashString(s: string): string {
  return createHash('sha1').update(s).digest('hex')
}

export interface CacheKeyParts {
  mediaHash: string
  asrModel: string
  llmModel: string
  visionModel: string
  analysis: AnalysisConfig
}

export function buildCacheKey(parts: CacheKeyParts): string {
  const a = parts.analysis ?? ({} as AnalysisConfig)
  const raw = [
    // 时间轴方案版本：分段时长/时间细化逻辑变更时递增，避免旧缓存以错误时间轴命中
    'tl-v2',
    parts.mediaHash,
    parts.asrModel,
    parts.llmModel,
    parts.visionModel,
    String(a.enableVision ?? true),
    String(a.keyFrameInterval ?? 60),
    String(a.sceneThreshold ?? 0.3),
    String(a.maxKeyFrames ?? 30),
    (a.customPrompt ?? '').trim()
  ].join('|')
  return hashString(raw)
}

const CACHE_FILES = ['transcript.txt', 'blocks.json', 'summary.json', 'vision.json', 'mindmap.json']

/** 命中缓存：把缓存的分析产物复制进项目工作目录 */
export function restoreFromCache(key: string, projectDir: string): boolean {
  const src = join(cacheDir(), key)
  if (!existsSync(src)) return false
  mkdirSync(projectDir, { recursive: true })
  for (const f of CACHE_FILES) {
    const s = join(src, f)
    if (existsSync(s)) copyFileSync(s, join(projectDir, f))
  }
  const framesSrc = join(src, 'frames')
  if (existsSync(framesSrc)) {
    const framesDst = join(projectDir, 'frames')
    rmSync(framesDst, { recursive: true, force: true })
    copyDirRecursive(framesSrc, framesDst)
  }
  return true
}

export function saveToCache(key: string, projectDir: string): void {
  const dst = join(cacheDir(), key)
  rmSync(dst, { recursive: true, force: true })
  mkdirSync(dst, { recursive: true })
  for (const f of CACHE_FILES) {
    const s = join(projectDir, f)
    if (existsSync(s)) copyFileSync(s, join(dst, f))
  }
  const framesSrc = join(projectDir, 'frames')
  if (existsSync(framesSrc)) copyDirRecursive(framesSrc, join(dst, 'frames'))
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyDirRecursive(s, d)
    else copyFileSync(s, d)
  }
}

export { cacheDir }