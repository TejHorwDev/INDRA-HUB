import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GraphNode, ProjectGraph } from '@shared/types'

const NODE_W = 178
const NODE_H = 44
const GAP_X = 62
const GAP_Y = 10

interface Positioned {
  node: GraphNode
  depth: number
  x: number
  y: number
}

interface Edge {
  from: { x: number; y: number }
  to: { x: number; y: number }
  toId: string
}

function isCollapsible(node: GraphNode): boolean {
  return Boolean(node.children && node.children.length > 0)
}

function buildLayout(root: GraphNode, collapsed: Set<string>) {
  const nodes: Positioned[] = []
  const edges: Edge[] = []
  const cursor = { y: 0 }

  const walk = (node: GraphNode, depth: number): number => {
    const children = collapsed.has(node.id) ? [] : (node.children ?? [])
    const x = depth * (NODE_W + GAP_X)

    if (children.length === 0) {
      const y = cursor.y
      nodes.push({ node, depth, x, y })
      cursor.y += NODE_H + GAP_Y
      return y
    }

    const childYs = children.map((child) => walk(child, depth + 1))
    const y = (childYs[0] + childYs[childYs.length - 1]) / 2
    nodes.push({ node, depth, x, y })
    children.forEach((child, index) => {
      edges.push({
        from: { x: x + NODE_W, y: y + NODE_H / 2 },
        to: { x: (depth + 1) * (NODE_W + GAP_X), y: childYs[index] + NODE_H / 2 },
        toId: child.id
      })
    })
    return y
  }

  walk(root, 0)

  const maxDepth = nodes.reduce((max, entry) => Math.max(max, entry.depth), 0)
  return {
    nodes,
    edges,
    width: (maxDepth + 1) * NODE_W + maxDepth * GAP_X,
    height: Math.max(cursor.y, NODE_H)
  }
}

function kindLabel(kind: GraphNode['kind']): string {
  switch (kind) {
    case 'owner':
      return 'Head developer'
    case 'member':
      return 'Member'
    case 'document':
      return 'Document'
    case 'presentation':
      return 'Presentation'
    case 'group':
      return 'Group'
    default:
      return 'Project'
  }
}

interface ProjectGraphViewProps {
  graph: ProjectGraph
  onOpenDocument: (documentId: string) => void
  onOpenPresentation: (presentationId: string) => void
}

/** Interactive tree: pan, zoom, collapse and selection, drawn from real rows. */
export default function ProjectGraphView({
  graph,
  onOpenDocument,
  onOpenPresentation
}: ProjectGraphViewProps) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selectedId, setSelectedId] = useState(graph.root.id)
  const [view, setView] = useState({ scale: 1, x: 24, y: 16 })
  const drag = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(
    null
  )

  const { nodes, edges, width, height } = useMemo(
    () => buildLayout(graph.root, collapsed),
    [collapsed, graph.root]
  )

  const byId = useMemo(() => new Map(nodes.map((entry) => [entry.node.id, entry])), [nodes])
  const selected = byId.get(selectedId)?.node ?? graph.root

  const fits = useCallback(() => {
    const shell = shellRef.current
    if (!shell) return
    const bounds = shell.getBoundingClientRect()
    const scale = Math.min(
      1,
      (bounds.width - 48) / Math.max(width, 1),
      (bounds.height - 48) / Math.max(height, 1)
    )
    setView({
      scale,
      x: Math.max(16, (bounds.width - width * scale) / 2),
      y: Math.max(16, (bounds.height - height * scale) / 2)
    })
  }, [height, width])

  useEffect(() => {
    if (!selectedId) setSelectedId(graph.root.id)
  }, [graph.root.id, selectedId])

  // Open on the whole tree instead of the top-left corner of a clipped canvas.
  useEffect(() => {
    const frame = requestAnimationFrame(() => fits())
    return () => cancelAnimationFrame(frame)
  }, [fits, graph.root])

  function toggle(id: string) {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function zoomBy(factor: number) {
    setView((current) => {
      const scale = Math.min(2.2, Math.max(0.35, current.scale * factor))
      const shell = shellRef.current
      const bounds = shell?.getBoundingClientRect()
      if (!bounds) return { ...current, scale }
      const centerX = bounds.width / 2
      const centerY = bounds.height / 2
      return {
        scale,
        x: centerX - ((centerX - current.x) / current.scale) * scale,
        y: centerY - ((centerY - current.y) / current.scale) * scale
      }
    })
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest('.graph-node')) return
    drag.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: view.x,
      originY: view.y
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current
    if (!state) return
    setView((current) => ({
      ...current,
      x: state.originX + (event.clientX - state.startX),
      y: state.originY + (event.clientY - state.startY)
    }))
  }

  function onPointerUp() {
    drag.current = null
  }

  return (
    <div className="graph-layout">
      <div className="graph-main">
        <div className="graph-toolbar">
          <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={() => zoomBy(1.15)}>
            Zoom in
          </button>
          <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={() => zoomBy(0.87)}>
            Zoom out
          </button>
          <button type="button" className="btn btn-ghost btn-sm w-auto" onClick={fits}>
            Fit
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm w-auto"
            onClick={() => setView({ scale: 1, x: 24, y: 16 })}
          >
            Reset
          </button>
        </div>
        <div
          className="graph-shell"
          ref={shellRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={(event) => {
            if (event.ctrlKey || event.metaKey) {
              event.preventDefault()
              zoomBy(event.deltaY > 0 ? 0.92 : 1.08)
            }
          }}
        >
          <div
            className="graph-plane"
            style={{
              width,
              height,
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
            }}
          >
          <svg className="graph-edges" width={width} height={height} aria-hidden="true">
            {edges.map((edge) => {
              const midX = (edge.from.x + edge.to.x) / 2
              return (
                <path
                  key={`${edge.from.x}-${edge.from.y}-${edge.toId}`}
                  d={`M ${edge.from.x} ${edge.from.y} C ${midX} ${edge.from.y}, ${midX} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`}
                  className="graph-edge"
                />
              )
            })}
          </svg>

          {nodes.map(({ node, x, y }) => {
            const collapsible = isCollapsible(node)
            const isCollapsed = collapsed.has(node.id)
            return (
              <button
                type="button"
                key={node.id}
                className={`graph-node graph-node--${node.kind}${
                  selected.id === node.id ? ' graph-node--selected' : ''
                }`}
                style={{ left: x, top: y, width: NODE_W, minHeight: NODE_H }}
                onClick={() => setSelectedId(node.id)}
                title={node.label}
              >
                <span className="graph-node-label">{node.label}</span>
                {node.detail && <span className="graph-node-detail">{node.detail}</span>}
                {collapsible && (
                  <span
                    className="graph-toggle"
                    role="button"
                    tabIndex={-1}
                    aria-label={isCollapsed ? 'Expand branch' : 'Collapse branch'}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggle(node.id)
                    }}
                  >
                    {isCollapsed ? '+' : '−'}
                  </span>
                )}
              </button>
            )
          })}
          </div>
        </div>
      </div>

      <aside className="graph-inspector" aria-label="Selected node">
        <div className="micro-label">{kindLabel(selected.kind)}</div>
        <h2 className="graph-inspector-title">{selected.label}</h2>
        {selected.detail && <p className="graph-inspector-detail">{selected.detail}</p>}

        {selected.meta && (
          <dl className="info-list graph-meta">
            {Object.entries(selected.meta).map(([key, value]) => (
              <div className="info-row" key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {selected.kind === 'document' && (
          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={() => onOpenDocument(selected.id.replace('document:', ''))}
          >
            Open document
          </button>
        )}

        {selected.kind === 'presentation' && (
          <button
            type="button"
            className="btn btn-ghost w-full"
            onClick={() => onOpenPresentation(selected.id.replace('presentation:', ''))}
          >
            Open presentation
          </button>
        )}

        <p className="graph-legend">
          <span className="graph-legend-dot graph-legend-dot--owner" /> Head developer
          <span className="graph-legend-dot graph-legend-dot--member" /> Member
          <span className="graph-legend-dot graph-legend-dot--document" /> Document
          <span className="graph-legend-dot graph-legend-dot--presentation" /> Presentation
        </p>
        <p className="graph-hint">Drag to pan · Ctrl + scroll to zoom · click a node to inspect.</p>
      </aside>
    </div>
  )
}
