'use client'

import Link from 'next/link'
import { Crown, AlertTriangle, Clock } from 'lucide-react'
import type { LearnPathLesson } from '@/lib/types'

interface Props {
  lesson: LearnPathLesson
  /** Visual offset along the snake path (0..1) */
  offset: number
}

const RING_SEGMENTS = 5
const RADIUS = 28
const STROKE = 5

function CrownRing({ crown }: { crown: number }) {
  const circ = 2 * Math.PI * RADIUS
  const seg = circ / RING_SEGMENTS
  const gap = 4
  return (
    <svg width={RADIUS * 2 + STROKE * 2} height={RADIUS * 2 + STROKE * 2} className="-rotate-90">
      <g transform={`translate(${RADIUS + STROKE}, ${RADIUS + STROKE})`}>
        {Array.from({ length: RING_SEGMENTS }).map((_, i) => {
          const filled = i < crown
          return (
            <circle
              key={i}
              r={RADIUS}
              cx={0}
              cy={0}
              fill="transparent"
              stroke={filled ? '#f59e0b' : '#24243e'}
              strokeWidth={STROKE}
              strokeDasharray={`${seg - gap} ${circ - (seg - gap)}`}
              strokeDashoffset={-(i * seg) + gap / 2}
            />
          )
        })}
      </g>
    </svg>
  )
}

function dueLabel(iso: string | null): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  const now = Date.now()
  if (t <= now) return 'Due now'
  const days = Math.round((t - now) / 86_400_000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  return `${days}d`
}

export default function LessonNode({ lesson, offset }: Props) {
  const due = dueLabel(lesson.nextDueAt)
  const overdue = lesson.nextDueAt ? new Date(lesson.nextDueAt).getTime() <= Date.now() : false
  return (
    <div
      className="flex flex-col items-center gap-2"
      style={{ marginLeft: `${offset * 80}px` }}
    >
      <Link
        href={`/learn/session?atom=${encodeURIComponent(lesson.atomSlug)}`}
        className="relative group"
        title={lesson.title}
      >
        <CrownRing crown={lesson.crown} />
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{ left: 5, top: 5, width: 56, height: 56 }}
        >
          <div
            className="rounded-full flex items-center justify-center transition-transform group-hover:scale-105"
            style={{
              width: 56,
              height: 56,
              backgroundColor: lesson.crown >= 5 ? '#22c55e22' : overdue ? '#6c63ff22' : '#12121e',
              border: `2px solid ${lesson.crown >= 5 ? '#22c55e' : overdue ? '#6c63ff' : '#24243e'}`,
            }}
          >
            {lesson.isStale ? (
              <AlertTriangle size={20} style={{ color: '#f59e0b' }} />
            ) : lesson.crown >= 5 ? (
              <Crown size={20} style={{ color: '#22c55e' }} />
            ) : (
              <span className="text-sm font-bold" style={{ color: '#e8e8f0' }}>{lesson.cardCount}</span>
            )}
          </div>
        </div>
      </Link>
      <div className="text-center max-w-[120px]">
        <div className="text-xs font-medium truncate" style={{ color: '#e8e8f0' }}>
          {lesson.title}
        </div>
        {due && (
          <div className="text-[10px] flex items-center justify-center gap-1 mt-0.5" style={{ color: overdue ? '#6c63ff' : '#9090b0' }}>
            <Clock size={10} />
            {due}
          </div>
        )}
      </div>
    </div>
  )
}
