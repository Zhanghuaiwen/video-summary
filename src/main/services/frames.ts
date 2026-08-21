import { mkdirSync, readdirSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { runCommand } from './process'

export interface ExtractedFrame {
  /** 视频时间点（秒，近似） */
  time: number
  /** 相对项目工作目录的路径，如 frames/fixed_0001.jpg */
  path: string
}

const SHOWINFO_RE = /pts_time:(\d+(?:\.\d+)?)/

function parseShowInfoTimes(stderr: string, fallback: number[]): number[] {
  const times: number[] = []
  for (const line of stderr.split(/\r?\n/)) {
    const m = SHOWINFO_RE.exec(line)
    if (m) {
      const t = parseFloat(m[1])
      if (Number.isFinite(t) && t >= 0) times.push(t)
    }
  }
  if (times.length > 0) return times
  return fallback
}

/**
 * 固定间隔采样：逐时间点 -ss 精确抽帧。
 * 旧实现用 fps=1/interval 滤镜一次性输出，在部分视频上会静默产出 0 帧（整片只剩场景帧）；
 * 逐点抽取单点失败可跳过，连续两次取不到帧视为越过片尾提前结束。
 */
async function sampleFixed(
  input: string,
  outDir: string,
  interval: number,
  maxFrames: number
): Promise<[number, string][]> {
  const out: [number, string][] = []
  let miss = 0
  for (let i = 0; i < maxFrames; i++) {
    const t = i * interval
    const name = `fixed_${String(i).padStart(4, '0')}.jpg`
    const target = join(outDir, name)
    try {
      await runCommand(
        ffmpegPath,
        ['-hide_banner', '-ss', String(t), '-i', input, '-frames:v', '1', '-q:v', '3', '-y', target],
        {},
        { allowNonZero: true }
      )
      if (!existsSync(target)) throw new Error('未产出帧文件')
      out.push([t, `frames/${name}`])
      miss = 0
    } catch {
      miss++
      if (miss >= 2) break
    }
  }
  return out
}

/**
 * 场景变化帧：在目标时间 ±1/60s 邻域内取样。
 * 使用 between 窗口取第一个命中帧，配合 vfr 每窗口至多输出 1~2 帧。
 */
async function sampleScene(input: string, outDir: string, times: number[]): Promise<[number, string][]> {
  if (times.length === 0) return []
  const expr = times.map((t) => `between(t,${t - 0.016},${t + 0.016})`).join('+')
  const pattern = join(outDir, 'scene_%04d.jpg')
  const res = await runCommand(
    ffmpegPath,
    [
      '-hide_banner',
      '-i',
      input,
      '-vf',
      `select='${expr}',scale=480:-2,showinfo`,
      '-vsync',
      'vfr',
      '-q:v',
      '3',
      '-y',
      pattern
    ],
    {},
    { allowNonZero: true }
  )
  const files = readdirSync(outDir)
    .filter((f) => f.startsWith('scene_') && f.endsWith('.jpg'))
    .sort()
  const fallback = times.slice(0, files.length)
  const parsed = parseShowInfoTimes(res.stderr, fallback)
  return files.map((f, i) => [parsed[i] ?? fallback[i], `frames/${f}`] as [number, string])
}

/**
 * 场景变化检测：select gt(scene,threshold) + showinfo 得到场景切换帧的时间点。
 */
export async function detectSceneTimes(input: string, threshold: number, max = 240): Promise<number[]> {
  const res = await runCommand(
    ffmpegPath,
    [
      '-hide_banner',
      '-i',
      input,
      '-vf',
      `select='gt(scene,${threshold})',showinfo`,
      '-f',
      'null',
      '-'
    ],
    {},
    { allowNonZero: true }
  )
  const times: number[] = []
  for (const line of res.stderr.split(/\r?\n/)) {
    const m = SHOWINFO_RE.exec(line)
    if (m) {
      const t = parseFloat(m[1])
      if (Number.isFinite(t) && t > 0.5) times.push(t)
    }
  }
  if (times.length <= max) return times
  // 帧过多则抽样控制（保留顺序，均匀抽取）
  const step = times.length / max
  const out: number[] = []
  for (let i = 0; i < max; i++) out.push(times[Math.floor(i * step)])
  return out
}

function mergeDedupe(items: [number, string][]): ExtractedFrame[] {
  const sorted = items
    .filter(([t]) => Number.isFinite(t) && t >= 0)
    .sort((a, b) => a[0] - b[0])
  const out: [number, string][] = []
  for (const [t, p] of sorted) {
    const last = out[out.length - 1]
    if (!last || t - last[0] >= 0.5) out.push([t, p])
  }
  return out.map(([time, path]) => ({ time, path }))
}

/** 超出上限时均匀抽样缩减（保留顺序），严格控制用于视觉分析/OCR 的帧数量 */
function capFrames(frames: ExtractedFrame[], max: number): ExtractedFrame[] {
  if (frames.length <= max) return frames
  const out: ExtractedFrame[] = []
  for (let i = 0; i < max; i++) out.push(frames[Math.floor((i * frames.length) / max)])
  return out
}

/**
 * 关键帧提取主入口：固定采样 + 场景变化检测，合并去重。
 * 任何单点失败都会优雅降级为空列表（调用方可跳过视觉阶段）。
 */
export async function extractKeyFrames(
  input: string,
  workDir: string,
  opts: { interval?: number; sceneThreshold?: number; maxKeyFrames?: number } = {}
): Promise<ExtractedFrame[]> {
  const interval = opts.interval ?? 60
  const threshold = opts.sceneThreshold ?? 0.3
  const maxKeyFrames = Math.max(4, Math.min(240, opts.maxKeyFrames ?? 30))
  const outDir = join(workDir, 'frames')
  mkdirSync(outDir, { recursive: true })

  const results: [number, string][] = []

  const sceneTask = detectSceneTimes(input, threshold).catch(() => [])
  const fixedTask = sampleFixed(input, outDir, interval, maxKeyFrames).catch(() => [])

  const [sceneTimes, fixed] = await Promise.all([sceneTask, fixedTask])
  results.push(...fixed)
  if (sceneTimes.length > 0) {
    const scene = await sampleScene(input, outDir, sceneTimes).catch(() => [])
    results.push(...scene)
  }

  return capFrames(mergeDedupe(results), maxKeyFrames)
}

export async function clearFramesDir(workDir: string): Promise<void> {
  const outDir = join(workDir, 'frames')
  mkdirSync(outDir, { recursive: true })
  for (const f of readdirSync(outDir)) {
    if (f.endsWith('.jpg')) {
      try {
        unlinkSync(join(outDir, f))
      } catch {
        // 忽略清理失败
      }
    }
  }
}