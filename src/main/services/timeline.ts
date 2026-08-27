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
  mediaDuration?: number,
  silenceTimes: number[] = []
): TimelineSegment[] {
  const coarse = blocks.map((b, i) => {
    const startTime = Math.max(0, b.startTime)
    const next = blocks[i + 1]
    let endTime =
      next && next.startTime > startTime ? next.startTime : startTime + segmentSeconds
    if (mediaDuration !== undefined && mediaDuration > 0) {
      endTime = Math.min(endTime, mediaDuration)
    }
    // 强制补齐到至少 1 秒时仍不可超过媒体时长；若 start 已 >= mediaDuration
    // 则该段无意义（钳制后 endTime 仍 <= startTime），后续统一过滤丢弃
    if (endTime <= startTime) {
      endTime =
        mediaDuration !== undefined && mediaDuration > 0
          ? Math.min(startTime + Math.min(segmentSeconds, 1), mediaDuration)
          : startTime + Math.min(segmentSeconds, 1)
    }
    const frameTimes = frames.filter((f) => f.time >= startTime && f.time < endTime).map((f) => f.time)
    return { startTime, endTime, transcript: b.text, frameTimes }
  }).filter((s) => s.endTime > s.startTime)
  // 用真实停顿边界把粗段细化为句子级时间块（无停顿时回退到字符插值）
  return refineSegments(coarse, 240, silenceTimes)
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
  // segments 时间连续有序，用二分把 O(n) 降到 O(log n)，
  // 避免拖动进度条时每次 mousemove 都线性扫描上千个 segment
  return (time: number): string => {
    let lo = 0
    let hi = segments.length - 1
    let idx = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const s = segments[mid]
      if (time < s.startTime) hi = mid - 1
      else if (time >= s.endTime) lo = mid + 1
      else {
        idx = mid
        break
      }
    }
    return idx >= 0 ? segments[idx].transcript : ''
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
    // 直接用 joinSentences 的实际结果判断长度，而不是凭空 +1
    const merged = joinSentences(buf, s)
    if (merged.length > maxChars) {
      out.push(buf)
      buf = s.length > maxChars * 1.5 ? (out.push(s), '') : s
    } else {
      buf = merged
    }
  }
  if (buf.trim()) out.push(buf)
  return out.filter(Boolean)
}

/**
 * 把粗粒度时间轴（如每 5~10 分钟一个 ASR 大段）细化为句子级小块：
 * 优先使用真实停顿时间（silenceTimes，来自 ffmpeg silencedetect）作为句子边界——
 * 每句边界直接吸附到最近的真实停顿，而非仅在停顿骨架上做比例插值。
 * 无停顿点（如连续念稿无停顿）时回退到段内按字符占比线性分配。
 */
export function refineSegments(
  segments: TimelineSegment[],
  blockChars = 240,
  silenceTimes: number[] = []
): TimelineSegment[] {
  const out: TimelineSegment[] = []
  for (const seg of segments) {
    const dur = seg.endTime - seg.startTime
    const parts = packSentences(splitSentences(seg.transcript), blockChars)
    if (parts.length <= 1 || !(dur > 0)) {
      out.push(seg)
      continue
    }

    // 取落入本段的真实停顿点，作为句子边界的吸附锚点
    const silInSeg = silenceTimes
      .filter((t) => t > seg.startTime + 0.2 && t < seg.endTime - 0.2)
      .sort((a, b) => a - b)

    // 计算每句起止：有停顿时吸附到最近停顿，否则按字符占比线性分配
    const times = snapBoundaries(parts, silInSeg, seg.startTime, seg.endTime)
    const beginIdx = out.length
    for (let j = 0; j < parts.length; j++) {
      out.push({
        startTime: times[j],
        endTime: times[j + 1],
        transcript: parts[j],
        frameTimes: []
      })
    }

    // 父段关键帧时间归入覆盖它的子段，避免细化后丢失画面锚点。
    // 子段与 frameTimes 均有序，用双指针把 O(segments·frames) 降到 O(segments+frames)
    let fi = beginIdx
    for (const ft of seg.frameTimes ?? []) {
      while (fi < out.length && ft >= out[fi].endTime) fi++
      if (fi < out.length && ft >= out[fi].startTime && ft < out[fi].endTime) {
        out[fi].frameTimes.push(ft)
      }
    }
  }
  return out
}

/**
 * 计算 k 个句子块在 [start,end] 内的边界时间点（长度 k+1）。
 * 以字符数作为说话时长的代理，算出每句结束的比例位置，
 * 若段内存在真实停顿则把边界吸附到「比例上最近」的那个停顿（差值 <= 0.5），
 * 否则保持线性比例。最后做一次单调修复，保证时间严格递增。
 */
function snapBoundaries(
  parts: string[],
  silInSeg: number[],
  start: number,
  end: number
): number[] {
  const k = parts.length
  const times: number[] = new Array(k + 1)
  times[0] = start
  times[k] = end
  const dur = end - start

  const silFrac = silInSeg.map((s) => (s - start) / dur)
  const total = parts.reduce((n, p) => n + p.length, 0) || 1
  let cum = 0
  for (let j = 1; j < k; j++) {
    cum += parts[j - 1].length
    const frac = cum / total
    let t = start + frac * dur
    if (silFrac.length > 0) {
      let best = -1
      let bestD = Infinity
      for (const g of silFrac) {
        const d = Math.abs(g - frac)
        if (d < bestD) {
          bestD = d
          best = g
        }
      }
      // 仅在停顿比例位置足够接近时吸附，避免边界被拉到不相关的远处停顿
      if (bestD <= 0.5) t = start + best * dur
    }
    times[j] = t
  }

  // 吸附可能导致相邻边界非严格递增，用相邻值中点修复，终点强制为 end
  for (let j = 1; j <= k; j++) {
    if (times[j] <= times[j - 1]) {
      const lo = times[j - 1]
      const hi = j < k ? times[j + 1] : end
      times[j] = j < k ? (lo + hi) / 2 : end
    }
  }
  times[k] = end
  return times
}

/**
 * 生成供 LLM 使用的带时间文字稿：先细化为句子级小块再控制总长度。
 * 相比旧的「按大段截断」，模型能看到覆盖全片的时间标签，节点时间不再塌缩到片尾。
 *
 * 超出 maxTotalChars 时做【全片均匀抽样】而不是从头部截断：
 * 头部截断会让长视频后半段完全没有时间标签，LLM 只能把后半段内容的时间
 * 瞎猜到已有标签的范围内；均匀抽稀保证首尾与中间各时段都有精确锚点。
 */
export function buildTimedTranscript(segments: TimelineSegment[], maxTotalChars = 16000): string {
  // 入参已是 buildTimeline 细化后的「唯一时间轴」(Single Source of Truth)，
  // 这里绝不能再次 refineSegments，否则会丢掉 silence 对齐并产生与 UI 不一致的
  // 第二套时间。直接消费同一份 segments。
  const entries = segments.map((s) => ({
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