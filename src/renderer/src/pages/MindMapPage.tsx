import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { client } from '@/api/client'
import { useAppStore } from '@/store/appStore'
import { useMindMapStore } from '@/store/mindMapStore'
import { findNode } from '@shared/mindmap-util'
import { toErrorMessage } from '@shared/errors'
import type { MindMapExportFormat, TimelineSegment } from '@shared/types'
import MindMapFlow from './mindmap/MindMapFlow'
import NodeDetail from './mindmap/NodeDetail'
import Player, { type PlayerHandle } from './mindmap/Player'
import { layoutTreePositions } from './mindmap/layout'
import { isAudioFile } from '@/utils/media'
import {
  IconChevronDown,
  IconCollapseAll,
  IconDownload,
  IconExpandAll,
  IconGitBranch,
  IconHistory,
  IconLayout,
  IconMaximize,
  IconRotate,
  IconSave,
  IconUpload
} from '@/components/icons'

const EXPORT_ITEMS: { format: MindMapExportFormat; label: string }[] = [
  { format: 'json', label: 'JSON（完整无损）' },
  { format: 'xmind', label: 'XMind (.xmind)' },
  { format: 'opml', label: 'OPML' },
  { format: 'freemind', label: 'FreeMind (.mm)' },
  { format: 'markdown', label: 'Markdown' }
]

function clockNow(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false })
}

export default function MindMapPage(): React.JSX.Element {
  const selectedId = useAppStore((s) => s.selectedProjectId)
  const setSelectedProject = useAppStore((s) => s.setSelectedProject)
  const projects = useAppStore((s) => s.projects)
  const project = projects.find((p) => p.id === selectedId)

  const doc = useMindMapStore((s) => s.doc)
  const dirty = useMindMapStore((s) => s.dirty)
  const saveState = useMindMapStore((s) => s.saveState)
  const selectedId0 = useMindMapStore((s) => s.selectedId)

  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [segments, setSegments] = useState<TimelineSegment[]>([])
  const [regenBusy, setRegenBusy] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [recentOpen, setRecentOpen] = useState(false)
  const [recentList, setRecentList] = useState<{ id: string; title: string }[]>([])

  const playerRef = useRef<PlayerHandle>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 3200)
  }, [])

  // ---------- 加载 ----------
  useEffect(() => {
    let alive = true
    const res = useMindMapStore.getState()
    res.loadDoc(null)
    res.select(null)
    setSegments([])
    setLoadError(null)

    if (!selectedId || !project || project.stage !== 'done') {
      setLoading(false)
      return
    }
    setLoading(true)
    void (async () => {
      try {
        const d = await client.mindmapGet(selectedId)
        if (!alive) return
        useMindMapStore.getState().loadDoc(d)
      } catch (err) {
        if (!alive) return
        useMindMapStore.getState().loadDoc(null)
        setLoadError(toErrorMessage(err))
      }
      // 时间轴片段（用于节点详情的时间对应）
      try {
        const v = await client.getVision(selectedId)
        if (alive) setSegments(v.segments ?? [])
      } catch {
        // 视觉数据缺失不影响思维导图展示
      }
      if (alive) setLoading(false)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, project?.stage, project?.updatedAt])

  // ---------- 自动保存（防抖 2.2s） ----------
  const saveNow = useCallback(async (): Promise<void> => {
    const st = useMindMapStore.getState()
    const current = st.doc
    if (!current) return
    st.setSaveState('saving')
    try {
      const saved = await client.mindmapSave({ projectId: current.projectId, doc: current })
      useMindMapStore.getState().markSaved(saved)
    } catch (err) {
      useMindMapStore.getState().setSaveState('error')
      showToast(`保存失败：${toErrorMessage(err)}`)
    }
  }, [showToast])

  useEffect(() => {
    if (!dirty || !doc) return
    const timer = setTimeout(() => void saveNow(), 2200)
    return () => clearTimeout(timer)
  }, [dirty, doc, saveNow])

  const selectedNode = useMemo(() => {
    if (!doc || !selectedId0) return null
    return findNode(doc.root, selectedId0)
  }, [doc, selectedId0])

  // ---------- 媒体 ----------
  const media = useMemo(() => {
    if (!project?.mediaPath) return { src: null, kind: 'video' as const }
    const name = project.mediaPath.split(/[\\/]/).pop() ?? ''
    const rel = project.localPath ? 'local' : 'media'
    return { src: `vsmedia://${project.id}/${rel}`, kind: isAudioFile(name) ? ('audio' as const) : ('video' as const) }
  }, [project])

  const doSeek = useCallback((target: number) => {
    playerRef.current?.playFrom(target)
  }, [])

  if (!selectedId) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        从「项目库」选择已完成的项目查看思维导图
      </div>
    )
  }

  if (!project) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">项目不存在</div>
  }

  if (project.stage !== 'done') {
    return (
      <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">
        任务进行中（{project.stage}），完成后即可查看思维导图
      </div>
    )
  }

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--text-faint)]">加载中…</div>
  }

  // ---------- 工具栏动作 ----------
  const doLayout = (): void => {
    const st = useMindMapStore.getState()
    if (!st.doc) return
    const m = new Map<string, { x: number; y: number }>()
    layoutTreePositions(st.doc.root).forEach((p) => m.set(p.id, p))
    st.applyLayout(m)
  }

  const doExport = async (format: MindMapExportFormat): Promise<void> => {
    setExportOpen(false)
    try {
      const res = await client.mindmapExport({ projectId: project.id, format })
      if (res.path) showToast(`已导出：${res.path}`)
    } catch (err) {
      showToast(`导出失败：${toErrorMessage(err)}`)
    }
  }

  const doImport = async (): Promise<void> => {
    try {
      const res = await client.mindmapImport(project.id)
      useMindMapStore.getState().replaceDoc(res.doc)
      showToast(`已从 ${res.format} 导入，将自动保存`)
    } catch (err) {
      showToast(`导入失败：${toErrorMessage(err)}`)
    }
  }

  const doRegenerate = async (): Promise<void> => {
    setRegenBusy(true)
    try {
      const d = await client.mindmapRegenerate(project.id)
      useMindMapStore.getState().loadDoc(d)
      showToast('思维导图已重新生成')
    } catch (err) {
      showToast(`生成失败：${toErrorMessage(err)}`)
    } finally {
      setRegenBusy(false)
    }
  }

  const loadRecent = async (): Promise<void> => {
    if (!recentOpen) {
      try {
        const list = await client.mindmapRecent()
        setRecentList(list.map((r) => ({ id: r.id, title: r.title })))
      } catch {
        setRecentList([])
      }
    }
    setRecentOpen((open) => !open)
  }

  const openRecent = (id: string): void => {
    setRecentOpen(false)
    setSelectedProject(id)
  }

  const saveStatusText = saveState === 'saving' ? '保存中…' : saveState === 'error' ? '保存失败' : dirty ? '未保存的更改' : '已保存'

  const hasMindmap = Boolean(doc)

  return (
    <div ref={containerRef} className="flex h-full flex-col overflow-hidden">
      {/* 顶栏 */}
      <header className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold tracking-tight text-[var(--text-strong)]">{project.title}</div>
          <div className="flex items-center gap-1.5 text-[11px]">
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${dirty ? 'bg-[var(--status-amber)]' : 'bg-[var(--status-emerald)]'}`} />
            <span className={dirty ? 'text-[var(--status-amber)]' : 'text-[var(--status-emerald)]'}>{saveStatusText}</span>
            {saveState === 'saved' && (
              <span className="tabular-nums text-[var(--text-faint)]">· {doc?.updatedAt ? new Date(doc.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : clockNow()}</span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          <button
            onClick={doLayout}
            disabled={!hasMindmap}
            title="重新布局"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <IconLayout className="h-3.5 w-3.5" />
            布局
          </button>
          <button
            onClick={() => useMindMapStore.getState().setAllCollapsed(true)}
            disabled={!hasMindmap}
            title="全部收起"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <IconCollapseAll className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => useMindMapStore.getState().setAllCollapsed(false)}
            disabled={!hasMindmap}
            title="全部展开"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <IconExpandAll className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : containerRef.current?.requestFullscreen?.())}
            title="全屏"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <IconMaximize className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mx-0.5 h-6 w-px bg-[var(--border)]" />

        <div className="flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          <button
            onClick={() => {
              if (!hasMindmap || window.confirm('重新生成会用最新总结/画面信息重建整张导图，当前手工修改会被覆盖，确定继续？')) {
                void doRegenerate()
              }
            }}
            disabled={regenBusy}
            title="重新生成思维导图"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
          >
            <IconRotate className={`h-3.5 w-3.5 ${regenBusy ? 'animate-spin' : ''}`} />
            {regenBusy ? '生成中…' : '重新生成'}
          </button>

          <button
            onClick={doImport}
            title="导入思维导图文件"
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
          >
            <IconUpload className="h-3.5 w-3.5" />
            导入
          </button>

          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={!hasMindmap}
              title="导出思维导图"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)] disabled:opacity-40"
            >
              <IconDownload className="h-3.5 w-3.5" />
              导出
              <IconChevronDown className={`h-3 w-3 transition-transform duration-150 ${exportOpen ? 'rotate-180' : ''}`} />
            </button>
            {exportOpen && (
              <div className="card-raised absolute right-0 top-9 z-20 w-48 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] py-1">
                {EXPORT_ITEMS.map((item) => (
                  <button
                    key={item.format}
                    onClick={() => void doExport(item.format)}
                    className="block w-full px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-bg)] hover:text-[var(--accent-text)]"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="relative">
            <button
              onClick={() => void loadRecent()}
              title="最近打开的思维导图"
              className="flex items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]"
            >
              <IconHistory className="h-3.5 w-3.5" />
              最近
              <IconChevronDown className={`h-3 w-3 transition-transform duration-150 ${recentOpen ? 'rotate-180' : ''}`} />
            </button>
            {recentOpen && (
              <div className="card-raised absolute right-0 top-9 z-20 w-52 overflow-hidden rounded-xl border border-[var(--border-strong)] bg-[var(--surface-2)] py-1">
                {recentList.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-[var(--text-faint)]">暂无最近打开的思维导图</div>
                )}
                {recentList.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openRecent(r.id)}
                    className="block w-full truncate px-3 py-2 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--accent-bg)] hover:text-[var(--accent-text)]"
                  >
                    {r.title}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => void saveNow()}
            disabled={!hasMindmap || !dirty}
            className="ml-1 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-[0_6px_16px_-6px_var(--accent-glow)] transition-all duration-150 [background-image:var(--accent-gradient)] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
          >
            <IconSave className="h-3.5 w-3.5" />
            保存
          </button>
        </div>
      </header>

      {/* 主体 */}
      {hasMindmap && doc ? (
        <div className="flex min-h-0 flex-1">
          <div className="min-w-0 flex-1">
            <MindMapFlow
              doc={doc}
              onSelect={(id) => useMindMapStore.getState().select(id)}
              onToggleCollapse={(id) => useMindMapStore.getState().toggleCollapse(id)}
              onMoveNode={(id, x, y) => useMindMapStore.getState().moveNode(id, x, y)}
            />
          </div>
          <div className="flex w-[300px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--surface)]">
            <NodeDetail
              node={selectedNode}
              root={doc.root}
              segments={segments}
              projectId={project.id}
              canJump={Boolean(media.src)}
              onUpdate={(id, patch) => useMindMapStore.getState().updateNode(id, patch)}
              onAddChild={(pid) => useMindMapStore.getState().addChild(pid)}
              onRemove={(id) => useMindMapStore.getState().removeNode(id)}
              onReparent={(id, pid) => useMindMapStore.getState().reparent(id, pid)}
              onSeek={doSeek}
              onToggleCollapse={(id) => useMindMapStore.getState().toggleCollapse(id)}
            />
            <div className="shrink-0 border-t border-[var(--border)] px-3 py-2">
              <Player ref={playerRef} src={media.src} kind={media.kind} title={project.title} />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-sm text-[var(--text-faint)]">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text-dim)]">
            <IconGitBranch className="h-6 w-6" />
          </div>
          {loadError && (
            <div className="max-w-md text-center text-xs leading-relaxed text-[var(--text-muted2)]">
              {loadError === '该项目尚无思维导图'
                ? '该项目尚未生成思维导图（分析完成时会自动生成；如果生成失败或你想换一种视角，可以点击下方重新生成）。'
                : loadError}
            </div>
          )}
          {loadError == null && <div className="text-xs">该项目尚未生成思维导图</div>}
          <button
            onClick={() => void doRegenerate()}
            disabled={regenBusy}
            className="flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white shadow-[0_8px_20px_-8px_var(--accent-glow)] transition-all duration-150 [background-image:var(--accent-gradient)] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            <IconRotate className={`h-3.5 w-3.5 ${regenBusy ? 'animate-spin' : ''}`} />
            {regenBusy ? '生成中…' : '生成 / 重新生成思维导图'}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="card-raised fixed left-1/2 top-4 z-50 max-w-md -translate-x-1/2 truncate rounded-xl border border-[var(--border-strong)] bg-[var(--toast-bg)] px-4 py-2.5 text-xs text-[var(--text-body)]">
          {toast}
        </div>
      )}
    </div>
  )
}