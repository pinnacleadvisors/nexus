'use client'

import OrgNode from './OrgNode'
import type { OrgAgent } from '@/lib/org/types'
import { LAYER_META } from '@/lib/org/types'

interface Props {
  root:       OrgAgent
  selected:   OrgAgent | null
  onSelect:   (agent: OrgAgent) => void
  maxDepth?:  number
}

// Vertical connector line between parent and children
function Connector({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="flex flex-col items-center" style={{ width: 2 }}>
      <div className="flex-1" style={{ width: 2, backgroundColor: '#24243e', minHeight: 16 }} />
    </div>
  )
}

function HorizontalBranch({ count }: { count: number }) {
  if (count <= 1) return null
  return (
    <div
      className="relative"
      style={{
        height: 2,
        backgroundColor: '#24243e',
        width: '80%',
        margin: '0 auto',
      }}
    />
  )
}

interface RowProps {
  agents:   OrgAgent[]
  selected: OrgAgent | null
  onSelect: (agent: OrgAgent) => void
  depth:    number
  maxDepth: number
}

function OrgRow({ agents, selected, onSelect, depth, maxDepth }: RowProps) {
  if (agents.length === 0 || depth > maxDepth) return null

  // Group children by their layer for the next row
  const allChildren = agents.flatMap(a => a.children ?? [])

  return (
    <div className="flex flex-col items-center gap-0">
      {/* Layer label */}
      {depth > 0 && agents[0] && (
        <p className="text-xs mb-2 font-medium" style={{ color: LAYER_META[agents[0].layer].color }}>
          {LAYER_META[agents[0].layer].label}{agents.length > 1 ? `s (${agents.length})` : ''}
        </p>
      )}

      {/* Nodes row */}
      <div className="flex items-start gap-3 flex-wrap justify-center">
        {agents.map(agent => (
          <div key={agent.id} className="flex flex-col items-center gap-0">
            <OrgNode
              agent={agent}
              selected={selected?.id === agent.id}
              onSelect={onSelect}
            />
            {(agent.children?.length ?? 0) > 0 && depth < maxDepth && (
              <Connector count={agent.children!.length} />
            )}
          </div>
        ))}
      </div>

      {/* Horizontal branch line if multiple children */}
      {allChildren.length > 1 && depth < maxDepth && (
        <HorizontalBranch count={allChildren.length} />
      )}

      {/* Vertical spacer before next row */}
      {allChildren.length > 0 && depth < maxDepth && (
        <div style={{ height: 16 }} />
      )}

      {/* Next layer */}
      {allChildren.length > 0 && depth < maxDepth && (
        <OrgRow
          agents={allChildren}
          selected={selected}
          onSelect={onSelect}
          depth={depth + 1}
          maxDepth={maxDepth}
        />
      )}
    </div>
  )
}

export default function OrgTree({ root, selected, onSelect, maxDepth = 10 }: Props) {
  return (
    <div className="flex flex-col items-center gap-0 py-4 min-w-max">
      {/* L0 root */}
      <div className="flex flex-col items-center gap-0">
        <OrgNode
          agent={root}
          selected={selected?.id === root.id}
          onSelect={onSelect}
        />
        {(root.children?.length ?? 0) > 0 && (
          <Connector count={root.children!.length} />
        )}
      </div>

      {(root.children?.length ?? 0) > 1 && (
        <HorizontalBranch count={root.children!.length} />
      )}

      {(root.children?.length ?? 0) > 0 && (
        <div style={{ height: 16 }} />
      )}

      {(root.children?.length ?? 0) > 0 && (
        <OrgRow
          agents={root.children!}
          selected={selected}
          onSelect={onSelect}
          depth={1}
          maxDepth={maxDepth}
        />
      )}
    </div>
  )
}
