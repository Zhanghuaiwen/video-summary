import { hierarchy, tree as d3Tree, type HierarchyNode } from 'd3-hierarchy'
import type { MindMapNode } from '@shared/types'

export interface LayoutPoint {
  id: string
  x: number
  y: number
}

/** 同列相邻节点之间的最小垂直净距 */
const COL_GAP = 12

/**
 * 节点最大宽度（与 MindMapNode 的 max-w-[240px] 一致）。
 * 注意：React Flow 的 position 是节点【左上角】坐标。本模块内部统一用
 * 「中心坐标」做防重叠推导，仅在最终输出时换算为左上角——否则渲染框会
 * 相对布局框整体上移半高，高个子节点（多行标题+关键词+时间戳）会与下方
 * 矮节点重叠。
 */
const NODE_MAX_W = 240

/** 各层级排版参数，与 MindMapFlowNode 的样式严格对齐 */
interface DepthStyle {
  /** 标题字号 px */
  fontSize: number
  /** 标题行高 px（leading-snug≈1.375 取整） */
  lineHeight: number
  /** 水平内边距 px（px-4=16 / px-3=12） */
  padX: number
  /** 垂直内边距 px（py-2.5=10 / py-1.5=6） */
  padY: number
}

const DEPTH_STYLES: Record<number, DepthStyle> = {
  0: { fontSize: 15, lineHeight: 21, padX: 16, padY: 10 },
  1: { fontSize: 13, lineHeight: 18, padX: 12, padY: 6 },
  2: { fontSize: 12, lineHeight: 17, padX: 12, padY: 6 },
  3: { fontSize: 12, lineHeight: 17, padX: 12, padY: 6 }
}

function styleOf(depth: number): DepthStyle {
  return DEPTH_STYLES[Math.min(depth, 3)] ?? DEPTH_STYLES[3]
}

/** 全角字符（CJK/全角标点等）宽度≈字号，半角字符≈字号×0.55 */
function isFullWidth(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6)
  )
}

function textWidth(text: string, fontSize: number): number {
  let w = 0
  for (const ch of text) w += isFullWidth(ch) ? fontSize : fontSize * 0.55
  return w
}

/** 按像素宽度模拟折行，返回行数（调用方自行钳制上限） */
function wrapLines(text: string, fontSize: number, innerW: number): number {
  if (!text) return 1
  let lines = 1
  let w = 0
  for (const ch of text) {
    // 长单词/URL 不在单词中间断行的细节忽略：估算用途允许少量误差
    const cw = isFullWidth(ch) ? fontSize : fontSize * 0.55
    if (w + cw > innerW) {
      lines++
      w = cw
    } else {
      w += cw
    }
  }
  return lines
}

/**
 * 估算节点渲染高度（必须与 MindMapNode 实际样式一致，宁可略高不可略低：
 * 低估会让 compactColumns 产出的防重叠间距小于真实渲染框，造成视觉重叠）。
 * 结构：上下内边距 + 标题（≤3 行，-webkit-line-clamp:3）+
 * 关键词徽标（flex-wrap 可折行，最多 3 个）+ 时间行。
 */
export function estimateNodeHeight(node: MindMapNode, depth: number): number {
  const st = styleOf(depth)
  const border = 2 // border 各 1px
  const innerW = Math.max(80, NODE_MAX_W - st.padX * 2 - border)

  // 标题行数（渲染端 line-clamp:3 截断）
  const titleLines = Math.min(3, wrapLines(node.title ?? '', st.fontSize, innerW))
  let h = st.padY * 2 + border + titleLines * st.lineHeight

  // 关键词徽标行：mt-1(4) + 徽标高(10px 字号 ×1.5 行高 + py-0.5 的 4px ≈ 19)
  if (depth <= 2 && node.keywords && node.keywords.length > 0) {
    const ks = node.keywords.slice(0, 3)
    const badgeTextW = ks.reduce((n, k) => n + textWidth(k, 10), 0)
    const badgeBoxW = badgeTextW + ks.length * (12 + 4) + (ks.length - 1) * 4 // px-1.5×2 + 边距估算 + gap-1
    const rows = Math.min(3, Math.max(1, Math.ceil(badgeBoxW / innerW)))
    h += 4 + rows * 19
  }

  // 时间行：mt-1(4) + 10px 字号 ×1.5 行高（tabular-nums 单行）
  if (node.timeRange) h += 4 + 15

  // +2px 抖动余量
  return h + 2
}

/**
 * 横向树布局：根在左，子级向右展开。
 * nodeSize: [同级垂直间距, 每层水平间距]。水平间距必须大于节点最大宽度（240px），
 * 否则相邻两列会重叠；垂直紧凑度由逐列防重叠压实保证。
 *
 * 返回坐标为 React Flow 所需的「节点左上角」位置；
 * 内部以中心坐标做防重叠，保证任意同列节点的起止 y 区间互不重叠。
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
    /** 中心坐标 y */
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
        const half = estimateNodeHeight(it.node, it.depth) / 2
        if (prevEdge !== null) {
          const minY = prevEdge + COL_GAP + half
          if (it.y < minY) it.y = minY
        }
        prevEdge = it.y + half
      }
    }
  }

  /** 父节点重新居中到可见子节点的中点（自底向上） */
  const childrenOf = new Map<string, Item[]>()
  for (const it of items) {
    const pid = parentOf.get(it.id)
    if (!pid || !byId.has(pid)) continue
    let arr = childrenOf.get(pid)
    if (!arr) childrenOf.set(pid, (arr = []))
    arr.push(it)
  }
  const recenterParents = (): void => {
    for (const it of [...items].sort((a, b) => b.depth - a.depth)) {
      const kids = childrenOf.get(it.id)
      if (!kids || kids.length === 0) continue
      const ys = kids.map((k) => k.y)
      it.y = (Math.min(...ys) + Math.max(...ys)) / 2
    }
  }

  // 压实 → 居中 → 再压实，迭代两轮让父节点定位与列压实互相收敛，
  // 保证输出状态下「起始 y 与终止 y（y+高度）都不与其他节点重叠」。
  compactColumns()
  for (let round = 0; round < 2; round++) {
    recenterParents()
    compactColumns()
  }

  const map = new Map<string, LayoutPoint>()
  for (const it of items) {
    // 中心坐标 → React Flow 左上角坐标（关键修复：消除半高渲染偏移）
    const top = it.y - estimateNodeHeight(it.node, it.depth) / 2
    map.set(it.id, { id: it.id, x: it.x, y: top })
  }
  return map
}

export function applyLayoutToNodes(
  positions: Map<string, LayoutPoint>,
  callback: (id: string, point: LayoutPoint) => void
): void {
  positions.forEach((point) => callback(point.id, point))
}
