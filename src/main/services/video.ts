import { join } from 'path'
import { existsSync } from 'fs'
import ffmpegPath from 'ffmpeg-static'
import { runCommand } from './process'
import { ytDlpPath } from './bin'

const PROGRESS_RE = /\[download\]\s+(\d+(?:\.\d+)?)%/

const DURATION_RE = /Duration:\s*(\d+):(\d+):(\d+\.?\d*)/

/**
 * 用 ffmpeg 只读打开媒体文件，从输入头信息解析容器总时长（秒）。
 * 不做任何转码/解码，很快；解析失败返回 undefined（调用方回退）。
 */
export async function probeMediaDuration(input: string): Promise<number | undefined> {
  try {
    const res = await runCommand(
      ffmpegPath,
      ['-hide_banner', '-i', input],
      {},
      { allowNonZero: true }
    )
    const m = DURATION_RE.exec(res.stderr)
    if (!m) return undefined
    const h = Number(m[1])
    const min = Number(m[2])
    const s = Number(m[3])
    if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(s)) return undefined
    return h * 3600 + min * 60 + s
  } catch {
    return undefined
  }
}

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

export async function downloadMedia(url: string, workDir: string, onProgress: (pct: number) => void): Promise<string> {
  const res = await runCommand(
    ytDlpPath(),
    [
      // 下载音视频合并为 mp4：既要能转写音频，也要能播放画面。
      // 优先选 H.264(AVC1)+AAC 的 mp4（Chromium/系统播放器兼容性最好）；
      // 若无 AVC 视频，退而求其次选任意 mp4 视频 + m4a 音频合并；再不行选最佳音视频合并；
      // 最后兜底选整体最佳格式。B 站 1080P60/4K 等高级画质需大会员，yt-dlp 会自动选择可下载的最高清晰度。
      '-f',
      'bestvideo[vcodec^=avc1][ext=mp4]+bestaudio[ext=m4a]/bestvideo[ext=mp4]+bestaudio[ext=m4a]/bestvideo+bestaudio/best',
      '--merge-output-format',
      'mp4',
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
  // 下载结束后的成品文件解析：
  // - 多格式下载会先产生 media.f30077.mp4 / media.f30280.m4a 等部分文件，合并后再删掉它们，
  //   此时输出为 media.mp4（--merge-output-format mp4）；
  // - 未发生合并（如仅音频回退）时，最后一条 Destination 指向的就是成品；
  // 因此不能沿用“第一条 Destination”，否则会拿到已被删除的部分文件。
  const merged = join(workDir, 'media.mp4')
  if (existsSync(merged)) return merged
  const dests = [...res.stdout.matchAll(/\[download\] Destination:\s+(.+)/g)].map((m) => m[1].trim())
  const last = dests[dests.length - 1]
  if (last && existsSync(last)) return last
  return merged
}
