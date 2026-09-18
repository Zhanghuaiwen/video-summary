import { app } from 'electron'
import { createHash } from 'crypto'
import { createReadStream, mkdirSync, existsSync, rmSync, readdirSync, statSync, copyFileSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { getDb } from '../db'
import type { AnalysisConfig } from '@shared/types'

export interface CacheDocs {
  transcript?: string
  blocksJson?: string
  summaryJson?: string
  visionJson?: string
  mindmapJson?: string
}

function cacheRoot(): string {
  return join(app.getPath('userData'), 'cache')
}

/** 单条缓存的目录（帧图以文件形式存这里，文档在 cache 表） */
export function cacheEntryDir(key: string): string {
  return join(cacheRoot(), key)
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

export function loadCacheDocs(key: string): CacheDocs | null {
  const row = getDb()
    .prepare('SELECT transcript, blocks_json, summary_json, vision_json, mindmap_json FROM cache WHERE key = ?')
    .get(key) as
    | { transcript: string | null; blocks_json: string | null; summary_json: string | null; vision_json: string | null; mindmap_json: string | null }
    | undefined
  if (!row) return null
  return {
    transcript: row.transcript ?? undefined,
    blocksJson: row.blocks_json ?? undefined,
    summaryJson: row.summary_json ?? undefined,
    visionJson: row.vision_json ?? undefined,
    mindmapJson: row.mindmap_json ?? undefined
  }
}

export function saveCacheDocs(key: string, docs: CacheDocs): void {
  getDb()
    .prepare(
      `INSERT INTO cache(key, transcript, blocks_json, summary_json, vision_json, mindmap_json, created_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(key) DO UPDATE SET
         transcript=excluded.transcript, blocks_json=excluded.blocks_json,
         summary_json=excluded.summary_json, vision_json=excluded.vision_json,
         mindmap_json=excluded.mindmap_json, created_at=excluded.created_at`
    )
    .run(
      key,
      docs.transcript ?? null,
      docs.blocksJson ?? null,
      docs.summaryJson ?? null,
      docs.visionJson ?? null,
      docs.mindmapJson ?? null,
      new Date().toISOString()
    )
}

export function deleteCacheDocs(key: string): void {
  getDb().prepare('DELETE FROM cache WHERE key = ?').run(key)
  try {
    rmSync(cacheEntryDir(key), { recursive: true, force: true })
  } catch {
    // 忽略清理失败
  }
}

/** 把项目工作目录下的 frames 目录复制进缓存（命中后供 restoreFramesDir 还原） */
export function saveFramesDir(projectDir: string, key: string): void {
  const src = join(projectDir, 'frames')
  if (!existsSync(src)) return
  const dst = join(cacheEntryDir(key), 'frames')
  rmSync(dst, { recursive: true, force: true })
  copyDirRecursive(src, dst)
}

/** 从缓存把帧图还原进项目工作目录 */
export function restoreFramesDir(key: string, projectDir: string): boolean {
  const src = join(cacheEntryDir(key), 'frames')
  if (!existsSync(src)) return false
  mkdirSync(join(projectDir, 'frames'), { recursive: true })
  copyDirRecursive(src, join(projectDir, 'frames'))
  return true
}

function copyDirRecursive(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true })
  for (const entry of readdirSync(src)) {
    const s = join(src, entry)
    const d = join(dst, entry)
    if (statSync(s).isDirectory()) copyDirRecursive(s, d)
    else {
      try {
        rmSync(d, { force: true })
        copyFileSync(s, d)
      } catch {
        // 单帧拷贝失败忽略
      }
    }
  }
}