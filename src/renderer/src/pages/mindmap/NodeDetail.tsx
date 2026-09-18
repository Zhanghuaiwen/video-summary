import { useMemo, useState } from 'react'
import type { MindMapNode, TimelineSegment } from '@shared/types'
import { walk } from '@shared/mindmap-util'
import { fmtTime } from '@/utils/media'
import { IconPlay } from '@/components/icons'

interface Props {
  node: MindMapNode | null
  root: MindMapNode
  segments: TimelineSegment[]
  /** 项目 ID：用于拼接 vsmedia:// 画面地址 */
  projectId: string
  canJump: boolean
  onUpdate: (id: string, patch: Partial<MindMapNode>) => void
  onAddChild: (parentId: string) => void
  onRemove: (id: string) => void
  onReparent: (nodeId: string, newParentId: string) => void
  onSeek: (target: number) => void
  onToggleCollapse: (id: string) => void
}

const inputCls =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent-border-strong)] focus:outline-none'

export default function NodeDetail({
  node,
  root,
  segments,
  projectId,
  canJump,
  onUpdate,
  onAddChild,
  onRemove,
  onReparent,
  onSeek,
  onToggleCollapse
}: Props): React.JSX.Element {
  const [moveOpen, setMoveOpen] = useState(false)
  const parentCandidates = useMemo(() => {
    if (!node) return []
    const excluded = new Set<string>()
    walk(node, (n) => excluded.add(n.id))
    const out: { id: string; label: string }[] = []
    walk(root, (n) => {
      if (!excluded.has(n.id) && n.id !== node.id) {
        out.push({ id: n.id, label: n.id === root.id ? `根节点：${n.title}` : n.title })
      }
    })
    return out
  }, [node, root])

  if (!node) {
    return (
      <aside className="flex min-h-0 w-[300px] shrink-0 flex-1 flex-col p-4">
        <div className="text-sm text-[var(--text-faint)]">点击节点查看 / 编辑详情</div>
      </aside>
    )
  }

  const isRoot = node.id === root.id
  const kn = node.keywords?.join(', ') ?? ''
  const snippet = findSnippet(node, segments)

  return (
    <aside className="flex min-h-0 w-[300px] shrink-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-[var(--text-strong)]">节点详情</h4>
        <div className="flex items-center gap-1">
          {(node.children?.length ?? 0) > 0 && (
            <button
              onClick={() => onToggleCollapse(node.id)}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            >
              {node.collapsed ? '展开' : '收起'}
            </button>
          )}
          {!isRoot && (
            <div className="relative">
              <button
                onClick={() => setMoveOpen((o) => !o)}
                title="移动到其他父节点"
                className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              >
                移动至
              </button>
              {moveOpen && (
                <div className="absolute right-0 top-7 z-20 max-h-56 w-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--surface-2)] py-1 shadow-lg shadow-[var(--shadow-color)]">
                  {parentCandidates.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        onReparent(node.id, p.id)
                        setMoveOpen(false)
                      }}
                      className="block w-full truncate px-3 py-1.5 text-left text-[11px] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <button
            onClick={() => onAddChild(node.id)}
            title="添加子节点"
            className="rounded-md px-2 py-1 text-[11px] text-[var(--text-muted2)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          >
            + 子节点
          </button>
          {!isRoot && (
            <button
              onClick={() => {
                if (window.confirm(`确定删除「${node.title}」及全部子节点？`)) onRemove(node.id)
              }}
              className="rounded-md px-2 py-1 text-[11px] text-[var(--status-rose)] hover:bg-rose-500/10"
            >
              删除
            </button>
          )}
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">标题</span>
        <input
          value={node.title}
          onChange={(e) => onUpdate(node.id, { title: e.target.value })}
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">关键词（逗号分隔）</span>
        <input
          value={kn}
          onChange={(e) =>
            onUpdate(node.id, {
              keywords: e.target.value
                .split(/[,，]/)
                .map((k) => k.trim())
                .filter(Boolean)
            })
          }
          placeholder="概念A, 概念B"
          className={inputCls}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">一句话摘要</span>
        <textarea
          value={node.summary ?? ''}
          onChange={(e) => onUpdate(node.id, { summary: e.target.value })}
          rows={3}
          placeholder="简要解释本节点"
          className={`${inputCls} resize-none`}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-[var(--text-muted)]">详细内容</span>
        <textarea
          value={node.content ?? ''}
          onChange={(e) => onUpdate(node.id, { content: e.target.value })}
          rows={7}
          placeholder="知识点详细展开"
          className={`${inputCls} resize-none`}
        />
      </label>

      {node.frames && node.frames.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-[var(--text-muted)]">相关画面</span>
          <div className="grid grid-cols-2 gap-2">
            {node.frames.map((f, fi) => (
              <figure
                key={fi}
                className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface-2)]"
              >
                <div className="relative">
                  <img
                    src={`vsmedia://${projectId}/${f.path}`}
                    alt={`画面 ${f.time}s`}
                    loading="lazy"
                    className="aspect-video w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.closest('figure')?.remove()
                    }}
                  />
                  <span className="absolute left-1.5 top-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-white backdrop-blur-sm">
                    {fmtTime(f.time)}
                  </span>
                </div>
                {f.ocr && (
                  <figcaption className="line-clamp-2 px-2 py-1.5 text-[10px] leading-snug text-[var(--text-muted2)]">
                    {f.ocr}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </div>
      )}

      {node.timeRange ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-muted)]">视频时间</span>
            <span className="text-xs tabular-nums text-[var(--text-secondary)]">
              {fmtTime(node.timeRange.start)} – {fmtTime(node.timeRange.end)}
            </span>
          </div>
          {snippet && (
            <p className="mt-2 line-clamp-4 text-[11px] leading-relaxed text-[var(--text-muted2)]">{snippet}</p>
          )}
          {canJump && (
            <button
              onClick={() => onSeek(node.timeRange!.start)}
              className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent-bg)] py-1.5 text-xs font-medium text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-bg-hover)]"
            >
              <IconPlay className="h-3 w-3" />
              跳转到此处
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-[var(--border)] p-3 text-[11px] text-[var(--text-faint)]">
          未关联视频时间点
        </div>
      )}
    </aside>
  )
}

function findSnippet(node: MindMapNode, segments: TimelineSegment[]): string | null {
  if (!node.timeRange || segments.length === 0) return null
  const seg = segments.find((s) => node.timeRange!.start >= s.startTime && node.timeRange!.start < s.endTime)
  if (!seg) return null
  return seg.transcript.trim()
}