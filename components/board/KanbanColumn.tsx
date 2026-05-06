'use client'

import { useDroppable } from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import type { KanbanCard as KanbanCardType, ColumnId } from '@/lib/types'
import KanbanCard from './KanbanCard'

const COLUMN_ACCENT: Record<ColumnId, string> = {
  backlog: '#55556a',
  'in-progress': '#6c63ff',
  review: '#f59e0b',
  completed: '#22c55e',
}

// Per-column empty-state copy. The first time a user lands on the board with
// no cards anywhere, the headline of `backlog` is the primary onboarding hint —
// the others tell the user what state means.
const COLUMN_EMPTY_HINT: Record<ColumnId, { title: string; sub: string }> = {
  backlog: {
    title: 'Nothing queued yet',
    sub:   'Cards land here when you run an idea from the Ideas library, or drop one from another column.',
  },
  'in-progress': {
    title: 'Nothing in flight',
    sub:   'Drag a card from Backlog to start work, or wait for an agent to pick one up.',
  },
  review: {
    title: 'Nothing to review',
    sub:   'Cards arrive here when an agent ships an asset that needs your approval.',
  },
  completed: {
    title: 'No completed cards yet',
    sub:   'Approved review cards drop down here.',
  },
}

interface Props {
  columnId: ColumnId
  label: string
  cards: KanbanCardType[]
  onCardClick?:  (card: KanbanCardType) => void
  onCardDelete?: (card: KanbanCardType) => void
}

export default function KanbanColumn({ columnId, label, cards, onCardClick, onCardDelete }: Props) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId })
  const accent = COLUMN_ACCENT[columnId]

  return (
    <div className="flex flex-col w-72 shrink-0">
      {/* Column header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
          <span className="text-sm font-semibold" style={{ color: '#e8e8f0' }}>
            {label}
          </span>
        </div>
        <span
          className="text-xs px-2 py-0.5 rounded-full"
          style={{ backgroundColor: '#1a1a2e', color: '#55556a', border: '1px solid #24243e' }}
        >
          {cards.length}
        </span>
      </div>

      {/* Drop zone */}
      <div
        ref={setNodeRef}
        className="flex-1 rounded-xl p-2 space-y-2 min-h-[200px] transition-colors"
        style={{
          backgroundColor: isOver ? '#1a1a2e' : '#0d0d14',
          border: isOver ? `1px dashed ${accent}` : '1px solid #1a1a2e',
        }}
      >
        <SortableContext items={cards.map(c => c.id)} strategy={verticalListSortingStrategy}>
          {cards.map(card => (
            <KanbanCard
              key={card.id}
              card={card}
              onClick={onCardClick ? () => onCardClick(card) : undefined}
              onDelete={onCardDelete}
            />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex flex-col items-center justify-center h-32 px-4 text-center gap-1">
            <span className="text-xs font-medium" style={{ color: '#9090b0' }}>
              {COLUMN_EMPTY_HINT[columnId].title}
            </span>
            <span className="text-[11px] leading-tight" style={{ color: '#55556a' }}>
              {COLUMN_EMPTY_HINT[columnId].sub}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
