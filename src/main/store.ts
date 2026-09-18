import { app } from 'electron'
import { rmSync, existsSync } from 'fs'
import { join } from 'path'
import { getDb } from './db'
import { findBestVideoInDir, isAudioMediaPath } from './services/video'
import type {
  CreateProjectInput,
  MindMapDoc,
  MindMapNode,
  PipelineStage,
  Project,
  SummaryDoc,
  VideoSource,
  VisionDoc
} from '@shared/types'
import { walk } from '@shared/mindmap-util'

export type ProjectPatch = Partial<Omit<Project, 'id' | 'createdAt'>>

export interface Store {
  listProjects: () => Project[]
  getProject: (id: string) => Project | undefined
  createProject: (input: CreateProjectInput) => Project
  updateProject: (id: string, patch: ProjectPatch) => void
  deleteProject: (id: string) => void
  projectWorkDir: (id: string) => string

  getTranscript: (id: string) => string | undefined
  getBlocks: (id: string) => string | undefined
  saveTranscript: (id: string, text: string) => void
  saveBlocks: (id: string, json: string) => void

  getSummary: (id: string) => SummaryDoc | undefined
  saveSummary: (id: string, doc: SummaryDoc) => void
  getVision: (id: string) => VisionDoc | undefined
  saveVision: (id: string, doc: VisionDoc) => void
  getMindMap: (id: string) => MindMapDoc | undefined
  saveMindMap: (id: string, doc: MindMapDoc) => void
  hasMindMap: (id: string) => boolean

  /** 修复把纯音频/缺失文件当视频的项目：在项目目录里找到完整视频并写回 mediaPath，返回修复数量 */
  repairMediaPaths: () => number

  /** 清空项目的分析产物与断点，回到 queued 状态（保留视频与配置），供「重新分析」使用 */
  clearProjectAnalysis: (id: string) => void
}

interface ProjectRow {
  id: string
  title: string
  source: string
  source_url: string | null
  local_path: string | null
  media_path: string | null
  stage: string
  progress: number
  created_at: string
  updated_at: string
  error: string | null
  media_hash: string | null
  analysis_config_json: string | null
  checkpoint_json: string | null
  transcript: string | null
  blocks_json: string | null
  summary_json: string | null
  vision_json: string | null
  mindmap_json: string | null
}

function parseJson<T>(raw: string | null | undefined): T | undefined {
  if (raw == null) return undefined
  try {
    return JSON.parse(raw) as T
  } catch {
    return undefined
  }
}

function rowToProject(r: ProjectRow): Project {
  return {
    id: r.id,
    title: r.title,
    source: r.source as VideoSource,
    sourceUrl: r.source_url,
    localPath: r.local_path,
    mediaPath: r.media_path ?? undefined,
    stage: r.stage as PipelineStage,
    progress: r.progress,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    error: r.error ?? undefined,
    mediaHash: r.media_hash ?? undefined,
    analysisConfig: parseJson<Project['analysisConfig']>(r.analysis_config_json),
    checkpoint: parseJson<Project['checkpoint']>(r.checkpoint_json)
  }
}

/** 总结文档 → 可检索纯文本（FTS 索引用） */
function summarySearchText(doc: SummaryDoc): string {
  const parts: string[] = [doc.title, doc.overview, ...(doc.takeaways ?? [])]
  for (const c of doc.chapters) {
    parts.push(c.title, c.summary)
    for (const p of c.points) {
      parts.push(p.text, ...(p.subPoints ?? []))
    }
  }
  return parts.join('\n')
}

/** 导图树 → 可检索纯文本（FTS 索引用） */
function mindmapSearchText(root: MindMapNode): string {
  const parts: string[] = []
  walk(root, (n) => parts.push(n.title, n.summary ?? '', n.content ?? '', ...(n.keywords ?? [])))
  return parts.join('\n')
}

export function createStore(onProjectUpdated?: (project: Project) => void): Store {
  const db = getDb()
  const userDataDir = app.getPath('userData')

  const stmtList = db.prepare('SELECT * FROM projects ORDER BY datetime(created_at) DESC')
  const stmtGet = db.prepare('SELECT * FROM projects WHERE id = ?')
  const stmtInsert = db.prepare(
    `INSERT INTO projects(
      id, title, source, source_url, local_path, media_path, stage, progress,
      created_at, updated_at, error, media_hash, analysis_config_json, checkpoint_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  )
  const stmtUpdate = db.prepare(
    `UPDATE projects SET
      title=?, source=?, source_url=?, local_path=?, media_path=?, stage=?, progress=?,
      updated_at=?, error=?, media_hash=?, analysis_config_json=?, checkpoint_json=?
      WHERE id=?`
  )
  const stmtDelete = db.prepare('DELETE FROM projects WHERE id = ?')
  const stmtResetAnalysis = db.prepare(
    `UPDATE projects SET
      transcript = NULL,
      blocks_json = NULL,
      summary_json = NULL,
      vision_json = NULL,
      mindmap_json = NULL,
      checkpoint_json = NULL,
      media_hash = NULL,
      stage = 'queued',
      progress = 0,
      error = NULL,
      updated_at = ?
      WHERE id = ?`
  )
  const stmtSetTranscript = db.prepare('UPDATE projects SET transcript = ? WHERE id = ?')
  const stmtSetBlocks = db.prepare('UPDATE projects SET blocks_json = ? WHERE id = ?')
  const stmtSetSummary = db.prepare('UPDATE projects SET summary_json = ? WHERE id = ?')
  const stmtSetVision = db.prepare('UPDATE projects SET vision_json = ? WHERE id = ?')
  const stmtSetMindmap = db.prepare(
    'UPDATE projects SET mindmap_json = ?, updated_at = ? WHERE id = ?'
  )
  const stmtFtsDel = db.prepare('DELETE FROM project_fts WHERE project_id = ?')
  const stmtFtsTrgmDel = db.prepare('DELETE FROM project_fts_trgm WHERE project_id = ?')
  const stmtFtsIns = db.prepare(
    'INSERT INTO project_fts(title, transcript, summary, mindmap, project_id) VALUES (?,?,?,?,?)'
  )
  const stmtFtsTrgmIns = db.prepare(
    'INSERT INTO project_fts_trgm(title, transcript, summary, mindmap, project_id) VALUES (?,?,?,?,?)'
  )
  const stmtHasMindmap = db.prepare(
    'SELECT 1 AS has FROM projects WHERE id = ? AND mindmap_json IS NOT NULL'
  )

  const refreshFts = (id: string): void => {
    const row = stmtGet.get(id) as ProjectRow | undefined
    if (!row) return
    const title = row.title
    const transcript = row.transcript ?? ''
    const summaryText = summarySearchText(parseJson<SummaryDoc>(row.summary_json) ?? {
      title,
      overview: '',
      chapters: [],
      projectId: id,
      createdAt: ''
    })
    const mindmapDoc = parseJson<MindMapDoc>(row.mindmap_json)
    const mindmapText = mindmapDoc ? mindmapSearchText(mindmapDoc.root) : ''
    stmtFtsDel.run(id)
    stmtFtsTrgmDel.run(id)
    stmtFtsIns.run(title, transcript, summaryText, mindmapText, id)
    stmtFtsTrgmIns.run(title, transcript, summaryText, mindmapText, id)
  }

  // 启动时一次性重建 FTS：迁移/回填历史数据后补齐索引（含此前版本漏建的旧行）
  const ftsBuilt = db.prepare('SELECT 1 AS v FROM settings WHERE key = ?').get('fts:rebuild:v1')
  if (!ftsBuilt) {
    for (const r of stmtList.all() as unknown as ProjectRow[]) refreshFts(r.id)
    db.prepare('INSERT OR REPLACE INTO settings(key, value) VALUES (?, ?)').run(
      'fts:rebuild:v1',
      new Date().toISOString()
    )
  }

  const projectWorkDir = (id: string): string => join(userDataDir, 'projects', id)

  const repairMediaPaths = (): number => {
    let fixed = 0
    for (const row of stmtList.all() as unknown as ProjectRow[]) {
      const project = rowToProject(row)
      const current = project.mediaPath ?? ''
      // 已经是有效的视频文件就没必要动（本地项目引用外部视频也在此列）
      if (current && !isAudioMediaPath(current) && existsSync(current)) continue
      // 在项目目录里找完整视频（media.mp4 或 media.f30080.mp4 等），把纯音频/缺失改成真视频
      const video = findBestVideoInDir(projectWorkDir(project.id))
      if (!video || video === current) continue
      const merged = { ...project, mediaPath: video, updatedAt: new Date().toISOString() }
      stmtUpdate.run(
        merged.title,
        merged.source,
        merged.sourceUrl ?? null,
        merged.localPath ?? null,
        merged.mediaPath ?? null,
        merged.stage,
        merged.progress,
        merged.updatedAt,
        merged.error ?? null,
        merged.mediaHash ?? null,
        merged.analysisConfig ? JSON.stringify(merged.analysisConfig) : null,
        merged.checkpoint ? JSON.stringify(merged.checkpoint) : null,
        project.id
      )
      fixed++
    }
    return fixed
  }

  return {
    listProjects: () => (stmtList.all() as unknown as ProjectRow[]).map(rowToProject),

    getProject: (id) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      return row ? rowToProject(row) : undefined
    },

    createProject: (input) => {
      const now = new Date().toISOString()
      const project: Project = {
        id: crypto.randomUUID(),
        title: input.title,
        source: input.source,
        sourceUrl: input.sourceUrl ?? null,
        localPath: input.localPath ?? null,
        analysisConfig: input.analysisConfig,
        stage: 'queued',
        progress: 0,
        createdAt: now,
        updatedAt: now
      }
      stmtInsert.run(
        project.id,
        project.title,
        project.source,
        project.sourceUrl,
        project.localPath,
        null,
        project.stage,
        project.progress,
        project.createdAt,
        project.updatedAt,
        null,
        null,
        project.analysisConfig ? JSON.stringify(project.analysisConfig) : null,
        null
      )
      refreshFts(project.id)
      return project
    },

    deleteProject: (id) => {
      stmtFtsDel.run(id)
      stmtFtsTrgmDel.run(id)
      stmtDelete.run(id)
      // 清理工作目录（媒体/音频/帧图），避免磁盘垃圾累积
      try {
        rmSync(projectWorkDir(id), { recursive: true, force: true })
      } catch {
        // 忽略清理失败
      }
    },

    updateProject: (id, patch) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      if (!row) return
      const merged = { ...rowToProject(row), ...patch, updatedAt: new Date().toISOString() }
      stmtUpdate.run(
        merged.title,
        merged.source,
        merged.sourceUrl ?? null,
        merged.localPath ?? null,
        merged.mediaPath ?? null,
        merged.stage,
        merged.progress,
        merged.updatedAt,
        merged.error ?? null,
        merged.mediaHash ?? null,
        merged.analysisConfig ? JSON.stringify(merged.analysisConfig) : null,
        merged.checkpoint ? JSON.stringify(merged.checkpoint) : null,
        id
      )
      // 只有标题变化才需要重建 FTS（进度等高频更新不碰索引）
      if (patch.title !== undefined) refreshFts(id)
      onProjectUpdated?.(merged)
    },

    projectWorkDir,

    getTranscript: (id) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      return row?.transcript ?? undefined
    },

    getBlocks: (id) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      return row?.blocks_json ?? undefined
    },

    saveTranscript: (id, text) => {
      stmtSetTranscript.run(text, id)
      refreshFts(id)
    },

    saveBlocks: (id, json) => {
      stmtSetBlocks.run(json, id)
    },

    getSummary: (id) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      return parseJson<SummaryDoc>(row?.summary_json)
    },

    saveSummary: (id, doc) => {
      stmtSetSummary.run(JSON.stringify(doc), id)
      refreshFts(id)
    },

    getVision: (id) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      return parseJson<VisionDoc>(row?.vision_json)
    },

    saveVision: (id, doc) => {
      stmtSetVision.run(JSON.stringify(doc), id)
      refreshFts(id)
    },

    getMindMap: (id) => {
      const row = stmtGet.get(id) as ProjectRow | undefined
      return parseJson<MindMapDoc>(row?.mindmap_json)
    },

    saveMindMap: (id, doc) => {
      stmtSetMindmap.run(JSON.stringify(doc), new Date().toISOString(), id)
      refreshFts(id)
    },

    hasMindMap: (id) => Boolean(stmtHasMindmap.get(id)),

    repairMediaPaths,

    clearProjectAnalysis: (id) => {
      stmtResetAnalysis.run(new Date().toISOString(), id)
      refreshFts(id)
    }
  }
}