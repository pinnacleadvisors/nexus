'use client'

import LessonNode from './LessonNode'
import type { LearnPathUnit } from '@/lib/types'

interface Props {
  units: LearnPathUnit[]
}

/** Snake-shaped offset: lessons swing left/right as you scroll down. */
function snakeOffset(i: number): number {
  const phase = i % 6
  if (phase < 3) return phase / 3
  return (6 - phase) / 3
}

export default function PathView({ units }: Props) {
  if (units.length === 0) {
    return (
      <div
        className="rounded-xl text-center py-16 px-6"
        style={{ backgroundColor: '#12121e', border: '1px dashed #24243e' }}
      >
        <p className="text-base font-medium mb-2" style={{ color: '#e8e8f0' }}>
          No cards yet
        </p>
        <p className="text-sm" style={{ color: '#9090b0' }}>
          Add atoms to <code className="text-xs px-1 rounded" style={{ backgroundColor: '#1a1a2e' }}>memory/molecular</code> and run the sync cron, or POST to <code className="text-xs px-1 rounded" style={{ backgroundColor: '#1a1a2e' }}>/api/cron/sync-learning-cards</code>.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-12">
      {units.map(unit => (
        <section key={unit.mocSlug || 'none'}>
          <header className="mb-6 flex items-center gap-4">
            <div
              className="px-4 py-2 rounded-lg"
              style={{ backgroundColor: '#6c63ff22', border: '1px solid #6c63ff44' }}
            >
              <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: '#6c63ff' }}>
                {unit.title}
              </h2>
            </div>
            <div className="flex-1 h-px" style={{ backgroundColor: '#24243e' }} />
            <span className="text-xs" style={{ color: '#9090b0' }}>
              {Math.round(unit.progress * 100)}% mastered · {unit.lessons.length} lessons
            </span>
          </header>

          <div className="space-y-8 max-w-md mx-auto">
            {unit.lessons.map((lesson, i) => (
              <LessonNode key={lesson.atomSlug} lesson={lesson} offset={snakeOffset(i)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
