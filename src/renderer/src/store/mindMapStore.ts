import { create } from 'zustand'
import type { MindMapDoc, MindMapNode } from '@shared/types'
import { insertChild, removeNodeById, reparentNode, updateNodeById, walk } from '@shared/mindmap-util'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export function createEmptyNode(title = '新节点', parentId: string | null = null): MindMapNode {
  return { id: crypto.randomUUID(), parentId, title, children: [] }
}

interface MindMapState {
  doc: MindMapDoc | null
  selectedId: string | null
  dirty: boolean
  saveState: SaveState
  lastSavedAt: string | null
  loadDoc: (doc: MindMapDoc | null) => void
  select: (id: string | null) => void
  replaceDoc: (doc: MindMapDoc) => void
  updateNode: (id: string, patch: Partial<MindMapNode>) => void
  addChild: (parentId: string) => void
  removeNode: (id: string) => void
  reparent: (nodeId: string, newParentId: string) => void
  toggleCollapse: (id: string) => void
  applyLayout: (positions: Map<string, { x: number; y: number }>) => void
  setAllCollapsed: (collapsed: boolean) => void
  moveNode: (id: string, x: number, y: number) => void
  markSaved: (doc: MindMapDoc) => void
  setSaveState: (s: SaveState) => void
}

export const useMindMapStore = create<MindMapState>((set) => ({
  doc: null,
  selectedId: null,
  dirty: false,
  saveState: 'idle',
  lastSavedAt: null,

  loadDoc: (doc) =>
    set({ doc, selectedId: null, dirty: false, saveState: 'idle', lastSavedAt: doc?.updatedAt ?? null }),

  select: (selectedId) => set({ selectedId }),

  replaceDoc: (doc) => set({ doc, selectedId: null, dirty: true, saveState: 'saving' }),

  updateNode: (id, patch) =>
    set((s) => {
      if (!s.doc) return s
      return { ...s, doc: { ...s.doc, root: updateNodeById(s.doc.root, id, patch) }, dirty: true }
    }),

  addChild: (parentId) =>
    set((s) => {
      if (!s.doc) return s
      const child = createEmptyNode('新节点', parentId)
      const root = insertChild(s.doc.root, parentId, child)
      return { ...s, doc: { ...s.doc, root }, selectedId: child.id, dirty: true }
    }),

  removeNode: (id) =>
    set((s) => {
      if (!s.doc || s.doc.root.id === id) return s
      const root = removeNodeById(s.doc.root, id)
      if (!root) return s
      const next: MindMapState = { ...s, doc: { ...s.doc, root }, dirty: true }
      if (s.selectedId === id) next.selectedId = null
      return next
    }),

  reparent: (nodeId, newParentId) =>
    set((s) => {
      if (!s.doc) return s
      return { ...s, doc: { ...s.doc, root: reparentNode(s.doc.root, nodeId, newParentId) }, dirty: true }
    }),

  toggleCollapse: (id) =>
    set((s) => {
      if (!s.doc) return s
      const node = findInTree(s.doc.root, id)
      if (!node) return s
      const root = updateNodeById(s.doc.root, id, { collapsed: !node.collapsed })
      return { ...s, doc: { ...s.doc, root }, dirty: true }
    }),

  applyLayout: (positions) =>
    set((s) => {
      if (!s.doc) return s
      const root = structuredClone(s.doc.root)
      walk(root, (n) => {
        const p = positions.get(n.id)
        if (p) {
          n.x = p.x
          n.y = p.y
        }
      })
      return { ...s, doc: { ...s.doc, root }, dirty: true }
    }),

  setAllCollapsed: (collapsed) =>
    set((s) => {
      if (!s.doc) return s
      const root = structuredClone(s.doc.root)
      walk(root, (n) => {
        if ((n.children?.length ?? 0) > 0) n.collapsed = collapsed
      })
      return { ...s, doc: { ...s.doc, root }, dirty: true }
    }),

  moveNode: (id, x, y) =>
    set((s) => {
      if (!s.doc) return s
      return { ...s, doc: { ...s.doc, root: updateNodeById(s.doc.root, id, { x, y }) }, dirty: true }
    }),

  markSaved: (doc) =>
    set({ doc, dirty: false, saveState: 'saved', lastSavedAt: doc.updatedAt }),

  setSaveState: (saveState) => set({ saveState })
}))

function findInTree(node: MindMapNode, id: string): MindMapNode | null {
  if (node.id === id) return node
  for (const c of node.children ?? []) {
    const hit = findInTree(c, id)
    if (hit) return hit
  }
  return null
}