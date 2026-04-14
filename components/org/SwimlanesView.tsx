'use client'

import type { Swimlane, OrgAgent } from '@/lib/org/types'
import { LAYER_META, STATUS_META } from '@/lib/org/types'
import OrgNode from './OrgNode'

interface Props {
  swimlanes: Swimlane[]
  selected:  OrgAgent | null
  onSelect:  (agent: OrgAgent) => void
}

export default function SwimlanesView({ swimlanes, selected, onSelect }: Props) {
  return (
    <div className="space-y-6">
      {swimlanes.map(lane => (
        <div key={lane.id}>
          {/* Lane header */}
          <div
            className="flex items-center gap-3 px-3 py-2 rounded-t-lg"
            style={{ backgroundColor: '#12121e', borderBottom: '1px solid #24243e' }}
          >
            <div
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: '#6c63ff' }}
            />
            <h3 className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
              {lane.label}
            </h3>
            <span className="text-xs ml-auto" style={{ color: '#55556a' }}>
              {lane.agents.length} agent{lane.agents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Lane body: group by layer */}
          <div
            className="rounded-b-lg p-3"
            style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', borderTop: 'none' }}
          >
            {([0, 1, 2, 3, 4] as const).map(layerNum => {
              const agents = lane.agents.filter(a => a.layer === layerNum)
              if (agents.length === 0) return null
              const meta = LAYER_META[layerNum]
              return (
                <div key={layerNum} className="mb-3 last:mb-0">
                  <p
                    className="text-xs font-medium mb-2 px-1"
                    style={{ color: meta.color }}
                  >
                    {meta.label}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {agents.map(agent => (
                      <OrgNode
                        key={agent.id}
                        agent={agent}
                        selected={selected?.id === agent.id}
                        onSelect={onSelect}
                        compact
                      />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
