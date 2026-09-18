import type { FrameRef, KeyFrameInfo, MindMapNode, SummaryDoc } from '@shared/types'
import { walk } from '@shared/mindmap-util'

/** 每个总结章节最多配几张帧 */
export const MAX_CHAPTER_FRAMES = 3
/** 每个导图节点最多配几张帧 */
export const MAX_NODE_FRAMES = 1
/** 节点时间窗匹配的容差（秒） */
const NODE_TIME_TOLERANCE = 6
/** LLM 引用路径未命中时、按时间就近修正的最大偏差（秒） */
const REF_TIME_TOLERANCE = 5

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf]/

function cjkBigrams(text: string): Set<string> {
  const chars = [...text.toLowerCase()]
  const out = new Set<string>()
  for (let i = 0; i < chars.length - 1; i++) {
    if (CJK_RE.test(chars[i]) && CJK_RE.test(chars[i + 1])) out.add(chars[i] + chars[i + 1])
  }
  return out
}

function asciiTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])
}

interface PoolEntry {
  frame: KeyFrameInfo
  /** OCR 文字（对总结最有用的强信号，如 PPT/代码/屏幕文字） */
  ocrGrams: Set<string>
  /** 画面描述 + 与语音关联说明（弱信号：多为场景描写） */
  descGrams: Set<string>
}

function buildEntry(frame: KeyFrameInfo): PoolEntry {
  const ocr = (frame.ocr ?? '').toLowerCase()
  const desc = `${frame.visual ?? ''} ${frame.relation ?? ''}`.toLowerCase()
  return {
    frame,
    ocrGrams: cjkBigrams(ocr),
    descGrams: new Set([...cjkBigrams(desc), ...asciiTokens(`${ocr} ${desc}`)])
  }
}

function refFrom(f: KeyFrameInfo): FrameRef {
  return { time: f.time, path: f.path, ocr: f.ocr, visual: f.visual }
}

/** 章节/节点关键字 → 帧的匹配得分：OCR 命中加权，画面描述仅作弱佐证 */
function scoreAgainst(grams: Set<string>, e: PoolEntry): number {
  let ocrHit = 0
  for (const g of grams) if (e.ocrGrams.has(g)) ocrHit++
  if (ocrHit >= 1) return 10 + ocrHit
  let descHit = 0
  for (const g of grams) if (e.descGrams.has(g)) descHit++
  return descHit >= 2 ? descHit : 0
}

/**
 * 把 LLM 输出的帧引用做可靠性修正：
 * - 路径在真实帧清单内：原样使用；
 * - 路径是幻觉/旧命名：按时间就近找真实帧修正（偏差过大则丢弃）。
 */
function resolveRef(f: FrameRef, pool: PoolEntry[], poolByPath: Map<string, PoolEntry>): PoolEntry | null {
  const exact = poolByPath.get(f.path)
  if (exact) return exact
  let nearest: PoolEntry | null = null
  let best = Infinity
  for (const e of pool) {
    const d = Math.abs(e.frame.time - f.time)
    if (d < best) {
      best = d
      nearest = e
    }
  }
  return nearest && best <= REF_TIME_TOLERANCE ? nearest : null
}

/**
 * 把真实关键帧可靠地配到总结章节上：
 * 1) 校验/修正 LLM 已有的 chapter.frames（幻觉路径按时间就近纠正）；
 * 2) 不足上限时，用「章节文字 ↔ 帧 OCR/描述」的中文二元组匹配自动补齐。
 * 全局去重：同一张帧不会出现在多个章节。
 * 返回本次实际新增/修正的帧引用数。
 */
export function attachChapterFrames(summary: SummaryDoc, frames: KeyFrameInfo[]): number {
  if (!frames.length || !summary.chapters.length) return 0
  const pool = frames.map(buildEntry)
  const poolByPath = new Map(pool.map((e) => [e.frame.path, e]))
  const used = new Set<string>()
  let attached = 0

  // 第一轮：校验 LLM 已有的引用（先于回填，保序但逐章节分配，先到先得）
  for (const ch of summary.chapters) {
    if (!ch.frames?.length) continue
    const resolved: FrameRef[] = []
    for (const f of ch.frames) {
      if (resolved.length >= MAX_CHAPTER_FRAMES) break
      const e = resolveRef(f, pool, poolByPath)
      if (!e || used.has(e.frame.path)) continue
      used.add(e.frame.path)
      resolved.push(refFrom(e.frame))
      if (refChanged(f, e.frame)) attached++
    }
    ch.frames = resolved
  }

  // 第二轮：未配满的章节按文字相似度补齐
  for (const ch of summary.chapters) {
    if ((ch.frames?.length ?? 0) >= MAX_CHAPTER_FRAMES) continue
    const grams = chapterGrams(ch)
    const candidates = pool
      .filter((e) => !used.has(e.frame.path))
      .map((e) => ({ e, score: scoreAgainst(grams, e) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.e.frame.time - b.e.frame.time)
    const toAdd = MAX_CHAPTER_FRAMES - (ch.frames?.length ?? 0)
    for (const c of candidates.slice(0, toAdd)) {
      used.add(c.e.frame.path)
      ch.frames = ch.frames ?? []
      ch.frames.push(refFrom(c.e.frame))
      attached++
    }
  }
  return attached
}

function refChanged(f: FrameRef, real: KeyFrameInfo): boolean {
  return f.path !== real.path || f.time !== real.time
}

function chapterGrams(ch: { title: string; summary?: string; points?: { text: string; subPoints?: string[] }[] }): Set<string> {
  const parts = [ch.title, ch.summary ?? '']
  for (const p of ch.points ?? []) {
    parts.push(p.text, ...(p.subPoints ?? []))
  }
  const t = parts.filter(Boolean).join(' ')
  return new Set(
    t.length > 400
      ? [...cjkBigrams(t.slice(0, 400)), ...asciiTokens(t.slice(0, 400))]
      : [...cjkBigrams(t), ...asciiTokens(t)]
  )
}

/**
 * 把真实关键帧可靠地配到导图节点上：
 * - 节点带 timeRange：优先取落在其视频时间窗内的帧（直接命中，无需 OCR）；
 * - 否则用「节点标题/摘要/内容/关键词 ↔ 帧」文字匹配。
 * 全局去重。返回新增帧引用数。
 */
export function attachNodeFrames(root: MindMapNode, frames: KeyFrameInfo[]): number {
  if (!frames.length) return 0
  const pool = frames.map(buildEntry)
  const used = new Set<string>()
  let attached = 0
  walk(root, (node) => {
    if (node.frames?.length) {
      // 已有引用（如导入的导图）先清空，统一按当前帧清单重新匹配
      delete node.frames
    }
    if (node.timeRange) {
      const inWindow = pool.filter(
        (e) =>
          !used.has(e.frame.path) &&
          e.frame.time >= node.timeRange!.start - NODE_TIME_TOLERANCE &&
          e.frame.time <= node.timeRange!.end + NODE_TIME_TOLERANCE
      )
      if (inWindow.length > 0) {
        inWindow
          .sort((a, b) => a.frame.time - b.frame.time)
          .slice(0, MAX_NODE_FRAMES)
          .forEach((e) => {
            used.add(e.frame.path)
            node.frames = node.frames ?? []
            node.frames.push(refFrom(e.frame))
            attached++
          })
        return
      }
    }
    const grams = nodeGrams(node)
    const candidates = pool
      .filter((e) => !used.has(e.frame.path))
      .map((e) => ({ e, score: scoreAgainst(grams, e) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || a.e.frame.time - b.e.frame.time)
    for (const c of candidates.slice(0, MAX_NODE_FRAMES)) {
      used.add(c.e.frame.path)
      node.frames = node.frames ?? []
      node.frames.push(refFrom(c.e.frame))
      attached++
    }
  })
  return attached
}

function nodeGrams(node: MindMapNode): Set<string> {
  const parts = [node.title, node.summary ?? '', node.content ?? '', ...(node.keywords ?? [])]
  return new Set([...cjkBigrams(parts.filter(Boolean).join(' ')), ...asciiTokens(parts.filter(Boolean).join(' '))])
}