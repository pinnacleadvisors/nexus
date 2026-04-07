'use client'

import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanCard as KanbanCardType } from '@/lib/types'
import { User, ExternalLink } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const PRIORITY_COLOR: Record<KanbanCardType['priority'], string> = {
  low: '#55556a',
  medium: '#f59e0b',
  high: '#ef4444',
}

interface Props {
  card: KanbanCardType
  overlay?: boolean
  onClick?: () => void
}

export default function KanbanCard({ card, overlay, onClick }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging && !overlay ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="rounded-xl p-3 cursor-grab active:cursor-grabbing select-none"
      onMouseEnter={e => {
        if (!overlay)
          (e.currentTarget as HTMLDivElement).style.borderColor = '#32325a'
      }}
      onMouseLeave={e => {
        if (!overlay)
          (e.currentTarget as HTMLDivElement).style.borderColor = '#24243e'
      }}
      style={{
        ...style,
        backgroundColor: overlay ? '#1a1a2e' : '#12121e',
        border: '1px solid #24243e',
        boxShadow: overlay ? '0 8px 24px rgba(0,0,0,0.6)' : 'none',
        cursor: onClick ? 'pointer' : 'grab',
      }}
    >
      {/* Priority dot + title */}
      <div className="flex items-start gap-2 mb-2">
        <span
          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: PRIORITY_COLOR[card.priority] }}
        />
        <p className="text-sm font-medium leading-snug" style={{ color: '#e8e8f0' }}>
          {card.title}
        </p>
      </div>

      <p className="text-xs mb-3 line-clamp-2" style={{ color: '#9090b0' }}>
        {card.description}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <User size={11} style={{ color: '#55556a' }} />
          <span className="text-xs truncate max-w-[100px]" style={{ color: '#55556a' }}>
            {card.assignee ?? 'Unassigned'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {card.assetUrl && (
            <ExternalLink size={11} style={{ color: '#6c63ff' }} />
          )}
          <span className="text-xs" style={{ color: '#55556a' }}>
            {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  )
}
