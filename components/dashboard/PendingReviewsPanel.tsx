'use client'

/**
 * Pending Reviews — every Board card sitting in the `review` column waiting
 * for the operator to approve / reject. The whole point of Mission Control
 * is that this panel becomes the operator's standing to-do list — if it's
 * empty the system is unblocked; if it isn't, you know exactly where to go.
 *
 * Click-through opens the board scoped to that card so the existing
 * ReviewModal can take over.
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCircle2, ArrowRight, Loader2 } from 'lucide-react'
import type { KanbanCard } from '@/lib/types'

const POLL_MS = 15_000

interface BoardResponse { cards: KanbanCard[] }

export default function PendingReviewsPanel() {
  const [cards, setCards] = useState<KanbanCard[] | null>(null)

  useEffect(() => {
    let cancelled = false
    async function tick() {
      try {
        const res = await fetch('/api/board', { cache: 'no-store' })
        if (!res.ok) return
        const json = await res.json() as BoardResponse
        const reviews = (json.cards ?? []).filter(c => c.columnId === 'review')
        // Sort high-priority first, then newest
        reviews.sort((a, b) => {
          const pri = (p: string) => p === 'high' ? 0 : p === 'medium' ? 1 : 2
          if (pri(a.priority) !== pri(b.priority)) return pri(a.priority) - pri(b.priority)
          return b.createdAt.localeCompare(a.createdAt)
        })
        if (!cancelled) setCards(reviews.slice(0, 8))
      } catch { /* keep last */ }
    }
    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [])

  return (
    <div
      className="rounded-xl p-4"
      style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CheckCircle2 size={14} style={{ color: '#f59e0b' }} />
          <span className="text-xs uppercase tracking-wide font-medium" style={{ color: '#9090b0' }}>
            Pending reviews
            {cards && cards.length > 0 && (
              <span
                className="ml-1.5 px-1.5 py-0.5 rounded text-xs tabular-nums"
                style={{ backgroundColor: '#2a1f0d', color: '#f59e0b' }}
              >
                {cards.length}
              </span>
            )}
          </span>
        </div>
        {cards === null && <Loader2 size={12} className="animate-spin" style={{ color: '#55556a' }} />}
        <Link
          href="/board"
          className="text-xs flex items-center gap-1 hover:underline"
          style={{ color: '#9090b0' }}
        >
          Open board <ArrowRight size={11} />
        </Link>
      </div>

      {cards !== null && cards.length === 0 && (
        <p className="text-xs" style={{ color: '#55556a' }}>
          Nothing waiting. The Hive is unblocked.
        </p>
      )}

      <div className="space-y-2">
        {cards?.map(card => (
          <Link
            key={card.id}
            href={`/board?card=${card.id}`}
            className="block p-2.5 rounded-lg transition-colors"
            style={{ backgroundColor: '#050508', border: '1px solid #24243e' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#12121e' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#050508' }}
          >
            <div className="flex items-center gap-2">
              <span
                className="text-xs font-medium uppercase tracking-wide px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: card.priority === 'high' ? '#2a1116' : card.priority === 'medium' ? '#2a1f0d' : '#1a1a2e',
                  color:           card.priority === 'high' ? '#ff7a90' : card.priority === 'medium' ? '#f59e0b' : '#9090b0',
                }}
              >
                {card.priority}
              </span>
              <span className="text-xs flex-1 truncate" style={{ color: '#e8e8f0' }}>
                {card.title}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
