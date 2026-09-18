import { app } from 'electron'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs'
import { join } from 'path'

/**
 * SQLite 数据层（Electron 35 内置 Node 22.14 的 node:sqlite，FTS5 可用，零原生依赖）。
 *
 * 设计：
 * - projects 表：项目元数据 + 各阶段产物文档（JSON 列），文档不再落独立文件；
 * - settings 表：应用配置（单行 key-value）；
 * - cache 表：分析结果缓存（按内容指纹命中时直接把文档写回项目，帧图仍以文件存 cache/<key>/frames）；
 * - project_fts / project_fts_trgm：FTS5 虚拟表。trigram 分词器支持中文子串检索（≥3 字符），
 *   unicode61 兼容英文单词/多词查询，二者 UNION 后按 bm25 排序。
 */

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db
  const userDataDir = app.getPath('userData')
  mkdirSync(userDataDir, { recursive: true })
  db = new DatabaseSync(join(userDataDir, 'video-summary.db'))
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA synchronous = NORMAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  migrateSchema(db)
  migrateLegacyData(db, userDataDir)
  backfillProjectDocs(db, userDataDir)
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  source_url TEXT,
  local_path TEXT,
  media_path TEXT,
  stage TEXT NOT NULL,
  progress REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  error TEXT,
  media_hash TEXT,
  analysis_config_json TEXT,
  checkpoint_json TEXT,
  transcript TEXT,
  blocks_json TEXT,
  summary_json TEXT,
  vision_json TEXT,
  mindmap_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_projects_updated_at ON projects(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_stage ON projects(stage);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  transcript TEXT,
  blocks_json TEXT,
  summary_json TEXT,
  vision_json TEXT,
  mindmap_json TEXT,
  created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS project_fts USING fts5(
  title, transcript, summary, mindmap,
  project_id UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);

CREATE VIRTUAL TABLE IF NOT EXISTS project_fts_trgm USING fts5(
  title, transcript, summary, mindmap,
  project_id UNINDEXED,
  tokenize = 'trigram'
);
`

function migrateSchema(d: DatabaseSync): void {
  d.exec(SCHEMA)
}

/**
 * 首次使用的旧版数据迁移：store.json / config.json → SQLite。
 * 迁移成功后把原文件改名保留（*.legacy），失败则保持原文件不动，下次启动重试。
 */
function migrateLegacyData(d: DatabaseSync, userDataDir: string): void {
  const storeFile = join(userDataDir, 'store.json')
  if (existsSync(storeFile)) {
    try {
      const raw = JSON.parse(readFileSync(storeFile, 'utf-8')) as { projects?: unknown }
      const projects = Array.isArray(raw.projects) ? raw.projects : []
      const ins = d.prepare(
        `INSERT OR IGNORE INTO projects(
          id, title, source, source_url, local_path, media_path, stage, progress,
          created_at, updated_at, error, media_hash, analysis_config_json, checkpoint_json
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      for (const p of projects) {
        const o = p as Record<string, unknown>
        if (typeof o['id'] !== 'string' || typeof o['title'] !== 'string') continue
        const v = (x: unknown): string | number | null => {
          if (x === null || x === undefined) return null
          const t = typeof x
          if (t === 'string' || t === 'number' || t === 'bigint') return x as string | number
          return JSON.stringify(x)
        }
        ins.run(
          v(o['id']),
          v(o['title']),
          v(o['source'] ?? 'local'),
          v(o['sourceUrl']),
          v(o['localPath']),
          v(o['mediaPath']),
          v(o['stage'] ?? 'done'),
          v(o['progress'] ?? 0),
          v(o['createdAt'] ?? new Date().toISOString()),
          v(o['updatedAt'] ?? new Date().toISOString()),
          v(o['error']),
          v(o['mediaHash']),
          v(o['analysisConfig'] ? JSON.stringify(o['analysisConfig']) : null),
          v(o['checkpoint'] ? JSON.stringify(o['checkpoint']) : null)
        )
      }
      renameSync(storeFile, join(userDataDir, 'store.json.legacy'))
    } catch {
      // 迁移失败保留原文件，下次再迁（不阻塞应用）
    }
  }

  const configFile = join(userDataDir, 'config.json')
  if (existsSync(configFile)) {
    try {
      const config = JSON.parse(readFileSync(configFile, 'utf-8')) as unknown
      if (config && typeof config === 'object') {
        d.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(
          'app',
          JSON.stringify(config)
        )
      }
      renameSync(configFile, join(userDataDir, 'config.json.legacy'))
    } catch {
      // 同上，保留原文件
    }
  }
}

/**
 * 一次性回填：把旧版文件存储遗留的产物文档（projects/<id>/ 目录下的
 * transcript.txt / blocks.json / summary.json / vision.json / mindmap.json）
 * 读入 projects 表中仍为空的列。历史上迁移/升级期间曾出现只搬元数据、
 * 产物列全空的状况，这里统一补上。
 */
function backfillProjectDocs(d: DatabaseSync, userDataDir: string): void {
  const done = d.prepare('SELECT 1 AS v FROM settings WHERE key = ?').get('doc:backfill:v1')
  if (done) return

  const projectsDir = join(userDataDir, 'projects')
  const readText = (p: string): string | null => {
    try {
      return existsSync(p) ? readFileSync(p, 'utf-8') : null
    } catch {
      return null
    }
  }
  const rows = d
    .prepare(
      `SELECT id, transcript, blocks_json, summary_json, vision_json, mindmap_json FROM projects`
    )
    .all() as unknown as {
    id: string
    transcript: string | null
    blocks_json: string | null
    summary_json: string | null
    vision_json: string | null
    mindmap_json: string | null
  }[]
  const updTranscript = d.prepare('UPDATE projects SET transcript = ? WHERE id = ? AND transcript IS NULL')
  const updBlocks = d.prepare('UPDATE projects SET blocks_json = ? WHERE id = ? AND blocks_json IS NULL')
  const updSummary = d.prepare('UPDATE projects SET summary_json = ? WHERE id = ? AND summary_json IS NULL')
  const updVision = d.prepare('UPDATE projects SET vision_json = ? WHERE id = ? AND vision_json IS NULL')
  const updMindmap = d.prepare('UPDATE projects SET mindmap_json = ? WHERE id = ? AND mindmap_json IS NULL')

  for (const row of rows) {
    const dir = join(projectsDir, row.id)
    if (!existsSync(dir)) continue
    if (row.transcript == null) {
      const t = readText(join(dir, 'transcript.txt'))
      if (t != null) updTranscript.run(t, row.id)
    }
    if (row.blocks_json == null) {
      const b = readText(join(dir, 'blocks.json'))
      if (b != null) updBlocks.run(b, row.id)
    }
    if (row.summary_json == null) {
      const s = readText(join(dir, 'summary.json'))
      if (s != null) updSummary.run(s, row.id)
    }
    if (row.vision_json == null) {
      const v = readText(join(dir, 'vision.json'))
      if (v != null) updVision.run(v, row.id)
    }
    if (row.mindmap_json == null) {
      const m = readText(join(dir, 'mindmap.json'))
      if (m != null) updMindmap.run(m, row.id)
    }
  }

  d.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run('doc:backfill:v1', '1')
}