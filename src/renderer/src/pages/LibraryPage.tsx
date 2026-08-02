import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import type { PipelineStage, Project } from '@shared/types'

const STAGE_LABEL: Partial<Record<PipelineStage, string>> = {
  queued: '排队中',
  downloading: '下载中',
  extracting: '提取音频',
  transcribing: '转写中',
  summarizing: '总结中',
  done: '已完成',
  failed: '失败'
}

const STAGE_COLOR: Partial<Record<PipelineStage, string>> = {
  queued: 'text-[#8a93a5] bg-[#1a1f29]',
  downloading: 'text-sky-300 bg-sky-500/10',
  extracting: 'text-sky-300 bg-sky-500/10',
  transcribing: 'text-amber-300 bg-amber-500/10',
  summarizing: 'text-violet-300 bg-violet-500/10',
  done: 'text-emerald-300 bg-emerald-500/10',
  failed: 'text-rose-300 bg-rose-500/10'
}

const IN_PROGRESS_STAGES = new Set<PipelineStage>(['downloading', 'extracting', 'transcribing', 'summarizing'])

function ProgressBar({ project }: { project: Project }): React.JSX.Element {
  if (project.stage === 'done') return <span className="text-xs text-emerald-400">已完成</span>
  if (project.stage === 'failed') return <span className="text-xs text-rose-400">失败</span>

  const pct = project.stage === 'extracting' ? Math.max(project.progress, 5) : project.progress
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[#1a1f29]">
        <div
          className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-all duration-300"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-[#8a93a5]">{Math.round(pct)}%</span>
    </div>
  )
}

export default function LibraryPage(): React.JSX.Element {
  const projects = useAppStore((s) => s.projects)
  const selectedId = useAppStore((s) => s.selectedProjectId)
  const setSelectedProject = useAppStore((s) => s.setSelectedProject)
  const setProjects = useAppStore((s) => s.setProjects)
  const setPage = useAppStore((s) => s.setPage)

  const remove = async (id: string): Promise<void> => {
    try {
      await client.deleteProject(id)
      setProjects(await client.listProjects())
      if (selectedId === id) setSelectedProject(null)
    } catch (err) {
      console.error('删除失败', err)
    }
  }

  const cancel = async (id: string): Promise<void> => {
    try {
      await client.cancelProject(id)
    } catch (err) {
      console.error('取消失败', err)
    }
  }

  const isInProgress = (stage: Project['stage']): boolean => IN_PROGRESS_STAGES.has(stage)

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h2 className="text-xl font-semibold text-[#f1f3f7]">项目库</h2>
      <p className="mt-1 text-sm text-[#8a93a5]">所有解析任务的历史记录</p>

      {projects.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-[#5b6472]">
          <div className="text-sm">还没有项目</div>
          <div className="mt-1 text-xs">从「新建」页粘贴链接或上传视频开始</div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-2">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`rounded-xl border px-5 py-4 transition-colors ${
                selectedId === p.id
                  ? 'border-indigo-500/60 bg-indigo-500/5'
                  : 'border-[#1c212b] bg-[#12151b] hover:border-[#2a2f3a]'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[#e6e8ee]">{p.title}</div>
                  <div className="mt-1 truncate text-xs text-[#6b7280]">
                    {p.source === 'bilibili' ? p.sourceUrl : p.localPath} ·{' '}
                    {new Date(p.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${STAGE_COLOR[p.stage] ?? STAGE_COLOR.queued}`}
                >
                  {STAGE_LABEL[p.stage] ?? p.stage}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <ProgressBar project={p} />
                <div className="flex items-center gap-2">
                  {isInProgress(p.stage) && (
                    <button
                      onClick={() => void cancel(p.id)}
                      className="rounded-lg px-3 py-1.5 text-xs text-[#8a93a5] transition-colors hover:text-rose-400"
                    >
                      停止
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSelectedProject(p.id)
                      setPage('doc')
                    }}
                    disabled={p.stage !== 'done'}
                    className="rounded-lg bg-[#1a1f29] px-3 py-1.5 text-xs text-[#9aa3b2] transition-colors hover:bg-[#232a37] hover:text-[#e6e8ee] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    查看
                  </button>
                  <button
                    onClick={() => void remove(p.id)}
                    className="rounded-lg px-2 py-1.5 text-xs text-[#6b7280] transition-colors hover:text-rose-400"
                  >
                    删除
                  </button>
                </div>
              </div>

              {p.error && <div className="mt-2 truncate text-xs text-rose-400">{p.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
