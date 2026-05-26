'use client'

import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { KanbanCard as KanbanCardType } from '@/lib/types'
import { User, ExternalLink, FileText, GitBranch, Table2, Layout, Bot, Hand, Zap, Trash2 } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

const PRIORITY_COLOR: Record<KanbanCardType['priority'], string> = {
  low:    '#55556a',
  medium: '#f59e0b',
  high:   '#ef4444',
}

// ── Asset type detection ──────────────────────────────────────────────────────
type AssetType = 'github' | 'drive' | 'docs' | 'sheets' | 'pdf' | 'miro' | 'notion' | 'web'

/**
 * Detect asset type from URL. Uses parsed-URL hostname matching (not raw
 * substring matching) so `evil.com/github.com/x` doesn't masquerade as
 * a GitHub asset — fixes CodeQL js/incomplete-url-substring-sanitization.
 */
function detectAssetType(url: string): AssetType {
  let host = ''
  let pathname = ''
  try {
    const u = new URL(url)
    host     = u.hostname.toLowerCase()
    pathname = u.pathname.toLowerCase()
  } catch {
    // Not a parseable URL — fall through to PDF / web defaults below.
  }

  const hostIs = (target: string) =>
    host === target || host.endsWith(`.${target}`)

  if (host && hostIs('github.com'))           return 'github'
  if (host && hostIs('drive.google.com'))     return 'drive'
  if (host && hostIs('docs.google.com')) {
    if (pathname.startsWith('/document'))     return 'docs'
    if (pathname.startsWith('/spreadsheets')) return 'sheets'
  }
  if (url.endsWith('.pdf') || pathname.includes('/pdf/')) return 'pdf'
  if (host && hostIs('miro.com'))             return 'miro'
  if (host && (hostIs('notion.so') || hostIs('notion.site'))) return 'notion'
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
  /** Called when the owner clicks the trash icon. The icon is hidden if this
   *  prop is omitted (e.g. on the drag overlay). The handler is responsible
   *  for confirmation and the actual DELETE request. */
  onDelete?: (card: KanbanCardType) => void
}

export default function KanbanCard({ card, overlay, onClick, onDelete }: Props) {
  const [showPreview, setShowPreview] = useState(false)
  const [hovered, setHovered] = useState(false)

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
      className="rounded-xl p-3 select-none relative"
      onMouseEnter={e => {
        if (!overlay) {
          (e.currentTarget as HTMLDivElement).style.borderColor = '#32325a'
          setHovered(true)
        }
      }}
      onMouseLeave={e => {
        if (!overlay) {
          (e.currentTarget as HTMLDivElement).style.borderColor = '#24243e'
          setHovered(false)
        }
      }}
      style={{
        ...style,
        backgroundColor: overlay ? '#1a1a2e' : '#12121e',
        border:     '1px solid #24243e',
        boxShadow:  overlay ? '0 8px 24px rgba(0,0,0,0.6)' : 'none',
        cursor:     onClick ? 'pointer' : 'grab',
      }}
    >
      {/* Delete button — visible on hover only, top-right corner. Stops drag
          and click propagation so a hover-click doesn't also trigger the
          card's onClick or kick off a dnd-kit drag. */}
      {!overlay && onDelete && hovered && (
        <button
          onClick={e => {
            e.stopPropagation()
            e.preventDefault()
            onDelete(card)
          }}
          onPointerDown={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          className="absolute top-2 right-2 flex items-center justify-center w-6 h-6 rounded transition-colors z-10"
          style={{
            backgroundColor: '#1a0d0d',
            color:           '#ef4444',
            border:          '1px solid #ef444444',
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#2e0d0d' }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a0d0d' }}
          title="Delete this card"
          aria-label="Delete card"
        >
          <Trash2 size={11} />
        </button>
      )}

      {/* Priority dot + title + type badge — pad-right to make room for the
          hover delete button so it never overlaps the type badge. */}
      <div className={`flex items-start gap-2 mb-2 ${onDelete && !overlay ? 'pr-7' : ''}`}>
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
