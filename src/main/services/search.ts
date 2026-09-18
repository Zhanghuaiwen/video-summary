import { getDb } from '../db'
import type { Store } from '../store'
import type { MindMapDoc, MindMapNode, ProjectSearchHit, SummaryDoc } from '@shared/types'
import { walk } from '@shared/mindmap-util'

/**
 * 跨项目全文检索。
 *
 * 检索策略（Hybrid）：
 * 1. 候选集：FTS5 做候选筛选 + bm25 排序——trigram 打字器支持中文子串（≥3 字符），
 *    unicode61 兼容英文单词/多词。查询 < 3 字符（如"缓存""性能"）时 FTS5 无解，
 *    直接退化为全项目扫描（本地数据量小，可忽略不计）。
 * 2. 摘要在 JS 里对结构化文档做精确命中定位（章节/要点/导图节点），
 *    而不是显示整个大文档——FTS 负责"哪里搜得快"，结构扫描负责"命中给得准"。
 */

const HIT_LIMIT = 20

const FTS_TABLES = ['project_fts_trgm', 'project_fts'] as const
const MIN_TRIGRAM_CHARS = 3

export function searchProjects(query: string, store: Store): ProjectSearchHit[] {
  const q = (query ?? '').trim().toLowerCase()
  if (!q) return []

  const candidates: Map<string, number> = new Map()
  const addCandidate = (pid: string | unknown): void => {
    if (typeof pid === 'string' && !candidates.has(pid)) candidates.set(pid, 0)
  }

  // ---- 1. FTS5 候选筛选（≥3 字符走索引，含排序） ----
  if (q.length >= MIN_TRIGRAM_CHARS) {
    const phrase = `"${q.replace(/"/g, '""')}"`
    for (const table of FTS_TABLES) {
      try {
        const rows = getDb()
          .prepare(
            `SELECT project_id, bm25(${table}) AS r FROM ${table}
             WHERE ${table} MATCH ?
             ORDER BY r
             LIMIT 80`
          )
          .all(phrase)
        for (const r of rows) addCandidate(r.project_id)
      } catch {
        // 非法查询表达式（特殊字符等）忽略，走下面的全量扫描
      }
    }
  }

  // ---- 2. 短查询或索引无命中：全量扫描兜底 ----
  if (candidates.size === 0) {
    for (const p of store.listProjects()) {
      if (p.stage !== 'done') continue
      addCandidate(p.id)
    }
  }

  // ---- 3. 对候选命中做结构化定位 + 摘要 ----
  const hits: ProjectSearchHit[] = []
  for (const pid of candidates.keys()) {
    const project = store.getProject(pid)
    if (!project) continue

    const summary = store.getSummary(pid)
    if (summary) {
      const hit = scanSummary(summary, q)
      if (hit) {
        hits.push({ ...hit, title: project.title, projectId: pid })
        if (hits.length >= HIT_LIMIT) break
        continue
      }
    }

    const mindmap = store.getMindMap(pid)
    if (mindmap) {
      const hit = scanMindMap(mindmap, q)
      if (hit) {
        hits.push({ ...hit, title: project.title, projectId: pid })
        if (hits.length >= HIT_LIMIT) break
        continue
      }
    }

    const transcript = store.getTranscript(pid)
    if (transcript) {
      const idx = transcript.toLowerCase().indexOf(q)
      if (idx >= 0) {
        hits.push({
          projectId: pid,
          title: project.title,
          location: 'transcript',
          snippet: makeSnippet(transcript, q, idx)
        })
        if (hits.length >= HIT_LIMIT) break
        continue
      }
    }

    if (project.title.toLowerCase().includes(q)) {
      hits.push({
        projectId: pid,
        title: project.title,
        location: 'title',
        snippet: makeSnippet(project.title, q, project.title.toLowerCase().indexOf(q))
      })
      if (hits.length >= HIT_LIMIT) break
    }
  }

  return hits
}

function scanSummary(doc: SummaryDoc, q: string): Omit<ProjectSearchHit, 'projectId' | 'title'> | null {
  if (doc.overview.toLowerCase().includes(q)) {
    return { location: 'summary', snippet: makeSnippet(doc.overview, q, doc.overview.toLowerCase().indexOf(q)) }
  }
  for (const c of doc.chapters) {
    const title = c.title.toLowerCase()
    const body = c.summary.toLowerCase()
    if (title.includes(q) || body.includes(q)) {
      return {
        location: 'summary',
        chapterTitle: c.title,
        snippet: makeSnippet(body.includes(q) ? c.summary : c.title, q, body.includes(q) ? body.indexOf(q) : title.indexOf(q))
      }
    }
    for (const p of c.points) {
      const pt = p.text.toLowerCase()
      if (pt.includes(q)) {
        return { location: 'summary', chapterTitle: c.title, snippet: makeSnippet(p.text, q, pt.indexOf(q)) }
      }
      for (const sp of p.subPoints ?? []) {
        const st = sp.toLowerCase()
        if (st.includes(q)) {
          return { location: 'summary', chapterTitle: c.title, snippet: makeSnippet(sp, q, st.indexOf(q)) }
        }
      }
    }
  }
  return null
}

function scanMindMap(doc: MindMapDoc, q: string): Omit<ProjectSearchHit, 'projectId' | 'title'> | null {
  const found: MindMapNode[] = []
  walk(doc.root, (n) => {
    if (found.length) return
    const parts = [n.title, n.summary ?? '', n.content ?? '', ...(n.keywords ?? [])]
    if (parts.some((t) => t.toLowerCase().includes(q))) found.push(n)
  })
  const node = found[0]
  if (!node) return null
  const all = [node.title, node.summary ?? '', node.content ?? '', ...(node.keywords ?? [])].join('\n')
  const idx = all.toLowerCase().indexOf(q)
  return {
    location: 'mindmap',
    nodeTitle: node.title,
    snippet: makeSnippet(all, q, idx < 0 ? 0 : idx)
  }
}

/** 截取命中文本附近的一段可读摘要，压缩换行为单行 */
function makeSnippet(text: string, q: string, idx: number, radius = 50): string {
  const start = Math.max(0, idx - radius)
  const end = Math.min(text.length, idx + q.length + radius)
  let s = text.slice(start, end).replace(/\s+/g, ' ').trim()
  if (start > 0) s = `…${s}`
  if (end < text.length) s = `${s}…`
  return s.slice(0, 200)
}