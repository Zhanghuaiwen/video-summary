import { forwardRef, useImperativeHandle, useRef } from 'react'

export interface PlayerHandle {
  seekTo: (t: number) => void
  playFrom: (t: number) => void
}

interface Props {
  src: string | null
  kind: 'video' | 'audio'
  title: string
}

const Player = forwardRef<PlayerHandle, Props>(function Player({ src, kind, title }, ref) {
  const elRef = useRef<HTMLMediaElement | null>(null)

  // 媒体未加载元数据时设置 currentTime 会不生效；先等待 loadedmetadata / loadeddata
  const seekWhenReady = (t: number, play: boolean): void => {
    const el = elRef.current
    if (!el) return
    const apply = (): void => {
      try {
        if (Number.isFinite(t)) el.currentTime = t
        if (play) void el.play().catch(() => {})
      } catch {
        // 忽略 seek/播放失败
      }
    }
    if (el.readyState >= 1 /* HAVE_METADATA */) {
      apply()
    } else {
      const ready = (): void => {
        el.removeEventListener('loadedmetadata', ready)
        el.removeEventListener('loadeddata', ready)
        apply()
      }
      el.addEventListener('loadedmetadata', ready)
      el.addEventListener('loadeddata', ready)
      // 兜底：1.5s 内未就绪也尝试一次
      setTimeout(() => {
        el.removeEventListener('loadedmetadata', ready)
        el.removeEventListener('loadeddata', ready)
        if (el.readyState < 1) apply()
      }, 1500)
    }
  }

  useImperativeHandle(ref, () => ({
    seekTo: (t) => seekWhenReady(t, false),
    playFrom: (t) => seekWhenReady(t, true)
  }), [])

  if (!src) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5 text-[11px] text-[var(--text-faint)]">
        <span className="shrink-0">🎬</span>
        <span className="truncate">该项目没有可播放的媒体文件</span>
      </div>
    )
  }

  const common = {
    src,
    controls: true,
    preload: 'metadata' as const,
    title,
    ref: (el: HTMLMediaElement | null) => {
      elRef.current = el
    }
  }

  return kind === 'video' ? (
    <video {...common} className="max-h-44 w-full rounded-xl bg-black" />
  ) : (
    <audio {...common} className="w-full" />
  )
})

export default Player