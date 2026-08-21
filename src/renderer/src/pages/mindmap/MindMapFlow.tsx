import { useEffect, useMemo, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Edge
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { AccentColor, MindMapDoc, MindMapNode } from '@shared/types'
import { MindMapFlowNode, type MindMapFlowData, type MindMapFlowNodeType } from './MindMapNode'
import { layoutTreePositions } from './layout'

const nodeTypes = { mindmap: MindMapFlowNode }

/** 每个一级分支一种颜色（边框 + 连线曲线共用），循环使用；随强调色主题切换 */
const BRANCH_PALETTES: Record<AccentColor, string[]> = {
  orange: ['#f97316', '#38bdf8', '#34d399', '#fbbf24', '#f472b6', '#2dd4bf', '#fb7185', '#a3e635'],
  blue: ['#3b82f6', '#f59e0b', '#10b981', '#22d3ee', '#ec4899', '#84cc16', '#fb923c', '#14b8a6']
}

function currentAccent(): AccentColor {
  return document.documentElement.dataset.accent === 'blue' ? 'blue' : 'orange'
}

function buildNodesEdges(
  root: MindMapNode,
  layout: Map<string, { x: number; y: number }>,
  onToggleCollapse: (id: string) => void,
  palette: string[]
): { nodes: MindMapFlowNodeType[]; edges: Edge[] } {
  const nodes: MindMapFlowNodeType[] = []
  const edges: Edge[] = []

  const add = (node: MindMapNode, depth: number, hidden: boolean, branchColor: string): void => {
    const visible = !hidden
    if (visible) {
      const laid = layout.get(node.id)
      const data: MindMapFlowData = {
        node,
        depth,
        collapsed: !!node.collapsed,
        hasChildren: (node.children?.length ?? 0) > 0,
        onToggleCollapse,
        branchColor
      }
      nodes.push({
        id: node.id,
        type: 'mindmap',
        position: { x: node.x ?? laid?.x ?? 0, y: node.y ?? laid?.y ?? 0 },
        draggable: true,
        selectable: true,
        data
      })
    }
    const childHidden = hidden || (visible && !!node.collapsed)
    let ci = 0
    for (const c of node.children ?? []) {
      // 根节点的每个子分支分配不同颜色，子树内全部继承该颜色
      const color = depth === 0 ? palette[ci % palette.length] : branchColor
      ci++
      add(c, depth + 1, childHidden, color)
      if (!childHidden && c.parentId) {
        // 连线宽度随层级递减：根→一级最粗，越深越细，强化层级视觉
        const width = depth === 0 ? 2.5 : depth === 1 ? 1.6 : 1.1
        edges.push({
          id: `${c.parentId}-${c.id}`,
          source: c.parentId,
          target: c.id,
          type: 'default',
          style: { stroke: color, strokeWidth: width }
        })
      }
    }
  }

  add(root, 0, false, palette[0])
  return { nodes, edges }
}

interface FlowProps {
  doc: MindMapDoc | null
  onSelect: (id: string | null) => void
  onToggleCollapse: (id: string) => void
  onMoveNode: (id: string, x: number, y: number) => void
}

function MindMapCanvas({ doc, onSelect, onToggleCollapse, onMoveNode }: FlowProps): React.JSX.Element {
  const [nodes, setNodes, onNodesChange] = useNodesState<MindMapFlowNodeType>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [accent, setAccent] = useState<AccentColor>(currentAccent)

  // 强调色切换时刷新分支配色
  useEffect(() => {
    const handler = (e: Event): void => {
      const next = (e as CustomEvent<AccentColor>).detail
      setAccent(next === 'blue' ? 'blue' : 'orange')
    }
    window.addEventListener('vs-accent', handler)
    return () => window.removeEventListener('vs-accent', handler)
  }, [])

  const palette = BRANCH_PALETTES[accent]

  const layout = useMemo(() => {
    if (!doc) return new Map<string, { x: number; y: number }>()
    const m = new Map<string, { x: number; y: number }>()
    layoutTreePositions(doc.root).forEach((p) => m.set(p.id, p))
    return m
  }, [doc])

  useEffect(() => {
    if (!doc) {
      setNodes([])
      setEdges([])
      return
    }
    const built = buildNodesEdges(doc.root, layout, onToggleCollapse, palette)
    setNodes(built.nodes)
    setEdges(built.edges)
  }, [doc, layout, onToggleCollapse, palette, setNodes, setEdges])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={(_e, node) => onMoveNode(node.id, node.position.x, node.position.y)}
      onNodeClick={(_e, node) => onSelect(node.id)}
      onPaneClick={() => onSelect(null)}
      nodesConnectable={false}
      deleteKeyCode={null}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.15}
      maxZoom={2.5}
      proOptions={{ hideAttribution: true }}
      className="bg-[var(--mm-bg)]"
    >
      <Background variant={BackgroundVariant.Dots} gap={26} size={1.5} color="var(--mm-dot)" />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        pannable
        zoomable
        style={{ width: 150, height: 100 }}
        maskColor="var(--mm-mask)"
        maskStrokeColor="var(--accent-text)"
        maskStrokeWidth={1.5}
        nodeColor={() => palette[0]}
        className="!bg-[var(--mm-minimap)]"
      />
    </ReactFlow>
  )
}

export default function MindMapFlow(props: FlowProps): React.JSX.Element {
  return (
    <ReactFlowProvider>
      <MindMapCanvas {...props} />
    </ReactFlowProvider>
  )
}