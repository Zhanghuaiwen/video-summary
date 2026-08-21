import { hierarchy, tree as d3Tree, type HierarchyNode } from 'd3-hierarchy'
import type { MindMapNode } from '@shared/types'

export interface LayoutPoint {
  id: string
  x: number
  y: number
}

/** 同列相邻节点之间的最小垂直净距 */
const COL_GAP = 12
/** 节点最大宽 240px，减去内边距后每行可容纳的字符数（中英文混合估算） */
const CHAR_PER_LINE = 16

/**
 * 估算节点渲染高度（与 MindMapNode 样式保持一致）：
 * 标题行数 + 关键词行 + 时间行 + 内边距。
 */
function estimateHeight(node: MindMapNode, depth: number): number {
  const lines = Math.min(3, Math.max(1, Math.ceil((node.title?.length ?? 1) / CHAR_PER_LINE)))
  const lineHeight = depth === 0 ? 21 : depth === 1 ? 19 : 17
  const pad = depth === 0 ? 22 : 14
  let h = pad + lines * lineHeight
  if (depth <= 2 && node.keywords && node.keywords.length > 0) h += 24
  if (node.timeRange) h += 18
  return h + 2
}

/**
 * 横向树布局：根在左，子级向右展开。
 * nodeSize: [同级垂直间距, 每层水平间距]。水平间距必须大于节点最大宽度（240px），
 * 否则相邻两列会重叠；垂直紧凑度由后续的逐列防重叠压实保证。
 */
export function layoutTreePositions(
  root: MindMapNode,
  nodeSize: [number, number] = [64, 268]
): Map<string, LayoutPoint> {
  const h = hierarchy<MindMapNode>(root, (d) => d.children ?? [])
  d3Tree<MindMapNode>().nodeSize(nodeSize)(h)

  // 收集可见节点（与画布渲染规则一致：被收起祖先的后代不参与布局）
  interface Item {
    id: string
    depth: number
    x: number
    y: number
    node: MindMapNode
  }
  const items: Item[] = []
  const parentOf = new Map<string, string>()
  const visit = (n: HierarchyNode<MindMapNode>, depth: number, hidden: boolean): void => {
    const visible = !hidden
    if (visible) items.push({ id: n.data.id, depth, x: n.y ?? 0, y: n.x ?? 0, node: n.data })
    const childHidden = hidden || (visible && !!n.data.collapsed)
    for (const c of n.children ?? []) {
      parentOf.set(c.data.id, n.data.id)
      visit(c, depth + 1, childHidden)
    }
  }
  visit(h, 0, false)

  const byId = new Map(items.map((i) => [i.id, i]))
  const columns = new Map<number, Item[]>()
  for (const it of items) {
    let col = columns.get(it.depth)
    if (!col) columns.set(it.depth, (col = []))
    col.push(it)
  }

  /** 逐列自上而下消除重叠（y 为节点中心坐标） */
  const compactColumns = (): void => {
    for (const col of columns.values()) {
      col.sort((a, b) => a.y - b.y)
      let prevEdge: number | null = null
      for (const it of col) {
        const half = estimateHeight(it.node, it.depth) / 2
        if (prevEdge !== null) {
          const minY = prevEdge + COL_GAP + half
          if (it.y < minY) it.y = minY
        }
        prevEdge = it.y + half
      }
    }
  }

  compactColumns()

  // 父节点重新居中到可见子节点的中点（自底向上），随后再压实一轮
  const childrenOf = new Map<string, Item[]>()
  for (const it of items) {
    const pid = parentOf.get(it.id)
    if (!pid || !byId.has(pid)) continue
    let arr = childrenOf.get(pid)
    if (!arr) childrenOf.set(pid, (arr = []))
    arr.push(it)
  }
  for (const it of [...items].sort((a, b) => b.depth - a.depth)) {
    const kids = childrenOf.get(it.id)
    if (!kids || kids.length === 0) continue
    const ys = kids.map((k) => k.y)
    it.y = (Math.min(...ys) + Math.max(...ys)) / 2
  }
  compactColumns()

  const map = new Map<string, LayoutPoint>()
  for (const it of items) map.set(it.id, { id: it.id, x: it.x, y: it.y })
  return map
}

export function applyLayoutToNodes(
  positions: Map<string, LayoutPoint>,
  callback: (id: string, point: LayoutPoint) => void
): void {
  positions.forEach((point) => callback(point.id, point))
}
