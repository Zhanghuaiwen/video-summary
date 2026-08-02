import { useEffect, useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { toErrorMessage } from '@shared/errors'
import type { SummaryDoc } from '@shared/types'

type TabKey = 'summary' | 'transcript'

export default function DocPage(): React.JSX.Element {
  const selectedId = useAppStore((s) => s.selectedProjectId)
  const projects = useAppStore((s) => s.projects)
  const project = projects.find((p) => p.id === selectedId)

  const [tab, setTab] = useState<TabKey>('summary')
  const [summary, setSummary] = useState<SummaryDoc | null>(null)
  const [transcript, setTranscript] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSummary(null)
    setTranscript('')
    setError(null)
    setTab('summary')
    if (!selectedId || !project || project.stage !== 'done') return

    setLoading(true)
    void Promise.all([client.getSummary(selectedId), client.getTranscript(selectedId)])
      .then(([s, t]) => {
        setSummary(s)
        setTranscript(t)
      })
      .catch((err: unknown) => setError(toErrorMessage(err)))
      .finally(() => setLoading(false))
  }, [selectedId, project?.stage]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#5b6472]">
        从「项目库」选择已完成的项目查看总结文档
      </div>
    )
  }

  if (!project || project.stage !== 'done') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[#5b6472]">
        {project ? `任务进行中（${project.stage}），完成后即可查看` : '项目不存在'}
      </div>
    )
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[#5b6472]">加载中…</div>
  }

  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-rose-400">{error}</div>
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <div className="flex items-center justify-between">
        <h2 className="truncate text-xl font-semibold text-[#f1f3f7]">{summary?.title ?? project.title}</h2>
        <div className="flex shrink-0 gap-1 rounded-lg bg-[#161a22] p-1">
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
                tab === key ? 'bg-indigo-500/20 text-indigo-300' : 'text-[#8a93a5] hover:text-[#e6e8ee]'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'summary' && summary && (
        <div className="mt-6 flex flex-col gap-5">
          <section className="rounded-2xl border border-indigo-500/25 bg-indigo-500/5 p-5">
            <div className="text-xs font-medium uppercase tracking-wider text-indigo-300">核心概述</div>
            <p className="mt-2 text-sm leading-relaxed text-[#d5d9e2]">{summary.overview}</p>
          </section>

          {summary.chapters.map((ch, i) => (
            <section key={i} className="rounded-2xl border border-[#1c212b] bg-[#12151b] p-5">
              <div className="flex items-baseline gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-500/15 text-xs font-semibold text-indigo-300">
                  {i + 1}
                </span>
                <h3 className="text-base font-semibold text-[#f1f3f7]">{ch.title}</h3>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-[#b9bfcc]">{ch.summary}</p>
              {ch.points.length > 0 && (
                <ul className="mt-3 flex flex-col gap-2">
                  {ch.points.map((pt, j) => (
                    <li key={j} className="flex items-start gap-2 text-sm text-[#9aa3b2]">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#4b5563]" />
                      {pt}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}

      {tab === 'transcript' && (
        <pre className="mt-6 max-h-[70vh] overflow-auto whitespace-pre-wrap rounded-2xl border border-[#1c212b] bg-[#12151b] p-5 text-sm leading-relaxed text-[#b9bfcc]">
          {transcript}
        </pre>
      )}
    </div>
  )
}
