'use client'

/**
 * Org-chart visualisation per business. Each team renders as a card.
 * Operator picks a parent for any team via a small dropdown — the next
 * render redraws the tree.
 *
 * v1 = vertical tree with indentation. Drag-drop arrangement (Figma-like
 * canvas) is a follow-up if the operator asks.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, AlertCircle, X, GitBranch, ChevronRight, RotateCcw, GripVertical, Inbox } from 'lucide-react'
import type { BusinessRow } from '@/lib/business/types'
import { DEPARTMENTS } from '@/lib/teams/departments'

interface TeamRow {
  id:              string
  business_slug:   string | null
  department_slug: string
  status:          'active' | 'paused' | 'archived'
  parent_team_id:  string | null
}

export default function OrgChartClient({ businesses }: { businesses: BusinessRow[] }) {
  const [teams, setTeams]     = useState<TeamRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState<string | null>(null)
  const [err, setErr]         = useState<string | null>(null)
  // v5 drag-drop: id of the team currently being dragged. Cleared on drop / dragend.
  const [draggingId, setDraggingId] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await fetch('/api/teams')
      const json = (await res.json()) as { ok: boolean; teams?: TeamRow[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'load failed')
      setTeams(json.teams ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  async function setParent(teamId: string, parentTeamId: string | null) {
    setBusy(teamId); setErr(null)
    try {
      const res = await fetch(`/api/teams/${teamId}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ parentTeamId }),
      })
      const json = (await res.json()) as { ok: boolean; team?: TeamRow; error?: string }
      if (!json.ok || !json.team) throw new Error(json.error || 'reparent failed')
      setTeams(prev => prev.map(t => t.id === teamId ? { ...t, parent_team_id: json.team!.parent_team_id } : t))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'reparent failed')
    } finally {
      setBusy(null)
    }
  }

  const teamsByBusiness = useMemo(() => {
    const m = new Map<string, TeamRow[]>()
    for (const t of teams) {
      const k = t.business_slug ?? '_admin'
      const arr = m.get(k) ?? []
      arr.push(t); m.set(k, arr)
    }
    return m
  }, [teams])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm px-4 py-3"
           style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
        <Loader2 size={14} className="animate-spin" /> Loading org chart…
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {err && (
        <div className="px-3.5 py-2.5 flex items-start gap-2.5 text-sm"
             style={{ background: 'linear-gradient(135deg, rgba(239,68,68,0.10), rgba(239,68,68,0.02))',
                      border: '1px solid rgba(239,68,68,0.22)', borderRadius: '14px', color: '#e8e8f0' }}>
          <AlertCircle size={16} style={{ color: '#f87171' }} />
          <div className="flex-1">{err}</div>
          <button onClick={() => setErr(null)} className="rounded-md p-0.5" style={{ color: '#9090b0' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {businesses.length === 0 && (
        <div className="px-4 py-6 text-center text-sm"
             style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
          <GitBranch size={18} className="mx-auto mb-2" style={{ color: '#a8a3ff' }} />
          <div>No businesses yet — add one from <Link href="/businesses" className="font-mono" style={{ color: '#a8a3ff' }}>/businesses</Link> first.</div>
        </div>
      )}

      {businesses.map(b => (
        <BusinessTree
          key={b.slug}
          business={b}
          teams={teamsByBusiness.get(b.slug) ?? []}
          busy={busy}
          onSetParent={setParent}
          draggingId={draggingId}
          setDraggingId={setDraggingId}
        />
      ))}
    </div>
  )
}

function BusinessTree({ business, teams, busy, onSetParent, draggingId, setDraggingId }: {
  business:      BusinessRow
  teams:         TeamRow[]
  busy:          string | null
  onSetParent:   (teamId: string, parentTeamId: string | null) => Promise<void>
  draggingId:    string | null
  setDraggingId: (id: string | null) => void
}) {
  // Build child map: parent_team_id → children[]. null parent = root.
  const childMap = useMemo(() => {
    const m = new Map<string | null, TeamRow[]>()
    for (const t of teams) {
      const key = t.parent_team_id ?? null
      const arr = m.get(key) ?? []
      arr.push(t); m.set(key, arr)
    }
    return m
  }, [teams])

  return (
    <section className="p-4 space-y-3"
             style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                      border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px' }}>
      <header>
        <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{business.name}</div>
        <div className="text-[11px] mt-0.5 font-mono" style={{ color: '#a8a3ff' }}>{business.slug}</div>
      </header>
      {teams.length === 0 ? (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ color: '#9090b0', background: 'rgba(255,255,255,0.02)' }}>
          No teams. Visit <Link href="/teams" className="font-mono" style={{ color: '#a8a3ff' }}>/teams</Link> to spawn one.
        </div>
      ) : (
        <>
          {draggingId && <RootDropZone draggingId={draggingId} onDrop={() => { void onSetParent(draggingId, null); setDraggingId(null) }} />}
          <TreeBranch
            parent={null}
            depth={0}
            childMap={childMap}
            allTeams={teams}
            busy={busy}
            onSetParent={onSetParent}
            draggingId={draggingId}
            setDraggingId={setDraggingId}
          />
        </>
      )}
    </section>
  )
}

function TreeBranch({ parent, depth, childMap, allTeams, busy, onSetParent, draggingId, setDraggingId }: {
  parent:        string | null
  depth:         number
  childMap:      Map<string | null, TeamRow[]>
  allTeams:      TeamRow[]
  busy:          string | null
  onSetParent:   (teamId: string, parentTeamId: string | null) => Promise<void>
  draggingId:    string | null
  setDraggingId: (id: string | null) => void
}) {
  const children = childMap.get(parent) ?? []
  if (children.length === 0) return null
  return (
    <ul className="space-y-2">
      {children.map(t => (
        <li key={t.id} style={{ marginLeft: `${depth * 16}px` }}>
          <TreeNode team={t} allTeams={allTeams} busy={busy === t.id} onSetParent={onSetParent} depth={depth}
                    draggingId={draggingId} setDraggingId={setDraggingId} />
          <TreeBranch parent={t.id} depth={depth + 1} childMap={childMap} allTeams={allTeams} busy={busy}
                      onSetParent={onSetParent} draggingId={draggingId} setDraggingId={setDraggingId} />
        </li>
      ))}
    </ul>
  )
}

/** Drop zone that appears at the top of each business tree while a team
 *  is being dragged. Dropping on it detaches the team (sets parent=null). */
function RootDropZone({ draggingId, onDrop }: { draggingId: string; onDrop: () => void }) {
  const [over, setOver] = useState(false)
  return (
    <div
      onDragOver={e => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={e => { e.preventDefault(); setOver(false); onDrop() }}
      className="rounded-lg px-3 py-2 mb-2 flex items-center gap-2 text-xs transition-colors"
      style={{
        background: over ? 'rgba(108,99,255,0.15)' : 'rgba(108,99,255,0.04)',
        border:     `1px dashed ${over ? 'rgba(108,99,255,0.60)' : 'rgba(108,99,255,0.30)'}`,
        color:      '#e8e8f0',
      }}
    >
      <Inbox size={11} style={{ color: '#a8a3ff' }} />
      <span>Drop here to make this team a root reporter</span>
      <span className="ml-auto text-[10px] font-mono opacity-60">{draggingId.slice(0, 8)}</span>
    </div>
  )
}

function TreeNode({ team, allTeams, busy, onSetParent, depth, draggingId, setDraggingId }: {
  team:          TeamRow
  allTeams:      TeamRow[]
  busy:          boolean
  onSetParent:   (teamId: string, parentTeamId: string | null) => Promise<void>
  depth:         number
  draggingId:    string | null
  setDraggingId: (id: string | null) => void
}) {
  const dept = DEPARTMENTS[team.department_slug as keyof typeof DEPARTMENTS]
  const archived = team.status === 'archived'
  const candidates = useMemo(() => allTeams.filter(t => t.id !== team.id && !isDescendant(t.id, team.id, allTeams)), [allTeams, team.id])
  // Drop-target gating: a team can NOT be dropped onto itself OR onto one
  // of its own descendants (would form a cycle).
  const isDraggingSelf  = draggingId === team.id
  const isInvalidTarget = draggingId !== null && (isDraggingSelf || isDescendant(team.id, draggingId, allTeams))
  const [isDragOver, setIsDragOver] = useState(false)

  return (
    <div
      draggable={!archived && !busy}
      onDragStart={e => {
        if (archived) return
        setDraggingId(team.id)
        // Hint to the browser that we're MOVING the node (not copying).
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', team.id)
      }}
      onDragEnd={() => setDraggingId(null)}
      onDragOver={e => {
        if (!draggingId || isInvalidTarget) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        if (!isDragOver) setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={async e => {
        e.preventDefault()
        setIsDragOver(false)
        if (!draggingId || isInvalidTarget) return
        await onSetParent(draggingId, team.id)
        setDraggingId(null)
      }}
      className="px-3 py-2 rounded-lg flex items-center gap-2.5 transition-colors"
      style={{
        background: isDragOver
          ? 'rgba(108,99,255,0.18)'
          : 'rgba(255,255,255,0.02)',
        border: isDragOver
          ? '1px dashed rgba(108,99,255,0.60)'
          : isDraggingSelf
            ? '1px dashed rgba(168,163,255,0.40)'
            : '1px solid rgba(255,255,255,0.06)',
        opacity: archived ? 0.55 : isDraggingSelf ? 0.5 : 1,
        cursor: archived ? 'default' : busy ? 'progress' : 'grab',
      }}
    >
      {!archived && <GripVertical size={11} style={{ color: '#6a6a86', flexShrink: 0 }} />}
      {depth > 0 && <ChevronRight size={11} style={{ color: '#6a6a86' }} />}
      <div className="min-w-0 flex-1">
        <div className="text-sm" style={{ color: '#e8e8f0' }}>
          {dept?.label ?? team.department_slug}
        </div>
        <div className="text-[10px] mt-0.5" style={{ color: '#9090b0' }}>
          {team.status === 'paused'   && <span style={{ color: '#fbbf24' }}>PAUSED · </span>}
          {team.status === 'archived' && <span style={{ color: '#6a6a86' }}>ARCHIVED · </span>}
          {team.parent_team_id ? 'reports to a team' : 'root reporter'}
        </div>
      </div>
      {!archived && (
        <>
          <select
            value={team.parent_team_id ?? ''}
            onChange={async e => { await onSetParent(team.id, e.target.value || null) }}
            disabled={busy}
            className="text-[10px] px-1.5 py-1 rounded-md font-mono"
            style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.10)' }}
          >
            <option value="">— root —</option>
            {candidates.map(c => {
              const d = DEPARTMENTS[c.department_slug as keyof typeof DEPARTMENTS]
              return <option key={c.id} value={c.id}>{d?.label ?? c.department_slug}</option>
            })}
          </select>
          {team.parent_team_id && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => { await onSetParent(team.id, null) }}
              className="rounded-md p-1"
              style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              title="Detach (make this team a root reporter)"
            >
              {busy ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
            </button>
          )}
        </>
      )}
    </div>
  )
}

/** Walk the parent chain of `id` and check whether `candidate` appears.
 *  Used to filter the parent-picker so the operator can't form a cycle. */
function isDescendant(candidate: string, id: string, allTeams: TeamRow[]): boolean {
  const byId = new Map(allTeams.map(t => [t.id, t]))
  let cur: string | null = candidate
  const seen = new Set<string>()
  while (cur) {
    if (cur === id) return true
    if (seen.has(cur)) return false
    seen.add(cur)
    cur = byId.get(cur)?.parent_team_id ?? null
  }
  return false
}
