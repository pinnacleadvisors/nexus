'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect, useCallback } from 'react'
import {
  Share2,
  RefreshCw,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  SlidersHorizontal,
  ExternalLink,
  Loader2,
  GitBranch,
} from 'lucide-react'
import type { GraphData, GraphNode, NodeType } from '@/lib/graph/types'
import { NODE_COLORS, NODE_TYPE_LABELS } from '@/lib/graph/types'

// ── Dynamic 3D scene (no SSR — WebGL is browser-only) ────────────────────────
const GraphScene = dynamic(() => import('@/components/graph/GraphScene'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center w-full h-full" style={{ backgroundColor: '#050508' }}>
      <Loader2 size={24} className="animate-spin" style={{ color: '#6c63ff' }} />
    </div>
  ),
})

// ── Layout modes ──────────────────────────────────────────────────────────────
type LayoutMode = 'force' | 'hierarchical' | 'radial' | 'cluster-grid'

const LAYOUT_LABELS: Record<LayoutMode, string> = {
  'force':        'Force-directed',
  'hierarchical': 'Hierarchical',
  'radial':       'Radial',
  'cluster-grid': 'Cluster grid',
}

// Rearrange positions client-side based on layout mode
function applyLayout(nodes: GraphNode[], mode: LayoutMode): GraphNode[] {
  if (mode === 'force') return nodes   // use server-computed positions

  return nodes.map((n, i) => {
    let x = n.position3d.x, y = n.position3d.y, z = n.position3d.z

    if (mode === 'hierarchical') {
      // Layer by node type priority
      const layers: Partial<Record<NodeType, number>> = {
        business: 0, project: 1, milestone: 2, agent: 3,
        workflow: 2, tool: 4, repository: 3, asset: 5, prompt: 4, skill: 5,
        memory_moc: 0, memory_entity: 2, memory_atom: 4, memory_doc: 3,
      }
      const layer = layers[n.type] ?? 3
      y = (layer - 2.5) * 35
      x = (i % 8 - 4) * 20
      z = Math.floor(i / 8) * 20 - 40
    } else if (mode === 'radial') {
      // Radial rings by type
      const rings: Partial<Record<NodeType, number>> = {
        business: 0, project: 40, milestone: 70, agent: 55,
        workflow: 85, tool: 100, repository: 60, asset: 95, prompt: 80, skill: 110,
        memory_moc: 0, memory_entity: 50, memory_atom: 100, memory_doc: 75,
      }
      const r     = rings[n.type] ?? 80
      const angle = (i / nodes.length) * Math.PI * 2
      x = Math.cos(angle) * r
      z = Math.sin(angle) * r
      y = (n.clusterId - 3) * 15
    } else if (mode === 'cluster-grid') {
      const cols = 5
      x = (n.clusterId % cols - 2) * 55 + (i % 5) * 10
      y = (Math.floor(n.clusterId / cols) - 1) * 55 + Math.floor(i / 5) * 8
      z = (i % 3 - 1) * 8
    }

    return { ...n, position3d: { x, y, z } }
  })
}

// ── Node detail panel ─────────────────────────────────────────────────────────
// `placement` controls fixed position + omits the close button when the panel
// represents a transient hover (no click needed to dismiss). Bottom-right is
// used for hover-only display so it doesn't collide with the top-right
// selected-node panel.
function NodeDetail({
  node,
  placement = 'top-right',
  onClose,
}: {
  node:       GraphNode
  placement?: 'top-right' | 'bottom-right'
  onClose?:   () => void
}) {
  const color = NODE_COLORS[node.type] ?? '#6b7280'
  const label = NODE_TYPE_LABELS[node.type] ?? node.type
  const metaEntries = Object.entries(node.metadata).slice(0, 8)
  const positionClass = placement === 'bottom-right' ? 'bottom-4 right-4' : 'top-4 right-4'

  return (
    <div
      className={`absolute ${positionClass} w-72 rounded-xl p-4 z-10 space-y-3`}
      style={{ backgroundColor: '#0d0d14', border: `1px solid ${color}40` }}
    >
      {/* Header */}
      <div className="flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center text-[10px] font-bold"
          style={{ backgroundColor: `${color}20`, color }}
        >
          {label.slice(0, 3).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate" style={{ color: '#e8e8f0' }}>
            {node.label}
          </p>
          <p className="text-xs mt-0.5" style={{ color }}>
            {label}
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} style={{ color: '#55556a' }}>
            <X size={14} />
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'Connections', value: node.connections },
          { label: 'PageRank', value: (node.pageRank * 100).toFixed(0) + '%' },
          { label: 'Cluster', value: node.clusterId },
        ].map(s => (
          <div key={s.label} className="rounded-lg p-2 text-center" style={{ backgroundColor: '#12121e' }}>
            <p className="text-sm font-bold" style={{ color: '#e8e8f0' }}>{s.value}</p>
            <p className="text-[10px] mt-0.5" style={{ color: '#55556a' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Metadata */}
      {metaEntries.length > 0 && (
        <div>
          <p className="text-[10px] font-medium mb-1.5" style={{ color: '#55556a' }}>Metadata</p>
          <div className="space-y-1">
            {metaEntries.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between text-[11px]">
                <span style={{ color: '#55556a' }}>{k}</span>
                <span className="truncate ml-2 max-w-[140px]" style={{ color: '#9090b0' }}>
                  {String(v)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Created */}
      <p className="text-[10px]" style={{ color: '#3d3d60' }}>
        Created {new Date(node.createdAt).toLocaleDateString()}
      </p>
    </div>
  )
}

// ── Legend ────────────────────────────────────────────────────────────────────
function Legend() {
  const entries = Object.entries(NODE_COLORS) as [NodeType, string][]
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([type, color]) => (
        <div key={type} className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color }} />
          <span className="text-[10px]" style={{ color: '#55556a' }}>
            {NODE_TYPE_LABELS[type]}
          </span>
        </div>
      ))}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function GraphPage() {
  const [graph,           setGraph]           = useState<GraphData | null>(null)
  const [loading,         setLoading]         = useState(true)
  const [error,           setError]           = useState('')
  const [selectedNode,    setSelectedNode]    = useState<GraphNode | null>(null)
  const [hoveredNode,     setHoveredNode]     = useState<GraphNode | null>(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [filteredTypes,   setFilteredTypes]   = useState<Set<NodeType>>(new Set())
  const [layoutMode,      setLayoutMode]      = useState<LayoutMode>('force')
  const [sidebarOpen,     setSidebarOpen]     = useState(true)
  // Temporal replay state
  const [replayEnabled,   setReplayEnabled]   = useState(false)
  const [replayValue,     setReplayValue]     = useState(100)   // 0–100 = oldest–newest

  const fetchGraph = useCallback(async (rebuild = false) => {
    setLoading(true)
    setError('')
    const ctrl  = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res  = await fetch(`/api/graph${rebuild ? '?rebuild=1' : ''}`, { signal: ctrl.signal })
      if (!res.ok) throw new Error(`Server error ${res.status}`)
      const data = await res.json() as GraphData
      setGraph(data)
    } catch (err) {
      const msg = (err as Error).name === 'AbortError'
        ? 'Graph request timed out after 20s. Check the /api/graph endpoint.'
        : (err as Error).message
      setError(msg)
    } finally {
      clearTimeout(timer)
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchGraph() }, [fetchGraph])

  // Derive displayable graph (layout + temporal filter)
  const displayGraph: GraphData | null = (() => {
    if (!graph) return null

    let nodes = applyLayout(graph.nodes, layoutMode)

    // Temporal filter: include only nodes created before the replay cursor
    if (replayEnabled) {
      const sorted = [...graph.nodes]
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
      const cutoffIdx = Math.ceil((replayValue / 100) * sorted.length)
      const visibleIds = new Set(sorted.slice(0, cutoffIdx).map(n => n.id))
      nodes = nodes.filter(n => visibleIds.has(n.id))
    }

    return { ...graph, nodes }
  })()

  function toggleTypeFilter(type: NodeType) {
    setFilteredTypes(prev => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  const nodeTypes = graph
    ? ([...new Set(graph.nodes.map(n => n.type))] as NodeType[])
    : []

  return (
    <div className="flex h-full overflow-hidden" style={{ backgroundColor: '#050508' }}>

      {/* Sidebar */}
      {sidebarOpen && (
        <aside
          className="w-64 shrink-0 flex flex-col overflow-y-auto"
          style={{ backgroundColor: '#0d0d14', borderRight: '1px solid #1a1a2e' }}
        >
          {/* Header */}
          <div className="px-4 py-4 space-y-1" style={{ borderBottom: '1px solid #1a1a2e' }}>
            <div className="flex items-center gap-2">
              <Share2 size={14} style={{ color: '#6c63ff' }} />
              <h2 className="text-sm font-bold" style={{ color: '#e8e8f0' }}>Knowledge Graph</h2>
            </div>
            {graph && (
              <p className="text-xs" style={{ color: '#55556a' }}>
                {graph.nodeCount} nodes · {graph.edgeCount} edges
              </p>
            )}
          </div>

          {/* Search */}
          <div className="px-3 py-3" style={{ borderBottom: '1px solid #1a1a2e' }}>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg" style={{ backgroundColor: '#12121e' }}>
              <Search size={12} style={{ color: '#55556a' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search nodes…"
                className="flex-1 bg-transparent text-xs outline-none"
                style={{ color: '#e8e8f0' }}
              />
              {searchQuery && (
                <button onClick={() => setSearchQuery('')} style={{ color: '#55556a' }}>
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* Node type filters */}
          <div className="px-3 py-3 space-y-2" style={{ borderBottom: '1px solid #1a1a2e' }}>
            <p className="text-[10px] font-medium" style={{ color: '#55556a' }}>NODE TYPES</p>
            {nodeTypes.map(type => {
              const active = filteredTypes.has(type)
              const color  = NODE_COLORS[type]
              return (
                <button
                  key={type}
                  onClick={() => toggleTypeFilter(type)}
                  className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-xs transition-colors"
                  style={{
                    backgroundColor: active ? `${color}20` : 'transparent',
                    color:           active ? color : '#55556a',
                  }}
                >
                  <div
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: active ? color : '#2a2a40' }}
                  />
                  {NODE_TYPE_LABELS[type]}
                  <span className="ml-auto text-[10px]" style={{ color: '#3d3d60' }}>
                    {graph?.nodes.filter(n => n.type === type).length ?? 0}
                  </span>
                </button>
              )
            })}
            {filteredTypes.size > 0 && (
              <button
                onClick={() => setFilteredTypes(new Set())}
                className="w-full text-[10px] py-1"
                style={{ color: '#6c63ff' }}
              >
                Clear filter
              </button>
            )}
          </div>

          {/* Layout mode */}
          <div className="px-3 py-3 space-y-2" style={{ borderBottom: '1px solid #1a1a2e' }}>
            <div className="flex items-center gap-1.5">
              <Layers size={11} style={{ color: '#55556a' }} />
              <p className="text-[10px] font-medium" style={{ color: '#55556a' }}>LAYOUT</p>
            </div>
            {(Object.keys(LAYOUT_LABELS) as LayoutMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setLayoutMode(mode)}
                className="flex items-center gap-2 w-full rounded-lg px-2 py-1.5 text-xs transition-colors"
                style={{
                  backgroundColor: layoutMode === mode ? '#1a1a2e' : 'transparent',
                  color:           layoutMode === mode ? '#e8e8f0' : '#55556a',
                }}
              >
                {LAYOUT_LABELS[mode]}
              </button>
            ))}
          </div>

          {/* Temporal replay */}
          <div className="px-3 py-3 space-y-2" style={{ borderBottom: '1px solid #1a1a2e' }}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Clock size={11} style={{ color: '#55556a' }} />
                <p className="text-[10px] font-medium" style={{ color: '#55556a' }}>TEMPORAL REPLAY</p>
              </div>
              <button
                onClick={() => setReplayEnabled(e => !e)}
                className="text-[10px] px-2 py-0.5 rounded"
                style={{
                  backgroundColor: replayEnabled ? '#1a2e1a' : '#12121e',
                  color:           replayEnabled ? '#4ade80'  : '#55556a',
                }}
              >
                {replayEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            {replayEnabled && (
              <>
                <input
                  type="range"
                  min={1}
                  max={100}
                  value={replayValue}
                  onChange={e => setReplayValue(Number(e.target.value))}
                  className="w-full accent-purple-500"
                />
                <p className="text-[10px] text-center" style={{ color: '#55556a' }}>
                  Showing oldest {replayValue}% of nodes
                </p>
              </>
            )}
          </div>

          {/* Stats */}
          {graph && (
            <div className="px-3 py-3 space-y-2">
              <div className="flex items-center gap-1.5">
                <SlidersHorizontal size={11} style={{ color: '#55556a' }} />
                <p className="text-[10px] font-medium" style={{ color: '#55556a' }}>GRAPH STATS</p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: 'Nodes',    value: displayGraph?.nodes.length ?? 0 },
                  { label: 'Edges',    value: graph.edgeCount },
                  { label: 'Clusters', value: new Set(graph.nodes.map(n => n.clusterId)).size },
                  { label: 'Types',    value: nodeTypes.length },
                ].map(s => (
                  <div key={s.label} className="rounded-lg p-2 text-center" style={{ backgroundColor: '#12121e' }}>
                    <p className="text-sm font-bold" style={{ color: '#e8e8f0' }}>{s.value}</p>
                    <p className="text-[10px]" style={{ color: '#3d3d60' }}>{s.label}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* MCP tool info */}
          <div className="px-3 py-3 mt-auto" style={{ borderTop: '1px solid #1a1a2e' }}>
            <div className="flex items-center gap-1.5 mb-2">
              <GitBranch size={11} style={{ color: '#6c63ff' }} />
              <p className="text-[10px] font-medium" style={{ color: '#6c63ff' }}>MCP TOOL</p>
            </div>
            <p className="text-[10px] leading-relaxed mb-2" style={{ color: '#3d3d60' }}>
              Agents can query this graph for context before tasks — reducing token usage by up to 70×.
            </p>
            <code className="block text-[9px] px-2 py-1.5 rounded break-all" style={{ backgroundColor: '#12121e', color: '#55556a' }}>
              /api/graph/mcp
            </code>
          </div>
        </aside>
      )}

      {/* Sidebar toggle */}
      <button
        onClick={() => setSidebarOpen(o => !o)}
        className="absolute left-0 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-5 h-10 rounded-r-lg"
        style={{ backgroundColor: '#1a1a2e', color: '#55556a', left: sidebarOpen ? '256px' : '0px' }}
      >
        {sidebarOpen ? <ChevronLeft size={12} /> : <ChevronRight size={12} />}
      </button>

      {/* Main 3D canvas area */}
      <div className="flex-1 relative">
        {/* Toolbar */}
        <div
          className="absolute top-3 left-3 right-3 z-10 flex items-center gap-2"
        >
          <div
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
            style={{ backgroundColor: 'rgba(13,13,20,0.85)', border: '1px solid #1a1a2e', color: '#9090b0' }}
          >
            <Share2 size={12} style={{ color: '#6c63ff' }} />
            Relational Knowledge Graph
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => fetchGraph(true)}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: 'rgba(13,13,20,0.85)', border: '1px solid #1a1a2e', color: '#9090b0' }}
            >
              <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
              Rebuild
            </button>
            <a
              href="/api/graph"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg"
              style={{ backgroundColor: 'rgba(13,13,20,0.85)', border: '1px solid #1a1a2e', color: '#9090b0' }}
            >
              <ExternalLink size={11} />
              JSON
            </a>
          </div>
        </div>

        {/* Legend */}
        <div
          className="absolute bottom-3 left-3 z-10 px-3 py-2 rounded-lg"
          style={{ backgroundColor: 'rgba(13,13,20,0.85)', border: '1px solid #1a1a2e' }}
        >
          <Legend />
        </div>

        {/* Built-at timestamp — moved to top-right corner so the hover detail
            card can own the bottom-right slot without overlap. */}
        {graph && !selectedNode && (
          <div
            className="absolute top-3 right-3 z-10 text-[10px] px-2 py-1 rounded"
            style={{ backgroundColor: 'rgba(13,13,20,0.7)', color: '#3d3d60' }}
          >
            Built {new Date(graph.builtAt).toLocaleTimeString()}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-sm px-6 py-3 rounded-xl" style={{ backgroundColor: '#2e1a1a', color: '#f87171' }}>
              {error}
            </p>
          </div>
        )}

        {/* Initial loading skeleton */}
        {loading && !graph && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10">
            <Loader2 size={28} className="animate-spin" style={{ color: '#6c63ff' }} />
            <p className="text-sm" style={{ color: '#55556a' }}>Building knowledge graph…</p>
          </div>
        )}

        {/* 3D scene */}
        {displayGraph && (
          <GraphScene
            data={displayGraph}
            selectedId={selectedNode?.id ?? null}
            filteredTypes={filteredTypes}
            searchQuery={searchQuery}
            onNodeClick={n => setSelectedNode(prev => prev?.id === n.id ? null : n)}
            onNodeHover={setHoveredNode}
          />
        )}

        {/* Selected node panel (top-right) — sticky until dismissed. */}
        {selectedNode && (
          <NodeDetail
            node={selectedNode}
            placement="top-right"
            onClose={() => setSelectedNode(null)}
          />
        )}

        {/* Hover detail card (bottom-right) — fixed-size readable detail for
            the node currently under the cursor. Hidden when the same node is
            already selected (top-right card carries the same info). */}
        {hoveredNode && hoveredNode.id !== selectedNode?.id && (
          <NodeDetail node={hoveredNode} placement="bottom-right" />
        )}
      </div>
    </div>
  )
}
