import { join } from 'path'
import { runCommand } from './process'
import { ytDlpPath } from './bin'

const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/

export async function fetchVideoTitle(url: string): Promise<string> {
  const res = await runCommand(ytDlpPath(), [
    '--skip-download',
    '--no-playlist',
    '--encoding',
    'utf-8',
    '--print',
    '%(title)s',
    url
  ])
  const title = res.stdout.trim().split(/\r?\n/).pop() ?? ''
  return title || 'B站视频'
}

export async function downloadAudio(url: string, workDir: string, onProgress: (pct: number) => void): Promise<string> {
  const res = await runCommand(
    ytDlpPath(),
    [
      '-f',
      'bestaudio/best',
      '--no-playlist',
      '--encoding',
      'utf-8',
      '--newline',
      '--progress',
      '-o',
      join(workDir, 'media.%(ext)s'),
      url
    ],
    {
      onStdout: (line) => {
        const m = PROGRESS_RE.exec(line)
        if (m) onProgress(Math.min(parseFloat(m[1]), 99.9))
      }
    }
  )
  const match = res.stdout.match(/Destination:\s+(.+?)\r?$|has already been downloaded/m)
  const dest = match ? match[1].trim() : ''
  if (dest) return dest
  return join(workDir, 'media.m4a')
}
