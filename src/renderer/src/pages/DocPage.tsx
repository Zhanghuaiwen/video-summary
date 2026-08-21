import { useEffect, useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { toErrorMessage } from '@shared/errors'
import type { SummaryDoc } from '@shared/types'
import { normalizeSummaryDoc } from '@shared/summary-util'

type TabKey = 'summary' | 'transcript'

function fmtTime2(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  const ss = s % 60
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
}

export default function DocPage(): React.JSX.Element {
  const selectedId = useAppStore((s) => s.selectedProjectId)
  const projects = useAppStore((s) => s.projects)
  const project = projects.find((p) => p.id === selectedId)

  const [tab, setTab] = useState<TabKey>('summary')
  const [summary, setSummary] = useState<SummaryDoc | null>(null)
  const [transcript, setTranscript] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openFolder = async (id: string): Promise<void> => {
    try {
      await client.openFolder(id)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }

  const playMedia = async (id: string): Promise<void> => {
    try {
      await client.playMedia(id)
    } catch (err) {
      setError(toErrorMessage(err))
    }
  }

  useEffect(() => {
    setSummary(null)
    setTranscript('')
    setError(null)
    setTab('summary')
    if (!selectedId || !project || project.stage !== 'done') return

    setLoading(true)
    void Promise.all([client.getSummary(selectedId), client.getTranscript(selectedId)])
      .then(([s, t]) => {
        setSummary(normalizeSummaryDoc(s))
        setTranscript(t)
      })
      .catch((err: unknown) => setError(toErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [selectedId, project?.stage]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        从「项目库」选择已完成的项目查看总结文档
      </div>
    )
  }

  if (!project || project.stage !== 'done') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        {project ? `任务进行中（${project.stage}），完成后即可查看` : '项目不存在'}
      </div>
    )
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">加载中…</div>
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--status-rose)]">{error}</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate text-xl font-semibold text-[var(--text-strong)]">{summary?.title ?? project.title}</h2>
        <div className="flex shrink-0 items-center gap-1">
          {project.mediaPath && (
            <>
              <button
                onClick={() => void playMedia(project.id)}
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              >
                ▶ 播放视频
              </button>
              <button
                onClick={() => void openFolder(project.id)}
                title="打开项目文件夹（视频 / 转写 / 总结等）"
                className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              >
                📁 打开文件夹
              </button>
            </>
          )}
          <div className="flex shrink-0 gap-1 rounded-lg bg-[var(--surface-2)] p-1">
            {(
              [
                ['summary', '总结'],
                ['transcript', '文字稿']
              ] as [TabKey, string][]
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-md px-3 py-1.5 text-xs transition-colors ${
                  tab === key ? 'bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'text-[var(--text-muted2)] hover:text-[var(--text)]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {tab === 'summary' && summary && (
        <div className="mt-6 flex flex-col gap-5">
          <section className="rounded-2xl border border-[var(--accent-border)] bg-[var(--accent-bg-soft)] p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-[var(--accent-text)]">核心概述</div>
            <p className="mt-2 text-sm leading-relaxed text-[var(--text-body)]">{summary.overview}</p>
            {summary.takeaways && summary.takeaways.length > 0 && (
              <div className="mt-4">
                <div className="text-xs font-medium uppercase tracking-wider text-[var(--accent-text)]">全片核心要点</div>
                <ul className="mt-2 flex flex-col gap-2">
                  {summary.takeaways.map((t, ti) => (
                    <li key={ti} className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                      <span className="mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent-bg)] text-[10px] font-semibold text-[var(--accent-text)]">
                        {ti + 1}
                      </span>
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {summary.chapters.map((ch, i) => (
            <section key={i} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-baseline gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--accent-bg)] text-xs font-semibold text-[var(--accent-text)]">
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold text-[var(--text-strong)]">{ch.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[var(--text-secondary)]">{ch.summary}</p>
              {ch.points.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2.5">
                  {ch.points.map((pt, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--dot)]" />
                      <div className="min-w-0">
                        <div>{pt.text}</div>
                        {pt.subPoints && pt.subPoints.length > 0 && (
                          <ul className="mt-1 flex flex-col gap-1 pl-3">
                            {pt.subPoints.map((sp, k) => (
                              <li key={k} className="flex items-start gap-1.5 text-[12px] leading-relaxed text-[var(--text-faint)]">
                                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--dot)]" />
                                <span>{sp}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {ch.frames && ch.frames.length > 0 && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {ch.frames.map((f, fi) => (
                    <figure key={fi} className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-soft)]">
                      <img
                        src={`vsmedia://${project.id}/${f.path}`}
                        alt={`画面 ${f.time}s`}
                        loading="lazy"
                        className="aspect-video w-full object-cover"
                      />
                      <figcaption className="flex flex-col gap-1 p-2.5">
                        <div className="text-[10px] tabular-nums text-[var(--text-dim)]">约 {fmtTime2(f.time)}</div>
                        {f.ocr && <div className="whitespace-pre-wrap text-[11px] leading-snug text-[var(--text-muted2)]">{f.ocr}</div>}
                        {f.visual && <div className="text-[11px] text-[var(--text-faint)]">{f.visual}</div>}
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === 'transcript' && (
        <pre className="mt-6 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-sm leading-relaxed text-[var(--text-secondary)]">
          {transcript}
        </pre>
      )}
    </div>
  )
}
