import { memo } from 'react'
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { MindMapNode as MNode } from '@shared/types'
import { fmtTime } from '@/utils/media'

export interface MindMapFlowData extends Record<string, unknown> {
  node: MNode
  depth: number
  collapsed: boolean
  hasChildren: boolean
  onToggleCollapse: (id: string) => void
  /** 所属分支的主题色（用于节点边框与连线） */
  branchColor?: string
}

export type MindMapFlowNodeType = Node<MindMapFlowData, 'mindmap'>

const DEPTH_BOXES: Record<number, string> = {
  0: 'border-[var(--accent-border-strong)] bg-[var(--accent-bg)]',
  1: 'border-sky-400/50 bg-sky-500/10',
  2: 'border-[var(--accent-border)] bg-[var(--accent-bg-soft)]',
  3: 'border-transparent bg-[var(--surface-2)]'
}

export const MindMapFlowNode = memo(function MindMapFlowNode({
  id,
  data,
  selected
}: NodeProps<MindMapFlowNodeType>): React.JSX.Element {
  const { node, depth, collapsed, hasChildren, onToggleCollapse, branchColor } = data
  const box = DEPTH_BOXES[Math.min(depth, 3)] ?? 'border-[var(--border-strong)] bg-[var(--surface-2)]'
  // 层级越深视觉越轻：根节点最重（大字号+粗体），一级分支次之，叶子节点最轻
  const titleCls =
    depth === 0
      ? 'text-[15px] font-bold leading-snug'
      : depth === 1
        ? 'text-[13px] font-semibold leading-snug'
        : 'text-[12px] font-normal leading-snug text-[var(--text-muted)]'
  const pad = depth === 0 ? 'px-4 py-2.5' : 'px-3 py-1.5'
  const shadow = depth <= 1 ? 'shadow-lg' : 'shadow-sm'
  // 深层节点边框降透明度，避免整图彩色边框过花；分支色仍由连线承担识别度
  const borderStyle = branchColor
    ? { borderColor: depth >= 2 ? `${branchColor}59` : branchColor }
    : undefined
  return (
    <div
      className={`relative max-w-[240px] select-none rounded-xl border ${pad} ${shadow} shadow-[var(--shadow-color-node)] ${box} ${
        selected ? 'ring-2 ring-[var(--accent-ring)]' : ''
      }`}
      style={borderStyle}
    >
      <div className="break-words text-[var(--text-node)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:3] [overflow:hidden]">
        <span className={titleCls}>{node.title}</span>
      </div>
      {depth <= 2 && node.keywords && node.keywords.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {node.keywords.slice(0, 3).map((k) => (
            <span key={k} className="rounded-full bg-[var(--badge)] px-1.5 py-0.5 text-[10px] text-[var(--text-muted)]">
              {k}
            </span>
          ))}
        </div>
      )}
      {node.timeRange && (
        <div className="mt-1 text-[10px] tabular-nums text-[var(--text-dim)]">
          {fmtTime(node.timeRange.start)} – {fmtTime(node.timeRange.end)}
        </div>
      )}
      {hasChildren && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onToggleCollapse(id)
          }}
          title={collapsed ? '展开' : '收起'}
          className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-[var(--border-strong)] bg-[var(--surface-hover)] text-[11px] leading-none text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          {collapsed ? '+' : '−'}
        </button>
      )}
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  )
})