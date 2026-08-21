import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import type { PipelineStage, Project } from '@shared/types'

const STAGE_LABEL: Partial<Record<PipelineStage, string>> = {
  queued: '排队中',
  downloading: '下载中',
  extracting: '提取音频',
  transcribing: '转写中',
  analyzing: '视觉分析中',
  summarizing: '总结中',
  mindmap: '生成思维导图',
  done: '已完成',
  failed: '失败'
}

const STAGE_COLOR: Partial<Record<PipelineStage, string>> = {
  queued: 'text-[var(--text-muted2)] bg-[var(--surface-3)]',
  downloading: 'text-[var(--status-sky)] bg-sky-500/10',
  extracting: 'text-[var(--status-sky)] bg-sky-500/10',
  transcribing: 'text-[var(--status-amber)] bg-amber-500/10',
  analyzing: 'text-[var(--status-cyan)] bg-cyan-500/10',
  summarizing: 'text-[var(--status-teal)] bg-teal-500/10',
  mindmap: 'text-[var(--status-pink)] bg-pink-500/10',
  done: 'text-[var(--status-emerald)] bg-emerald-500/10',
  failed: 'text-[var(--status-rose)] bg-rose-500/10'
}

const IN_PROGRESS_STAGES = new Set<PipelineStage>(['downloading', 'extracting', 'transcribing', 'analyzing', 'summarizing', 'mindmap'])

/** 是否有已完成阶段可以续跑 */
const resumable = (p: Project): boolean =>
  p.stage === 'failed' &&
  Boolean(
    p.checkpoint &&
      (p.checkpoint.transcribeDone || p.checkpoint.visionDone || p.checkpoint.summaryDone || p.checkpoint.mindmapDone)
  )

const stageLabel = (p: Project): string => {
  if (p.stage === 'failed') return resumable(p) ? '已暂停' : '失败'
  return STAGE_LABEL[p.stage] ?? p.stage
}

const stageColor = (p: Project): string => {
  if (p.stage === 'failed') return resumable(p) ? 'text-[var(--status-amber)] bg-amber-500/10' : STAGE_COLOR.failed ?? ''
  return STAGE_COLOR[p.stage] ?? STAGE_COLOR.queued ?? ''
}

function ProgressBar({ project }: { project: Project }): React.JSX.Element {
  if (project.stage === 'done') return <span className="text-xs text-[var(--status-emerald)]">已完成</span>
  if (project.stage === 'failed') return <span className="text-xs text-[var(--status-rose)]">失败</span>

  const pct = project.stage === 'extracting' ? Math.max(project.progress, 5) : project.progress
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-28 overflow-hidden rounded-full bg-[var(--surface-3)]">
        <div
          className="h-full rounded-full transition-all duration-300 [background-image:var(--accent-gradient)]"
          style={{ width: `${Math.min(pct, 100)}%` }}
        />
      </div>
      <span className="w-8 text-right text-[11px] tabular-nums text-[var(--text-muted2)]">{Math.round(pct)}%</span>
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

  const resume = async (id: string): Promise<void> => {
    try {
      await client.startProject(id)
    } catch (err) {
      console.error('继续失败', err)
    }
  }

  const openFolder = async (id: string): Promise<void> => {
    try {
      await client.openFolder(id)
    } catch (err) {
      console.error('打开文件夹失败', err)
    }
  }

  const isInProgress = (stage: Project['stage']): boolean => IN_PROGRESS_STAGES.has(stage)

  return (
    <div className="mx-auto max-w-4xl px-8 py-10">
      <h2 className="text-xl font-semibold text-[var(--text-strong)]">项目库</h2>
      <p className="mt-1 text-sm text-[var(--text-muted2)]">所有解析任务的历史记录</p>

      {projects.length === 0 ? (
        <div className="mt-16 flex flex-col items-center text-[var(--text-faint)]">
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
                  ? 'border-[var(--accent-border-strong)] bg-[var(--accent-bg-soft)]'
                  : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-[var(--text)]">{p.title}</div>
                  <div className="mt-1 truncate text-xs text-[var(--text-dim)]">
                    {p.source === 'bilibili' ? p.sourceUrl : p.localPath} ·{' '}
                    {new Date(p.createdAt).toLocaleString('zh-CN')}
                  </div>
                </div>

                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${stageColor(p)}`}
                >
                  {stageLabel(p)}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between">
                <ProgressBar project={p} />
                <div className="flex items-center gap-2">
                  {isInProgress(p.stage) && (
                    <button
                      onClick={() => void cancel(p.id)}
                      className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted2)] transition-colors hover:text-[var(--status-rose)]"
                    >
                      停止
                    </button>
                  )}
                  {p.stage === 'failed' && (
                    <button
                      onClick={() => void resume(p.id)}
                      className="rounded-lg bg-[var(--accent-bg)] px-3 py-1.5 text-xs text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg-hover)]"
                    >
                      继续
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setSelectedProject(p.id)
                      setPage('doc')
                    }}
                    disabled={p.stage !== 'done'}
                    className="rounded-lg bg-[var(--surface-3)] px-3 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-strong)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    查看
                  </button>
                  <button
                    onClick={() => void openFolder(p.id)}
                    disabled={p.stage !== 'done'}
                    title="打开项目文件夹（视频 / 转写 / 总结等）"
                    className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    打开文件夹
                  </button>
                  <button
                    onClick={() => void remove(p.id)}
                    className="rounded-lg px-2 py-1.5 text-xs text-[var(--text-dim)] transition-colors hover:text-[var(--status-rose)]"
                  >
                    删除
                  </button>
                </div>
              </div>

              {p.error && <div className="mt-2 truncate text-xs text-[var(--status-rose)]">{p.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
