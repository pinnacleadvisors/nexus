import { format, parseISO } from 'date-fns'
import type { Milestone } from '@/lib/types'
import { CheckCircle, Circle, Clock } from 'lucide-react'

const STATUS_CONFIG = {
  'pending': { icon: Circle, color: '#55556a', label: 'Pending' },
  'in-progress': { icon: Clock, color: '#6c63ff', label: 'In Progress' },
  'done': { icon: CheckCircle, color: '#22c55e', label: 'Done' },
}

const PHASE_LABELS: Record<number, string> = {
  1: 'Foundation',
  2: 'Build',
  3: 'Launch',
  4: 'Growth',
}

interface Props {
  milestones: Milestone[]
}

export default function MilestoneTimeline({ milestones }: Props) {
  if (milestones.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
        <div
          className="w-12 h-12 rounded-xl flex items-center justify-center"
          style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
        >
          <Clock size={22} style={{ color: '#55556a' }} />
        </div>
        <div>
          <p className="font-medium mb-1" style={{ color: '#e8e8f0' }}>
            Milestones will appear here
          </p>
          <p className="text-sm" style={{ color: '#55556a' }}>
            As you discuss your idea, the agent will define project milestones automatically.
          </p>
        </div>
      </div>
    )
  }

  // Group by phase
  const byPhase = milestones.reduce<Record<number, Milestone[]>>((acc, m) => {
    if (!acc[m.phase]) acc[m.phase] = []
    acc[m.phase].push(m)
    return acc
  }, {})

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-6">
      {Object.entries(byPhase).map(([phaseStr, phaseMilestones]) => {
        const phase = Number(phaseStr)
        return (
          <div key={phase}>
            <div className="flex items-center gap-2 mb-3">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full"
                style={{ backgroundColor: '#1a1a2e', color: '#6c63ff', border: '1px solid #24243e' }}
              >
                Phase {phase} — {PHASE_LABELS[phase] ?? 'Other'}
              </span>
            </div>

            <div className="relative">
              {/* Vertical line */}
              <div
                className="absolute left-3 top-4 bottom-0 w-px"
                style={{ backgroundColor: '#24243e' }}
              />

              <div className="space-y-4">
                {phaseMilestones.map(milestone => {
                  const cfg = STATUS_CONFIG[milestone.status]
                  const Icon = cfg.icon
                  return (
                    <div key={milestone.id} className="flex gap-4 relative">
                      {/* Icon on the line */}
                      <div className="shrink-0 z-10" style={{ color: cfg.color }}>
                        <Icon size={14} className="mt-1" />
                      </div>

                      {/* Card */}
                      <div
                        className="flex-1 rounded-xl p-3 text-sm"
                        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <span className="font-medium" style={{ color: '#e8e8f0' }}>
                            {milestone.title}
                          </span>
                          {milestone.targetDate && (
                            <span
                              className="text-xs shrink-0"
                              style={{ color: '#55556a' }}
                            >
                              {format(parseISO(milestone.targetDate), 'MMM d')}
                            </span>
                          )}
                        </div>
                        <p style={{ color: '#9090b0' }}>{milestone.description}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
