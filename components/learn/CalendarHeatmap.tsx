'use client'

interface Day { date: string; xp: number; cardsReviewed: number }
interface Props { days: Day[] }

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

  return (
    <div className="overflow-x-auto">
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
  )
}
