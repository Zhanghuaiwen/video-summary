import { join, dirname, extname } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
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

const VIDEO_EXTS = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v'])

/**
 * 在项目工作目录里寻找一份「完整可用」的视频文件（B 站 DASH 下载的合并产物或视频部分文件）。
 * - 优先 media.mp4（yt-dlp 合并产物）；
 * - 否则在 media.* 系列文件里找最完整的视频流部分（media.f30077.mp4 / media.f30080.mp4 等），跳过 .part 半成品与纯音频 m4a。
 * 找不到返回 null。
 */
export function findBestVideoInDir(dir: string): string | null {
  let files: string[]
  try {
    files = readdirSync(dir)
  } catch {
    return null
  }
  let best: string | null = null
  let bestScore = 0
  for (const f of files) {
    if (!/^media\./.test(f) || f.endsWith('.part')) continue
    const m = /\.[a-z0-9]+$/i.exec(f)
    if (!m || !VIDEO_EXTS.has(m[0].slice(1).toLowerCase())) continue
    let size = 0
    try {
      size = statSync(join(dir, f)).size
    } catch {
      continue
    }
    if (size <= 0) continue
    const mergedBonus = f === 'media.mp4' ? 1 : 0
    const score = size + mergedBonus
    if (score > bestScore) {
      bestScore = score
      best = f
    }
  }
  return best ? join(dir, best) : null
}

/** 判断媒体路径指向的是否为纯音频文件（m4a/mp3/...） */
export function isAudioMediaPath(p: string): boolean {
  const ext = extname(p).slice(1).toLowerCase()
  return ext === 'm4a' || ext === 'mp3' || ext === 'aac' || ext === 'wav' || ext === 'flac' || ext === 'ogg'
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
      // yt-dlp 合并音视频需要 ffmpeg；系统 PATH 里通常没有，
      // 必须显式指向本项目内置的 ffmpeg-static，否则合并失败只剩部分文件
      '--ffmpeg-location',
      dirname(ffmpegPath),
      // B 站 DASH CDN 会按长连接限速（1080p 被压到 ~80KiB/s 并频繁断流）。
      // 按 10MB 分块用 Range 请求逐块下，每个块都是新请求，绕过限速；实测提速约 40 倍。
      '--http-chunk-size',
      '10485760',
      // B 站网络抖动频繁：拉高网页/下载/断点重试次数，避免偶发 "Unable to download webpage" 直接失败
      '--retries',
      '30',
      '--fragment-retries',
      '30',
      '--retry-sleep',
      '2',
      '--file-access-retries',
      '10',
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
    },
    { allowNonZero: true }
  )
  // 下载结束后的成品文件解析：
  // - 多格式下载会先产生 media.f30077.mp4 / media.f30280.m4a 等部分文件，合并后再删掉它们，
  //   此时输出为 media.mp4（--merge-output-format mp4）；
  // - 未发生合并（如仅音频回退）时，最后一条 Destination 指向的就是成品；
  // 因此不能沿用“第一条 Destination”，否则会拿到已被删除的部分文件。
  const merged = join(workDir, 'media.mp4')
  if (existsSync(merged)) return merged
  const dests = [...res.stdout.matchAll(/\[download\] Destination:\s+(.+)/g)].map((m) => m[1].trim())
  // 合并失败（如缺 ffmpeg）时残留的是 media.f30080.mp4 + media.f30280.m4a 两部分文件。
  // 必须优先选「视频」部分而不是盲目取最后一条 Destination（那往往是音频 m4a），
  // 否则 mediaPath 变成纯音频 → 界面播放器显示成无画面的音频。
  const VIDEO_EXT_RE = /\.(mp4|webm|mkv|mov|m4v)$/i
  const videoDst = dests.find((d) => VIDEO_EXT_RE.test(d) && existsSync(d))
  if (videoDst) return videoDst
  const last = dests[dests.length - 1]
  if (last && existsSync(last)) return last
  return merged
}
