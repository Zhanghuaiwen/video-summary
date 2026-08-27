import { mkdirSync, readdirSync } from 'fs'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { runCommand } from './process'

// 单段音频时长：60s。每段的起点时间是 ASR 唯一精确已知的时间锚点，
// 分段越细，时间轴的天然精度越高（句子级插值只需在 60s 内微调，
// 而不是在 5 分钟大段里线性估算）。配合转写并发（3 路）控制总耗时。
export const SEGMENT_SECONDS = 60

export async function extractAudio(input: string, outDir: string): Promise<string> {
  mkdirSync(outDir, { recursive: true })
  const full = join(outDir, 'full.mp3')
  await runCommand(ffmpegPath, [
    '-y',
    '-i',
    input,
    '-vn',
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '64k',
    full
  ])
  return full
}

export async function splitAudio(fullMp3: string, segDir: string): Promise<string[]> {
  mkdirSync(segDir, { recursive: true })
  const pattern = join(segDir, 'seg_%03d.mp3')
  await runCommand(ffmpegPath, [
    '-y',
    '-i',
    fullMp3,
    '-f',
    'segment',
    '-segment_time',
    String(SEGMENT_SECONDS),
    '-c',
    'copy',
    pattern
  ])
  return readdirSync(segDir)
    .filter((f) => f.endsWith('.mp3'))
    .sort()
    .map((f) => join(segDir, f))
}

export async function prepareAudioSegments(input: string, workDir: string): Promise<string[]> {
  const full = await extractAudio(input, join(workDir, 'audio'))
  return splitAudio(full, join(workDir, 'seg'))
}

const SILENCE_RE = /silence_start:\s*(\d+(?:\.\d+)?)/g

/**
 * 在整段音频上用 ffmpeg silencedetect 检测停顿点，返回每个「停顿开始」的绝对时间（秒，升序）。
 * 说话自然停顿处即句子/意群边界，可作为句子级时间戳的真实锚点（无需任何额外模型）。
 * 失败或无可检测停顿时返回空数组，调用方回退到字符占比插值。
 */
export async function detectSilences(fullMp3: string, noise = -40, minDur = 0.35): Promise<number[]> {
  try {
    const res = await runCommand(
      ffmpegPath,
      [
        '-hide_banner',
        '-i',
        fullMp3,
        '-af',
        `silencedetect=noise=${noise}dB:d=${minDur}`,
        '-f',
        'null',
        '-'
      ],
      {},
      { allowNonZero: true }
    )
    const out: number[] = []
    for (const m of res.stderr.matchAll(SILENCE_RE)) {
      const t = parseFloat(m[1])
      if (Number.isFinite(t) && t > 0) out.push(t)
    }
    return out.sort((a, b) => a - b)
  } catch {
    return []
  }
}
