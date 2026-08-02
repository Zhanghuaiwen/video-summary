import { mkdirSync, readdirSync, existsSync } from 'fs'
import { join } from 'path'
import ffmpegPath from 'ffmpeg-static'
import { runCommand } from './process'

const SEGMENT_SECONDS = 600

export function ffmpeg(): string {
  return ffmpegPath
}

export async function extractAudio(input: string, outDir: string): Promise<string> {
  mkdirSync(outDir, { recursive: true })
  const full = join(outDir, 'full.mp3')
  await runCommand(ffmpeg(), [
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
  await runCommand(ffmpeg(), ['-y', '-i', fullMp3, '-f', 'segment', '-segment_time', String(SEGMENT_SECONDS), '-c', 'copy', pattern])
  if (!existsSync(segDir)) return []
  return readdirSync(segDir)
    .filter((f) => f.endsWith('.mp3'))
    .sort()
    .map((f) => join(segDir, f))
}

export async function prepareAudioSegments(input: string, workDir: string): Promise<string[]> {
  const full = await extractAudio(input, join(workDir, 'audio'))
  return splitAudio(full, join(workDir, 'seg'))
}
