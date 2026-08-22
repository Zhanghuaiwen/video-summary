import type { KeyFrameInfo, TimelineSegment } from '@shared/types'

export interface TranscriptBlock {
  text: string
  /** 该段起始时间（秒） */
  startTime: number
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`
}

export function blocksToText(blocks: TranscriptBlock[]): string {
  return blocks.map((b) => b.text).join('\n')
}

/**
 * 把 ASR 分段与关键帧对齐到时间轴：Transcript + Frames 不再是两个独立数据。
 * endTime 优先取「下一段的起点」——段的边界时间才是精确已知的，
 * 这样即使混用不同粒度的分段（旧断点 300s / 新分段 60s）也不会出现空洞或覆盖；
 * 最后一段用 segmentSeconds 兜底。mediaDuration 存在时整体钳制到实际媒体时长
 * （避免短视频出现「start+10min」的虚假结尾，例如 40s 视频结束时间被算成 10:00）。
 */
export function buildTimeline(
  blocks: TranscriptBlock[],
  frames: KeyFrameInfo[],
  segmentSeconds: number,
  mediaDuration?: number
): TimelineSegment[] {
  return blocks.map((b, i) => {
    const startTime = Math.max(0, b.startTime)
    const next = blocks[i + 1]
    let endTime =
      next && next.startTime > startTime ? next.startTime : startTime + segmentSeconds
    if (mediaDuration !== undefined && mediaDuration > 0) {
      endTime = Math.min(endTime, mediaDuration)
    }
    if (endTime <= startTime) endTime = startTime + Math.min(segmentSeconds, 1)
    const frameTimes = frames.filter((f) => f.time >= startTime && f.time < endTime).map((f) => f.time)
    return { startTime, endTime, transcript: b.text, frameTimes }
  })
}

/**
 * 生成带时间戳的文字稿，供思维导图生成等下游使用。
 */
export function transcriptWithTimes(segments: TimelineSegment[]): string {
  return segments
    .map((s) => `[${fmtTime(s.startTime)} - ${fmtTime(s.endTime)}]\n${s.transcript}`)
    .join('\n\n')
}

export function makeTranscriptByTime(segments: TimelineSegment[]): (time: number) => string {
  return (time: number): string => {
    const seg = segments.find((s) => time >= s.startTime && time < s.endTime)
    return seg?.transcript ?? ''
  }
}

const SENTENCE_ENDS = new Set(['。', '！', '？', '!', '?', '；', ';', '\n'])

function splitSentences(text: string): string[] {
  const out: string[] = []
  let buf = ''
  for (const ch of text) {
    buf += ch
    if (SENTENCE_ENDS.has(ch)) {
      const t = buf.trim()
      if (t) out.push(t)
      buf = ''
    }
  }
  const rest = buf.trim()
  if (rest) out.push(rest)
  return out
}

function joinSentences(a: string, b: string): string {
  const needSpace = /[A-Za-z0-9,;:]$/.test(a) && /^[A-Za-z0-9(]/.test(b)
  return needSpace ? `${a} ${b}` : a + b
}

/** 把句子按顺序打包成 ≤maxChars 的块（单句超长时独立成块） */
function packSentences(sentences: string[], maxChars: number): string[] {
  const out: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (!buf) {
      buf = s.length > maxChars * 1.5 ? (out.push(s), '') : s
      continue
    }
    if (buf.length + s.length + 1 > maxChars) {
      out.push(buf)
      buf = s.length > maxChars * 1.5 ? (out.push(s), '') : s
      continue
    }
    buf = joinSentences(buf, s)
  }
  if (buf.trim()) out.push(buf)
  return out.filter(Boolean)
}

/**
 * 把粗粒度时间轴（如每 5~10 分钟一个 ASR 大段）细化为句子级小块：
 * 在段内按字符占比线性分配起止时间，让下游 LLM 能把任意主题定位到较准的时间点。
 * 这是「导图节点时间全是视频结尾」问题的关键修复——大段文本被截断后模型无从定位。
 */
export function refineSegments(segments: TimelineSegment[], blockChars = 240): TimelineSegment[] {
  const out: TimelineSegment[] = []
  for (const seg of segments) {
    const dur = seg.endTime - seg.startTime
    const parts = packSentences(splitSentences(seg.transcript), blockChars)
    if (parts.length <= 1 || !(dur > 0)) {
      out.push(seg)
      continue
    }
    const total = parts.reduce((n, p) => n + p.length, 0) || 1
    const beginIdx = out.length
    let cursor = seg.startTime
    for (const p of parts) {
      const start = cursor
      const end = Math.min(seg.endTime, cursor + (p.length / total) * dur)
      out.push({ startTime: start, endTime: end, transcript: p, frameTimes: [] })
      cursor = end
    }
    // 父段关键帧时间归入覆盖它的子段，避免细化后丢失画面锚点
    for (const ft of seg.frameTimes ?? []) {
      const hit = out.slice(beginIdx).find((s) => ft >= s.startTime && ft < s.endTime)
      if (hit) hit.frameTimes.push(ft)
    }
  }
  return out
}

/**
 * 生成供 LLM 使用的带时间文字稿：先细化为句子级小块再控制总长度。
 * 相比旧的「按大段截断」，模型能看到覆盖全片的时间标签，节点时间不再塌缩到片尾。
 *
 * 超出 maxTotalChars 时做【全片均匀抽样】而不是从头部截断：
 * 头部截断会让长视频后半段完全没有时间标签，LLM 只能把后半段内容的时间
 * 瞎猜到已有标签的范围内；均匀抽稀保证首尾与中间各时段都有精确锚点。
 */
export function buildTimedTranscript(segments: TimelineSegment[], maxTotalChars = 16000, blockChars = 240): string {
  const refined = refineSegments(segments, blockChars)
  const entries = refined.map((s) => ({
    seg: s,
    line: `[${fmtTime(s.startTime)} - ${fmtTime(s.endTime)}]\n${s.transcript}`
  }))
  if (entries.length === 0) return ''

  const totalChars = entries.reduce((n, e) => n + e.line.length + 2, 0)
  let kept = entries
  if (totalChars > maxTotalChars && entries.length > 2) {
    const avgLen = totalChars / entries.length
    const keepCount = Math.max(2, Math.floor((maxTotalChars / (avgLen + 2)) * 0.95))
    // 等距抽稀：保留首尾块，中间按比例取样，时间顺序不变
    const picked = new Set<number>()
    for (let i = 0; i < keepCount; i++) {
      picked.add(Math.min(entries.length - 1, Math.round((i * (entries.length - 1)) / Math.max(1, keepCount - 1))))
    }
    kept = entries.filter((_, i) => picked.has(i))
  }
  return kept.map((e) => e.line).join('\n\n')
}