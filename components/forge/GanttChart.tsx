import { addWeeks, format, startOfWeek } from 'date-fns'
import type { Milestone, GanttTask } from '@/lib/types'

const PHASE_COLORS: Record<number, { bg: string; border: string }> = {
  1: { bg: 'rgba(108, 99, 255, 0.3)', border: '#6c63ff' },
  2: { bg: 'rgba(59, 130, 246, 0.3)', border: '#3b82f6' },
  3: { bg: 'rgba(34, 197, 94, 0.3)', border: '#22c55e' },
  4: { bg: 'rgba(245, 158, 11, 0.3)', border: '#f59e0b' },
}

const PHASE_LABELS: Record<number, string> = {
  1: 'Foundation',
  2: 'Build',
  3: 'Launch',
  4: 'Growth',
}

const TOTAL_WEEKS = 16

function milestonesToGantt(milestones: Milestone[]): GanttTask[] {
  const today = startOfWeek(new Date())
  const tasks: GanttTask[] = []
  let weekCursor = 0

  const byPhase = milestones.reduce<Record<number, Milestone[]>>((acc, m) => {
    if (!acc[m.phase]) acc[m.phase] = []
    acc[m.phase].push(m)
    return acc
  }, {})

  Object.entries(byPhase).forEach(([phaseStr, phaseMilestones]) => {
    const phase = Number(phaseStr)
    phaseMilestones.forEach((m, i) => {
      const startWeek = weekCursor
      const duration = phase <= 2 ? 3 : 2
      tasks.push({
        id: m.id,
        name: m.title,
        startWeek,
        durationWeeks: duration,
        phase,
        status: m.status === 'in-progress' ? 'active' : m.status,
        agent: `Agent-${phase}${i + 1}`,
      })
      // Stagger tasks — some run in parallel within a phase
      weekCursor = i % 2 === 0 ? weekCursor : weekCursor + duration
    })
    weekCursor += 3 // gap between phases
  })

  return tasks
}

interface Props {
  milestones: Milestone[]
}

export default function GanttChart({ milestones }: Props) {
  const tasks = milestonesToGantt(milestones)
  const today = startOfWeek(new Date())

  const weeks = Array.from({ length: TOTAL_WEEKS }, (_, i) => ({
    index: i,
    label: format(addWeeks(today, i), 'MMM d'),
  }))

  return (
    <div className="flex-1 overflow-auto p-4">
      <div className="min-w-[700px]">
        {/* Header */}
        <div className="flex mb-2">
          <div className="w-48 shrink-0" />
          <div className="flex flex-1">
            {weeks.map(w => (
              <div
                key={w.index}
                className="flex-1 text-center text-xs px-0.5 truncate"
                style={{ color: '#55556a' }}
              >
                {w.index % 2 === 0 ? w.label : ''}
              </div>
            ))}
          </div>
        </div>

        {/* Rows */}
        <div className="space-y-2">
          {tasks.map(task => {
            const colors = PHASE_COLORS[task.phase] ?? PHASE_COLORS[1]
            return (
              <div key={task.id} className="flex items-center gap-2">
                {/* Task name */}
                <div className="w-48 shrink-0 pr-3">
                  <p className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>
                    {task.name}
                  </p>
                  <p className="text-xs truncate" style={{ color: '#55556a' }}>
                    {PHASE_LABELS[task.phase]} · {task.agent}
                  </p>
                </div>

                {/* Bar grid */}
                <div className="flex flex-1 relative h-8">
                  {/* Grid lines */}
                  {weeks.map(w => (
                    <div
                      key={w.index}
                      className="flex-1 h-full border-r"
                      style={{ borderColor: '#1a1a2e' }}
                    />
                  ))}

                  {/* Bar */}
                  <div
                    className="absolute top-1 bottom-1 rounded-md flex items-center px-2"
                    style={{
                      left: `${(task.startWeek / TOTAL_WEEKS) * 100}%`,
                      width: `${(task.durationWeeks / TOTAL_WEEKS) * 100}%`,
                      backgroundColor: colors.bg,
                      border: `1px solid ${colors.border}`,
                    }}
                  >
                    <span className="text-xs truncate font-medium" style={{ color: colors.border }}>
                      {task.name}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex gap-4 mt-4 pt-4" style={{ borderTop: '1px solid #24243e' }}>
          {Object.entries(PHASE_LABELS).map(([phase, label]) => {
            const colors = PHASE_COLORS[Number(phase)]
            return (
              <div key={phase} className="flex items-center gap-1.5">
                <div
                  className="w-3 h-3 rounded-sm"
                  style={{ backgroundColor: colors.bg, border: `1px solid ${colors.border}` }}
                />
                <span className="text-xs" style={{ color: '#9090b0' }}>
                  Ph{phase} {label}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
