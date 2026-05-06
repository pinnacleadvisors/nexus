'use client'

interface Day { date: string; xp: number; cardsReviewed: number }
interface Props { days: Day[] }

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DOW_LABELS   = ['Mon', '', 'Wed', '', 'Fri', '', '']

function colorFor(xp: number): string {
  if (xp === 0) return '#1a1a2e'
  if (xp < 10) return '#22c55e22'
  if (xp < 30) return '#22c55e55'
  if (xp < 60) return '#22c55e88'
  return '#22c55e'
}

export default function CalendarHeatmap({ days }: Props) {
  // Group into weeks (Mon-first). Render as 7 rows × N columns.
  const weeks: Array<Array<Day | null>> = []
  if (days.length > 0) {
    const firstDate = new Date(days[0]!.date)
    const dow = (firstDate.getUTCDay() + 6) % 7 // Mon = 0
    let week: Array<Day | null> = Array(dow).fill(null)
    for (const d of days) {
      week.push(d)
      if (week.length === 7) {
        weeks.push(week)
        week = []
      }
    }
    if (week.length > 0) {
      while (week.length < 7) week.push(null)
      weeks.push(week)
    }
  }

  // Compute month label for each column. We label a column when it contains
  // the FIRST day of a month — that's the GitHub convention. Columns that
  // don't start a month get an empty placeholder so the row stays aligned.
  const monthLabelByCol: Array<string> = weeks.map(week => {
    for (const d of week) {
      if (!d) continue
      const date = new Date(d.date)
      if (date.getUTCDate() <= 7) {
        return MONTH_LABELS[date.getUTCMonth()] ?? ''
      }
    }
    return ''
  })

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-1">
        {/* Day-of-week column on the left — only Mon/Wed/Fri labelled to
            keep the strip narrow. */}
        <div className="flex flex-col gap-1 mr-1 select-none" style={{ paddingTop: 16 }}>
          {DOW_LABELS.map((lbl, i) => (
            <div
              key={i}
              className="h-3 text-[9px] leading-3 flex items-center"
              style={{ color: '#55556a', minWidth: 18 }}
            >
              {lbl}
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-1">
          {/* Month-label row above the columns. Only columns starting a
              month get text — others are blank placeholders to keep
              alignment with the cells below. */}
          <div className="flex gap-1 select-none">
            {monthLabelByCol.map((lbl, i) => (
              <div
                key={i}
                className="text-[9px] leading-3"
                style={{ color: '#9090b0', width: 12, height: 12 }}
              >
                {lbl}
              </div>
            ))}
          </div>

          <div className="flex gap-1">
            {weeks.map((week, wi) => (
              <div key={wi} className="flex flex-col gap-1">
                {week.map((d, di) => (
                  <div
                    key={di}
                    title={d ? `${d.date}: ${d.xp} XP, ${d.cardsReviewed} cards` : ''}
                    className="w-3 h-3 rounded-sm"
                    style={{ backgroundColor: d ? colorFor(d.xp) : 'transparent' }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
