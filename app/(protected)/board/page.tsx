'use client'

import { useState, useEffect, useCallback } from 'react'
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
import type { KanbanCard as KanbanCardType, ColumnId, ForgeProject, TaskType } from '@/lib/types'
import { supabase } from '@/lib/supabase'
import KanbanColumn from '@/components/board/KanbanColumn'
import KanbanCard from '@/components/board/KanbanCard'
import ReviewModal from '@/components/board/ReviewModal'
import { RefreshCw, ChevronDown, Circle, Bot, User as UserIcon, Layers } from 'lucide-react'

type TaskTypeFilter = 'all' | TaskType

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

function findColumnOfCard(cardId: string, columns: Record<ColumnId, KanbanCardType[]>): ColumnId | null {
  for (const [colId, cards] of Object.entries(columns)) {
    if (cards.some(c => c.id === cardId)) return colId as ColumnId
  }
  return null
}

function cardsToColumns(cards: KanbanCardType[]): Record<ColumnId, KanbanCardType[]> {
  const map = { backlog: [], 'in-progress': [], review: [], completed: [] } as Record<ColumnId, KanbanCardType[]>
  for (const card of cards) {
    map[card.columnId].push(card)
  }
  return map
}

// ── Supabase persistence helpers ──────────────────────────────────────────────
async function persistColumnChange(id: string, columnId: ColumnId) {
  await fetch('/api/board', {
    method:  'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ id, columnId }),
  })
}

// ── LocalStorage project loader ───────────────────────────────────────────────
function loadLocalProjects(): ForgeProject[] {
  try {
    const raw = localStorage.getItem('forge:projects')
    return raw ? (JSON.parse(raw) as ForgeProject[]) : []
  } catch {
    return []
  }
}

// ── Board page ────────────────────────────────────────────────────────────────
export default function BoardPage() {
  const [columns,     setColumns]     = useState<Record<ColumnId, KanbanCardType[]>>({
    backlog: [], 'in-progress': [], review: [], completed: [],
  })
  const [activeCard,  setActiveCard]  = useState<KanbanCardType | null>(null)
  const [reviewCard,  setReviewCard]  = useState<KanbanCardType | null>(null)
  const [source,      setSource]      = useState<'supabase' | 'mock' | 'empty' | 'loading'>('loading')
  const [isRealtime,  setIsRealtime]  = useState(false)

  // ── Project filter ────────────────────────────────────────────────────────
  const [projects,         setProjects]         = useState<ForgeProject[]>([])
  const [activeProjectId,  setActiveProjectId]  = useState<string>('all')
  const [showProjectMenu,  setShowProjectMenu]  = useState(false)

  // ── Task-type filter (automated / manual / all) ──────────────────────────
  const [typeFilter,       setTypeFilter]       = useState<TaskTypeFilter>('all')

  // ── Data loading ──────────────────────────────────────────────────────────
  const loadCards = useCallback(async (projectId?: string, type?: TaskTypeFilter) => {
    const params = new URLSearchParams()
    if (projectId && projectId !== 'all') params.set('project_id', projectId)
    if (type && type !== 'all')           params.set('type', type)
    const qs = params.toString()
    const url = qs ? `/api/board?${qs}` : '/api/board'

    const res = await fetch(url)
    const data = (await res.json()) as { cards: KanbanCardType[]; source: string }
    setColumns(cardsToColumns(data.cards))
    setSource(data.source as typeof source)
  }, [])

  useEffect(() => {
    // Load projects from localStorage (synced with Forge)
    setProjects(loadLocalProjects())
    loadCards()
  }, [loadCards])

  // Re-fetch when project or type filter changes
  useEffect(() => {
    if (source === 'loading') return
    loadCards(activeProjectId, typeFilter)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, typeFilter])

  // ── Supabase Realtime ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!supabase) return

    const channel = supabase!
      .channel('board-tasks-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        payload => {
          type TaskRow = {
            id: string; column_id: string; project_id?: string; title: string
            description: string; assignee?: string; priority: string
            asset_url?: string; revision_note?: string; milestone_id?: string
            created_at: string; task_type?: string; depends_on?: string[]
          }
          const matchesFilters = (row: TaskRow): boolean => {
            if (activeProjectId !== 'all' && row.project_id !== activeProjectId) return false
            if (typeFilter !== 'all' && (row.task_type ?? 'automated') !== typeFilter) return false
            return true
          }
          const rowToCard = (row: TaskRow): KanbanCardType => ({
            id:          row.id,
            columnId:    row.column_id as ColumnId,
            projectId:   row.project_id,
            title:       row.title,
            description: row.description,
            assignee:    row.assignee,
            priority:    row.priority as KanbanCardType['priority'],
            assetUrl:    row.asset_url,
            revisionNote: row.revision_note,
            milestoneId: row.milestone_id,
            createdAt:   row.created_at,
            taskType:    (row.task_type as TaskType | undefined) ?? 'automated',
            dependsOn:   row.depends_on ?? [],
          })

          if (payload.eventType === 'INSERT') {
            const row = payload.new as TaskRow
            if (!matchesFilters(row)) return
            const card = rowToCard(row)
            setColumns(prev => ({
              ...prev,
              [card.columnId]: [...prev[card.columnId], card],
            }))
          } else if (payload.eventType === 'UPDATE') {
            const row = payload.new as TaskRow
            setColumns(prev => {
              const newCols = { ...prev }
              // Remove from old column everywhere
              for (const col of COLUMN_ORDER) {
                newCols[col] = newCols[col].filter(c => c.id !== row.id)
              }
              // Only re-insert if it still matches the active filters
              if (matchesFilters(row)) {
                const card = rowToCard(row)
                newCols[card.columnId] = [...newCols[card.columnId], card]
              }
              return newCols
            })
          } else if (payload.eventType === 'DELETE') {
            const id = (payload.old as { id: string }).id
            setColumns(prev => {
              const newCols = { ...prev }
              for (const col of COLUMN_ORDER) {
                newCols[col] = newCols[col].filter(c => c.id !== id)
              }
              return newCols
            })
          }
        },
      )
      .subscribe(status => {
        setIsRealtime(status === 'SUBSCRIBED')
      })

    return () => { supabase!.removeChannel(channel) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProjectId, typeFilter])

  // ── DnD sensors ───────────────────────────────────────────────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
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
      const [card] = sourceCards.splice(sourceCards.findIndex(c => c.id === activeId), 1)
      const targetCards = [...prev[targetColId]]
      const overIndex = targetCards.findIndex(c => c.id === overId)
      targetCards.splice(overIndex >= 0 ? overIndex : targetCards.length, 0, { ...card, columnId: targetColId })
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
    } else {
      // Cross-column was handled in onDragOver; persist to Supabase
      persistColumnChange(activeId, targetColId).catch(console.warn)
    }
  }

  function handleApprove(card: KanbanCardType, onDispatchResult: (ok: boolean) => void) {
    // 1. Move card to Completed
    setColumns(prev => ({
      ...prev,
      review:    prev['review'].filter(c => c.id !== card.id),
      completed: [...prev['completed'], { ...card, columnId: 'completed' as ColumnId }],
    }))
    // 2. Persist to Supabase
    persistColumnChange(card.id, 'completed').catch(console.warn)

    // 3. Append milestone completion to nexus-memory (fire-and-forget via API)
    {
      const now = new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
      const content = [
        `## ✅ Milestone Completed — ${card.title}`,
        `_Completed: ${now}_`,
        ``,
        card.description ?? '',
        `- Agent: ${card.assignee ?? 'OpenClaw'}`,
        card.assetUrl ? `- Asset: ${card.assetUrl}` : '',
      ].filter(Boolean).join('\n')
      fetch('/api/memory', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path:    `projects/${card.projectId ?? 'global'}/milestones.md`,
          mode:    'append',
          content,
          message: `board: milestone approved — ${card.title}`,
        }),
      }).catch(console.warn)
    }

    // 4. Dispatch to OpenClaw — "next task" signal
    const message =
      `Task approved by project owner: "${card.title}".\n\n` +
      `${card.milestoneId ? `Milestone ID: ${card.milestoneId}\n\n` : ''}` +
      `This deliverable has been reviewed and accepted. Please proceed to the next queued task or milestone in the project pipeline.`

    fetch('/api/claw', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'agent', payload: { message, name: 'Nexus Board', wakeMode: 'now' } }),
    })
      .then(r => onDispatchResult(r.ok || r.status === 401))  // 401 = not configured, still "ok" for UI
      .catch(() => onDispatchResult(false))

    setReviewCard(null)
  }

  function handleReject(card: KanbanCardType, revision: string) {
    setColumns(prev => ({
      ...prev,
      review:  prev['review'].filter(c => c.id !== card.id),
      backlog: [{ ...card, columnId: 'backlog', revisionNote: revision }, ...prev['backlog']],
    }))
    persistColumnChange(card.id, 'backlog').catch(console.warn)
    fetch('/api/board', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: card.id, columnId: 'backlog', revisionNote: revision }),
    }).catch(console.warn)
    setReviewCard(null)
  }

  const totalCards = COLUMN_ORDER.reduce((n, id) => n + columns[id].length, 0)
  const activeProject = projects.find(p => p.id === activeProjectId)

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#050508' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div
        className="shrink-0 flex items-center justify-between px-6 py-4 gap-4"
        style={{ borderBottom: '1px solid #24243e', backgroundColor: '#0d0d14' }}
      >
        <div>
          <h1 className="font-bold text-lg" style={{ color: '#e8e8f0' }}>Agent Board</h1>
          <div className="flex items-center gap-3 mt-0.5">
            <p className="text-xs" style={{ color: '#9090b0' }}>
              {totalCards} tasks across {COLUMN_ORDER.length} stages
            </p>
            {/* Data source badge */}
            {source !== 'loading' && (
              <span
                className="text-xs px-1.5 py-0.5 rounded"
                style={{
                  backgroundColor: '#12121e',
                  color: source === 'supabase' ? '#22c55e' : '#55556a',
                  border: '1px solid #24243e',
                }}
              >
                {source === 'supabase' ? 'Live data' : source === 'empty' ? 'No tasks' : 'Demo data'}
              </span>
            )}
            {/* Realtime indicator */}
            {isRealtime && (
              <span className="flex items-center gap-1 text-xs" style={{ color: '#6c63ff' }}>
                <Circle size={6} fill="#6c63ff" />
                Realtime
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Task-type filter (All / Automated / Manual) */}
          <div
            className="flex items-center rounded-lg overflow-hidden"
            style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
          >
            {([
              { id: 'all',       label: 'All',       Icon: Layers  },
              { id: 'automated', label: 'Automated', Icon: Bot     },
              { id: 'manual',    label: 'Manual',    Icon: UserIcon },
            ] as Array<{ id: TaskTypeFilter; label: string; Icon: typeof Bot }>).map(({ id, label, Icon }) => {
              const active = typeFilter === id
              return (
                <button
                  key={id}
                  onClick={() => setTypeFilter(id)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs transition-colors"
                  style={{
                    backgroundColor: active ? '#1a1a2e' : 'transparent',
                    color:           active ? '#e8e8f0' : '#9090b0',
                  }}
                  title={`Show ${label.toLowerCase()} tasks`}
                >
                  <Icon size={12} />
                  {label}
                </button>
              )
            })}
          </div>

          {/* Project filter */}
          {projects.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowProjectMenu(s => !s)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors"
                style={{
                  backgroundColor: '#12121e',
                  color: '#e8e8f0',
                  border: '1px solid #24243e',
                }}
              >
                <span className="max-w-[140px] truncate">
                  {activeProjectId === 'all' ? 'All projects' : (activeProject?.name ?? 'Unknown')}
                </span>
                <ChevronDown size={13} style={{ color: '#55556a' }} />
              </button>

              {showProjectMenu && (
                <div
                  className="absolute right-0 top-full mt-1 z-50 w-52 rounded-xl overflow-hidden shadow-2xl"
                  style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
                >
                  {[{ id: 'all', name: 'All projects' }, ...projects].map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setActiveProjectId(p.id); setShowProjectMenu(false) }}
                      className="w-full text-left px-4 py-2.5 text-sm transition-colors"
                      style={{
                        backgroundColor: activeProjectId === p.id ? '#1a1a2e' : 'transparent',
                        color: activeProjectId === p.id ? '#e8e8f0' : '#9090b0',
                        borderBottom: '1px solid #24243e',
                      }}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Refresh */}
          <button
            onClick={() => loadCards(activeProjectId, typeFilter)}
            className="w-8 h-8 flex items-center justify-center rounded-lg transition-colors"
            style={{ backgroundColor: '#12121e', color: '#55556a', border: '1px solid #24243e' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#55556a')}
            title="Refresh board"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ── Board ───────────────────────────────────────────────────────── */}
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

      {/* ── Review modal ────────────────────────────────────────────────── */}
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
