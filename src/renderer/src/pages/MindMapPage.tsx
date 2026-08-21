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
  }, [selectedId, project?.stage, project?.mindmapPath])

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
          <div className="truncate text-sm font-semibold text-[var(--text-strong)]">{project.title}</div>
          <div className="flex items-center gap-2 text-[11px] text-[var(--text-faint)]">
            <span className={dirty ? 'text-[var(--status-amber)]' : 'text-[var(--status-emerald)]'}>{saveStatusText}</span>
            {saveState === 'saved' && <span>· {doc?.updatedAt ? new Date(doc.updatedAt).toLocaleTimeString('zh-CN', { hour12: false }) : clockNow()}</span>}
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={doLayout}
            disabled={!hasMindmap}
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-40"
          >
            重新布局
          </button>
          <button
            onClick={() => useMindMapStore.getState().setAllCollapsed(true)}
            disabled={!hasMindmap}
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-40"
          >
            全部收起
          </button>
          <button
            onClick={() => useMindMapStore.getState().setAllCollapsed(false)}
            disabled={!hasMindmap}
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-40"
          >
            全部展开
          </button>
          <button
            onClick={() => void (document.fullscreenElement ? document.exitFullscreen() : containerRef.current?.requestFullscreen?.())}
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          >
            全屏
          </button>
        </div>

        <div className="mx-1 h-6 w-px bg-[var(--border)]" />

        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (!hasMindmap || window.confirm('重新生成会用最新总结/画面信息重建整张导图，当前手工修改会被覆盖，确定继续？')) {
                void doRegenerate()
              }
            }}
            disabled={regenBusy}
            className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-40"
          >
            {regenBusy ? '重新生成中…' : '重新生成'}
          </button>

          <button onClick={doImport} className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]">
            导入
          </button>

          <div className="relative">
            <button
              onClick={() => setExportOpen((o) => !o)}
              disabled={!hasMindmap}
              className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-40"
            >
              导出 ▾
            </button>
            {exportOpen && (
              <div className="absolute right-0 top-8 z-20 w-48 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] py-1 shadow-2xl shadow-[var(--shadow-color)]">
                {EXPORT_ITEMS.map((item) => (
                  <button
                    key={item.format}
                    onClick={() => void doExport(item.format)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
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
              className="rounded-lg px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            >
              最近 ▾
            </button>
            {recentOpen && (
              <div className="absolute right-0 top-8 z-20 w-52 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)] py-1 shadow-2xl shadow-[var(--shadow-color)]">
                {recentList.length === 0 && <div className="px-3 py-2 text-[11px] text-[var(--text-faint)]">暂无最近打开的思维导图</div>}
                {recentList.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openRecent(r.id)}
                    className="flex w-full truncate px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
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
            className="ml-1 rounded-lg bg-[var(--accent-solid)] px-3 py-1.5 text-xs font-medium text-white transition-opacity hover:bg-[var(--accent-solid-hover)] disabled:cursor-not-allowed disabled:opacity-50"
          >
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
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-sm text-[var(--text-faint)]">
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
            className="rounded-lg bg-[var(--accent-solid)] px-4 py-2 text-xs font-medium text-white transition-opacity hover:bg-[var(--accent-solid-hover)] disabled:opacity-50"
          >
            {regenBusy ? '生成中…' : '生成 / 重新生成思维导图'}
          </button>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed left-1/2 top-4 z-50 max-w-md -translate-x-1/2 truncate rounded-lg border border-[var(--border-strong)] bg-[var(--toast-bg)] px-4 py-2 text-xs text-[var(--text-body)] shadow-xl shadow-[var(--shadow-color)]">
          {toast}
        </div>
      )}
    </div>
  )
}