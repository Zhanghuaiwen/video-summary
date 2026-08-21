import type { MindMapNode } from './types'

export const MAX_DEPTH = 6
export const MAX_TOTAL_NODES = 240

function toNum(v: unknown): number | undefined {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : undefined
}

/**
 * 把任意结构化对象安全转换为 MindMapNode 树。
 * 用于 LLM 输出与导入文件的统一清洗。
 */
export function sanitizeTreeNode(
  raw: unknown,
  parentId: string | null,
  depth = 0,
  budget: { left: number } = { left: MAX_TOTAL_NODES }
): MindMapNode | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (depth > MAX_DEPTH || budget.left <= 0) return null
  const title = typeof o['title'] === 'string' ? (o['title'] as string).trim() : ''
  if (!title) return null
  budget.left--

  const rawTime = o['timeRange'] as Record<string, unknown> | undefined
  const start = toNum(rawTime?.start ?? o['start'])
  const end = toNum(rawTime?.end ?? o['end'])
  const timeRange = start !== undefined && end !== undefined && end >= start ? { start, end } : undefined

  const node: MindMapNode = {
    id: typeof o['id'] === 'string' ? o['id'] : crypto.randomUUID(),
    parentId,
    title: title.slice(0, 80),
    summary: typeof o['summary'] === 'string' && (o['summary'] as string).trim()
      ? (o['summary'] as string).trim().slice(0, 800)
      : undefined,
    content: typeof o['content'] === 'string' && (o['content'] as string).trim()
      ? (o['content'] as string).trim().slice(0, 3000)
      : undefined,
    keywords: Array.isArray(o['keywords'])
      ? (o['keywords'] as unknown[]).filter((k): k is string => typeof k === 'string' && k.trim().length > 0).map((k) => k.trim().slice(0, 40)).slice(0, 10)
      : undefined,
    timeRange,
    children: []
  }

  if (Array.isArray(o['children'])) {
    for (const c of o['children'] as unknown[]) {
      const child = sanitizeTreeNode(c, node.id, depth + 1, budget)
      if (child) node.children!.push(child)
    }
    if (node.children!.length === 0) delete node.children
  } else {
    delete node.children
  }

  return node
}

export function countNodes(node: MindMapNode | null | undefined): number {
  if (!node) return 0
  let n = 1
  if (node.children) for (const c of node.children) n += countNodes(c)
  return n
}

/** 前序遍历 */
export function walk(node: MindMapNode | null | undefined, fn: (n: MindMapNode, depth: number) => void, depth = 0): void {
  if (!node) return
  fn(node, depth)
  if (node.children) for (const c of node.children) walk(c, fn, depth + 1)
}

export function findNode(root: MindMapNode | null | undefined, id: string): MindMapNode | null {
  let hit: MindMapNode | null = null
  walk(root, (n) => {
    if (!hit && n.id === id) hit = n
  })
  return hit
}

export function getNodesMap(root: MindMapNode | null | undefined): Map<string, MindMapNode> {
  const map = new Map<string, MindMapNode>()
  walk(root, (n) => map.set(n.id, n))
  return map
}

export function flattenTree(root: MindMapNode | null | undefined): MindMapNode[] {
  const out: MindMapNode[] = []
  walk(root, (n) => out.push(n))
  return out
}

export function removeNodeById(root: MindMapNode, id: string): MindMapNode | null {
  if (root.id === id) return null
  const walkMut = (node: MindMapNode): boolean => {
    if (!node.children) return false
    const idx = node.children.findIndex((c) => c.id === id)
    if (idx >= 0) {
      node.children.splice(idx, 1)
      return true
    }
    for (const c of node.children) if (walkMut(c)) return true
    return false
  }
  const copy: MindMapNode = structuredClone(root)
  walkMut(copy)
  return copy
}

export function insertChild(root: MindMapNode, parentId: string, child: MindMapNode): MindMapNode {
  const copy: MindMapNode = structuredClone(root)
  const parent = findNode(copy, parentId)
  if (parent) {
    if (!parent.children) parent.children = []
    parent.children.push(child)
  }
  return copy
}

export function reparentNode(root: MindMapNode, nodeId: string, newParentId: string): MindMapNode {
  if (nodeId === root.id || nodeId === newParentId) return root
  const removed = removeNodeById(root, nodeId)
  if (!removed) return root
  const node = findNode(removed, nodeId)
  if (!node) return root
  return insertChild(removed, newParentId, node)
}

export function updateNodeById(root: MindMapNode, id: string, patch: Partial<MindMapNode>): MindMapNode {
  const copy: MindMapNode = structuredClone(root)
  const node = findNode(copy, id)
  if (node) Object.assign(node, patch)
  return copy
}