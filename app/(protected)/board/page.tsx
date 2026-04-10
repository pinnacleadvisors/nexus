'use client'

import { useState } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import { arrayMove, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import type { KanbanCard as KanbanCardType, ColumnId } from '@/lib/types'
import { INITIAL_COLUMNS } from '@/lib/mock-data'
import KanbanColumn from '@/components/board/KanbanColumn'
import KanbanCard from '@/components/board/KanbanCard'
import ReviewModal from '@/components/board/ReviewModal'

const COLUMN_ORDER: ColumnId[] = ['backlog', 'in-progress', 'review', 'completed']
const COLUMN_LABELS: Record<ColumnId, string> = {
  backlog: 'Backlog',
  'in-progress': 'In Progress',
  review: 'Review',
  completed: 'Completed',
}
const COLUMN_IDS = new Set<string>(COLUMN_ORDER)

function isColumnId(id: string): id is ColumnId {
  return COLUMN_IDS.has(id)
}

function findColumnOfCard(
  cardId: string,
  columns: Record<ColumnId, KanbanCardType[]>
): ColumnId | null {
  for (const [colId, cards] of Object.entries(columns)) {
    if (cards.some(c => c.id === cardId)) return colId as ColumnId
  }
  return null
}

function buildInitialState(): Record<ColumnId, KanbanCardType[]> {
  const map = {} as Record<ColumnId, KanbanCardType[]>
  INITIAL_COLUMNS.forEach(col => {
    map[col.id] = col.cards
  })
  return map
}

export default function BoardPage() {
  const [columns, setColumns] = useState<Record<ColumnId, KanbanCardType[]>>(buildInitialState)
  const [activeCard, setActiveCard] = useState<KanbanCardType | null>(null)
  const [reviewCard, setReviewCard] = useState<KanbanCardType | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string
    const colId = findColumnOfCard(id, columns)
    if (colId) setActiveCard(columns[colId].find(c => c.id === id) ?? null)
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string
    const sourceColId = findColumnOfCard(activeId, columns)
    const targetColId = isColumnId(overId) ? overId : findColumnOfCard(overId, columns)

    if (!sourceColId || !targetColId || sourceColId === targetColId) return

    setColumns(prev => {
      const sourceCards = [...prev[sourceColId]]
      const cardIndex = sourceCards.findIndex(c => c.id === activeId)
      const [card] = sourceCards.splice(cardIndex, 1)
      const targetCards = [...prev[targetColId]]
      const overIndex = targetCards.findIndex(c => c.id === overId)
      targetCards.splice(overIndex >= 0 ? overIndex : targetCards.length, 0, {
        ...card,
        columnId: targetColId,
      })
      return { ...prev, [sourceColId]: sourceCards, [targetColId]: targetCards }
    })
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveCard(null)
    if (!over) return

    const activeId = active.id as string
    const overId = over.id as string
    const sourceColId = findColumnOfCard(activeId, columns)
    const targetColId = isColumnId(overId) ? overId : findColumnOfCard(overId, columns)

    if (!sourceColId || !targetColId) return

    if (sourceColId === targetColId) {
      setColumns(prev => {
        const cards = prev[sourceColId]
        const oldIndex = cards.findIndex(c => c.id === activeId)
        const newIndex = cards.findIndex(c => c.id === overId)
        if (oldIndex === newIndex) return prev
        return { ...prev, [sourceColId]: arrayMove(cards, oldIndex, newIndex) }
      })
    }
    // Cross-column move was already handled optimistically in onDragOver
  }

  function handleApprove() {
    if (!reviewCard) return
    setColumns(prev => {
      const reviewCards = prev['review'].filter(c => c.id !== reviewCard.id)
      const completedCards = [
        ...prev['completed'],
        { ...reviewCard, columnId: 'completed' as ColumnId },
      ]
      return { ...prev, review: reviewCards, completed: completedCards }
    })
    setReviewCard(null)
  }

  function handleReject(revision: string) {
    if (!reviewCard) return
    setColumns(prev => ({
      ...prev,
      review: prev['review'].filter(c => c.id !== reviewCard.id),
      backlog: [
        { ...reviewCard, columnId: 'backlog', revisionNote: revision },
        ...prev['backlog'],
      ],
    }))
    setReviewCard(null)
  }

  const totalCards = COLUMN_ORDER.reduce((n, id) => n + columns[id].length, 0)

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#050508' }}>
      {/* Header */}
      <div
        className="shrink-0 flex items-center justify-between px-6 py-4"
        style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
      >
        <div>
          <h1 className="font-bold text-lg" style={{ color: '#e8e8f0' }}>
            Agent Board
          </h1>
          <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
            {totalCards} tasks across {COLUMN_ORDER.length} stages
          </p>
        </div>
      </div>

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 p-6 overflow-x-auto flex-1">
          {COLUMN_ORDER.map(colId => (
            <KanbanColumn
              key={colId}
              columnId={colId}
              label={COLUMN_LABELS[colId]}
              cards={columns[colId]}
              onCardClick={colId === 'review' ? setReviewCard : undefined}
            />
          ))}
        </div>

        <DragOverlay>
          {activeCard ? <KanbanCard card={activeCard} overlay /> : null}
        </DragOverlay>
      </DndContext>

      {/* Review modal */}
      {reviewCard && (
        <ReviewModal
          card={reviewCard}
          onClose={() => setReviewCard(null)}
          onApprove={handleApprove}
          onReject={handleReject}
        />
      )}
    </div>
  )
}
