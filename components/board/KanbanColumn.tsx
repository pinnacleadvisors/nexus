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

interface Props {
  columnId: ColumnId
  label: string
  cards: KanbanCardType[]
  onCardClick?: (card: KanbanCardType) => void
}

export default function KanbanColumn({ columnId, label, cards, onCardClick }: Props) {
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
            />
          ))}
        </SortableContext>

        {cards.length === 0 && (
          <div className="flex items-center justify-center h-20">
            <span className="text-xs" style={{ color: '#32325a' }}>
              Drop cards here
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
