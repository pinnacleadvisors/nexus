'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanCard as KanbanCardType } from '@/lib/types'
import { User, ExternalLink, FileText, GitBranch, Table2, Layout, Bot, Hand, Zap } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const PRIORITY_COLOR: Record<KanbanCardType['priority'], string> = {
  low:    '#55556a',
  medium: '#f59e0b',
  high:   '#ef4444',
}

// ── Asset type detection ──────────────────────────────────────────────────────
type AssetType = 'github' | 'drive' | 'docs' | 'sheets' | 'pdf' | 'miro' | 'notion' | 'web'

function detectAssetType(url: string): AssetType {
  if (url.includes('github.com'))                         return 'github'
  if (url.includes('drive.google.com'))                   return 'drive'
  if (url.includes('docs.google.com/document'))           return 'docs'
  if (url.includes('docs.google.com/spreadsheets'))       return 'sheets'
  if (url.endsWith('.pdf') || url.includes('/pdf/'))      return 'pdf'
  if (url.includes('miro.com'))                           return 'miro'
  if (url.includes('notion.so') || url.includes('notion.site')) return 'notion'
  return 'web'
}

const ASSET_LABELS: Record<AssetType, string> = {
  github:  'GitHub',
  drive:   'Google Drive',
  docs:    'Google Docs',
  sheets:  'Google Sheets',
  pdf:     'PDF Document',
  miro:    'Miro Board',
  notion:  'Notion',
  web:     'Asset link',
}

function AssetIcon({ type, size = 11 }: { type: AssetType; size?: number }) {
  switch (type) {
    case 'github':  return <GitBranch size={size} />
    case 'docs':
    case 'notion':  return <FileText  size={size} />
    case 'sheets':  return <Table2    size={size} />
    case 'miro':    return <Layout    size={size} />
    default:        return <ExternalLink size={size} />
  }
}

// ── Hover asset preview tooltip ───────────────────────────────────────────────
function AssetPreview({ url }: { url: string }) {
  const type = detectAssetType(url)
  const label = ASSET_LABELS[type]
  const short = url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 40)

  return (
    <div
      className="absolute bottom-full left-1/2 mb-2 z-50 rounded-xl px-3 py-2.5 shadow-2xl w-56 pointer-events-none"
      style={{
        backgroundColor: '#0d0d14',
        border: '1px solid #24243e',
        transform: 'translateX(-50%)',
      }}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <span style={{ color: '#6c63ff' }}><AssetIcon type={type} size={12} /></span>
        <span className="text-xs font-semibold" style={{ color: '#e8e8f0' }}>{label}</span>
      </div>
      <p className="text-xs break-all" style={{ color: '#55556a' }}>{short}…</p>
      <p className="text-xs mt-1.5" style={{ color: '#6c63ff' }}>Click to open →</p>
      {/* Arrow */}
      <div
        className="absolute left-1/2 top-full"
        style={{
          transform: 'translateX(-50%)',
          width: 0, height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid #24243e',
        }}
      />
    </div>
  )
}

// ── Card ──────────────────────────────────────────────────────────────────────
interface Props {
  card: KanbanCardType
  overlay?: boolean
  onClick?: () => void
}

export default function KanbanCard({ card, overlay, onClick }: Props) {
  const [showPreview, setShowPreview] = useState(false)

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: card.id,
  })

  const style = {
    transform:  CSS.Transform.toString(transform),
    transition,
    opacity:    isDragging && !overlay ? 0.4 : 1,
  }

  const isInProgress = card.columnId === 'in-progress'
  const isCompleted  = card.columnId === 'completed'
  const assetType    = card.assetUrl ? detectAssetType(card.assetUrl) : null

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={onClick}
      className="rounded-xl p-3 select-none"
      onMouseEnter={e => {
        if (!overlay) (e.currentTarget as HTMLDivElement).style.borderColor = '#32325a'
      }}
      onMouseLeave={e => {
        if (!overlay) (e.currentTarget as HTMLDivElement).style.borderColor = '#24243e'
      }}
      style={{
        ...style,
        backgroundColor: overlay ? '#1a1a2e' : '#12121e',
        border:     '1px solid #24243e',
        boxShadow:  overlay ? '0 8px 24px rgba(0,0,0,0.6)' : 'none',
        cursor:     onClick ? 'pointer' : 'grab',
      }}
    >
      {/* Priority dot + title + type badge */}
      <div className="flex items-start gap-2 mb-2">
        <span
          className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
          style={{ backgroundColor: PRIORITY_COLOR[card.priority] }}
        />
        <p className="text-sm font-medium leading-snug flex-1" style={{ color: '#e8e8f0' }}>
          {card.title}
        </p>
        {card.taskType === 'manual' ? (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shrink-0"
            style={{ backgroundColor: '#2e1a0d', color: '#f59e0b', border: '1px solid #f59e0b33' }}
            title="Manual task — requires the owner"
          >
            <Hand size={10} />
            Manual
          </span>
        ) : (
          <span
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shrink-0"
            style={{ backgroundColor: '#0d1f2e', color: '#6c63ff', border: '1px solid #6c63ff33' }}
            title="Automated task — handled by agent or n8n"
          >
            <Bot size={10} />
            Auto
          </span>
        )}
      </div>

      {/* Manual-task dependent count (how many automated tasks are blocked) */}
      {card.taskType === 'manual' && (card.dependentCount ?? 0) > 0 && (
        <div
          className="flex items-center gap-1.5 mb-2 px-2 py-1 rounded-lg text-xs"
          style={{ backgroundColor: '#0d1f2e', border: '1px solid #6c63ff33', color: '#6c63ff' }}
          title={`${card.dependentCount} automated task${card.dependentCount === 1 ? '' : 's'} depend on this`}
        >
          <Zap size={10} />
          <span className="font-semibold">Unblocks {card.dependentCount}</span>
          <span style={{ color: '#55556a' }}>
            automated task{card.dependentCount === 1 ? '' : 's'}
          </span>
        </div>
      )}

      <p className="text-xs mb-3 line-clamp-2" style={{ color: '#9090b0' }}>
        {card.description}
      </p>

      {/* Revision note (when rejected back to backlog) */}
      {card.revisionNote && (
        <div
          className="text-xs mb-2 px-2 py-1.5 rounded-lg"
          style={{ backgroundColor: '#2e1a0d', border: '1px solid #f59e0b33', color: '#f59e0b' }}
        >
          <span className="font-semibold">Revision: </span>
          {card.revisionNote}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-2">
        {/* Assignee / Agent badge */}
        <div className="flex items-center gap-1.5 min-w-0">
          {isInProgress ? (
            // Animated "working" badge for in-progress cards
            <div className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: '#6c63ff' }}
              />
              <span className="text-xs truncate max-w-[110px]" style={{ color: '#6c63ff' }}>
                {card.assignee ?? 'Agent working…'}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <User size={11} style={{ color: '#55556a' }} />
              <span className="text-xs truncate max-w-[100px]" style={{ color: '#55556a' }}>
                {card.assignee ?? 'Unassigned'}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Asset link — click-through with hover preview on completed */}
          {card.assetUrl && assetType && (
            <div className="relative">
              <button
                onClick={e => {
                  e.stopPropagation()
                  window.open(card.assetUrl, '_blank', 'noopener,noreferrer')
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a2e'
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = '#24243e'
                  if (isCompleted) setShowPreview(true)
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
                  ;(e.currentTarget as HTMLButtonElement).style.borderColor = 'transparent'
                  setShowPreview(false)
                }}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded"
                style={{ color: '#6c63ff', backgroundColor: 'transparent', border: '1px solid transparent' }}
                title={`Open ${ASSET_LABELS[assetType]}`}
              >
                <AssetIcon type={assetType} />
                {isCompleted && (
                  <span className="text-xs" style={{ color: '#6c63ff' }}>
                    {ASSET_LABELS[assetType].split(' ')[0]}
                  </span>
                )}
              </button>
              {/* Hover preview tooltip — only on completed cards */}
              {isCompleted && showPreview && <AssetPreview url={card.assetUrl} />}
            </div>
          )}

          <span className="text-xs" style={{ color: '#55556a' }}>
            {formatDistanceToNow(new Date(card.createdAt), { addSuffix: true })}
          </span>
        </div>
      </div>
    </div>
  )
}
