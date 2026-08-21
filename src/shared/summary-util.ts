import type { Chapter, ChapterPoint, SummaryDoc } from './types'

/** 把旧的纯字符串要点（或新对象结构）统一成 ChapterPoint */
export function normalizeChapterPoints(points: unknown): ChapterPoint[] {
  if (!Array.isArray(points)) return []
  const out: ChapterPoint[] = []
  for (const p of points) {
    if (typeof p === 'string' && p.trim()) {
      out.push({ text: p.trim() })
    } else if (p && typeof p === 'object') {
      const o = p as Record<string, unknown>
      const text = typeof o['text'] === 'string' ? o['text'].trim() : ''
      if (!text) continue
      const subPoints = Array.isArray(o['subPoints'])
        ? (o['subPoints'] as unknown[]).filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
        : undefined
      out.push({ text, subPoints: subPoints && subPoints.length ? subPoints.slice(0, 6) : undefined })
    }
  }
  return out
}

/** 兼容旧版 summary.json（纯字符串要点 / 缺 takeaways） */
export function normalizeSummaryDoc(doc: SummaryDoc): SummaryDoc {
  return {
    ...doc,
    takeaways: Array.isArray(doc.takeaways)
      ? doc.takeaways.filter((t): t is string => typeof t === 'string' && t.trim().length > 0)
      : [],
    chapters: doc.chapters.map((c) => ({
      ...c,
      points: normalizeChapterPoints(c.points)
    }))
  }
}

export function toPlainPoints(chapter: Chapter): string[] {
  return chapter.points.map((p) => p.text)
}