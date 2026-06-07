'use client'

/**
 * /teams admin client. Lists teams the operator owns, per business, with a
 * spawn picker that lets them materialise any of the 7 starter departments.
 *
 * v1 — list + spawn only. Rebind / pause / archive land in a later phase.
 */

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, PlusCircle, Sparkles, Users, AlertCircle, X, Pause, Play, Archive, MoreHorizontal, Repeat } from 'lucide-react'
import type { BusinessRow } from '@/lib/business/types'
import { DEPARTMENT_ORDER, DEPARTMENTS, type DepartmentSlug } from '@/lib/teams/departments'
import { listAllEcosystems } from '@/lib/ecosystems/registry'
import type { EcosystemKind } from '@/lib/ecosystems/types'
import MembersDisclosure from './MembersDisclosure'
import TemplatesPanel from './TemplatesPanel'

interface TeamRow {
  id:                 string
  business_slug:      string | null
  department_slug:    DepartmentSlug
  status:             'active' | 'paused' | 'archived'
  ecosystem_bindings: Record<string, string>
  created_at:         string
}

export default function TeamsClient({ businesses }: { businesses: BusinessRow[] }) {
  const [teams,    setTeams]    = useState<TeamRow[]>([])
  const [loading,  setLoading]  = useState(true)
  const [busy,     setBusy]     = useState<string | null>(null)
  const [err,      setErr]      = useState<string | null>(null)
  // Which biz the operator is currently spawning into (null = no spawn open).
  const [spawnFor, setSpawnFor] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res  = await fetch('/api/teams')
      const json = (await res.json()) as { ok: boolean; teams?: TeamRow[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'load failed')
      setTeams(json.teams ?? [])
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'failed to load teams')
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { void load() }, [])

  async function spawn(businessSlug: string | null, dept: DepartmentSlug, niche: string | null) {
    const key = `${businessSlug ?? '_admin'}:${dept}`
    setBusy(key); setErr(null)
    try {
      const res  = await fetch('/api/teams/spawn', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ businessSlug, departmentSlug: dept, niche }),
      })
      const json = (await res.json()) as { ok: boolean; team?: TeamRow; error?: string }
      if (!json.ok || !json.team) throw new Error(json.error || 'spawn failed')
      setTeams(prev => [json.team!, ...prev])
      setSpawnFor(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'spawn failed')
    } finally {
      setBusy(null)
    }
  }

  /**
   * Update a team's status and/or ecosystem bindings via PATCH. We send the
   * FULL bindings map every time (the route doesn't support sparse patches)
   * so callers must merge their change with the existing bindings before
   * passing the result.
   */
  async function patchTeam(teamId: string, patch: { status?: TeamRow['status']; ecosystemBindings?: Record<string, string> }) {
    setBusy(teamId); setErr(null)
    try {
      const res  = await fetch(`/api/teams/${teamId}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify(patch),
      })
      const json = (await res.json()) as { ok: boolean; team?: TeamRow; error?: string }
      if (!json.ok || !json.team) throw new Error(json.error || 'update failed')
      setTeams(prev => prev.map(t => t.id === teamId ? json.team! : t))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'update failed')
    } finally {
      setBusy(null)
    }
  }

  // Group teams by business for the per-business sections.
  const teamsByBusiness = useMemo(() => {
    const m = new Map<string, TeamRow[]>()
    for (const t of teams) {
      const key = t.business_slug ?? '_admin'
      const arr = m.get(key) ?? []
      arr.push(t)
      m.set(key, arr)
    }
    return m
  }, [teams])

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm px-4 py-3"
           style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
        <Loader2 size={14} className="animate-spin" /> Loading teams…
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

      {businesses.length === 0 ? (
        <EmptyBusinessesCard />
      ) : (<></>)}

      {businesses.length > 0 && <TemplatesPanel businesses={businesses} />}

      {businesses.length > 0 && (
        businesses.map(b => (
          <BusinessTeamsBlock
            key={b.slug}
            business={b}
            teams={teamsByBusiness.get(b.slug) ?? []}
            spawnOpen={spawnFor === b.slug}
            onOpenSpawn={() => setSpawnFor(b.slug)}
            onCloseSpawn={() => setSpawnFor(null)}
            busy={busy}
            onSpawn={dept => void spawn(b.slug, dept, b.niche)}
            onPatch={patchTeam}
          />
        ))
      )}
    </div>
  )
}

function EmptyBusinessesCard() {
  return (
    <div className="px-5 py-6 text-center"
         style={{
           background: 'linear-gradient(135deg, rgba(108,99,255,0.06), rgba(255,255,255,0.02))',
           border:     '1px solid rgba(108,99,255,0.22)',
           borderRadius: '14px',
         }}>
      <div
        className="h-10 w-10 mx-auto mb-3 rounded-lg flex items-center justify-center"
        style={{
          background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
          border:     '1px solid rgba(108,99,255,0.30)',
        }}
      >
        <Users size={18} style={{ color: '#a8a3ff' }} />
      </div>
      <h3 className="text-sm font-semibold mb-1.5" style={{ color: '#e8e8f0' }}>
        Spawn your first team
      </h3>
      <p className="text-xs leading-relaxed mb-4 max-w-md mx-auto" style={{ color: '#9090b0' }}>
        Teams are department rosters bound to a business — engineering, content, sales-CS, ops, etc. Each spawn auto-wires the right ecosystem adapters (video / design / code) based on the business&apos;s niche. Create a business first; you can spawn teams the moment its row exists.
      </p>
      <Link
        href="/businesses/new"
        className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition"
        style={{
          background: 'rgba(108,99,255,0.18)',
          border:     '1px solid rgba(108,99,255,0.35)',
          color:      '#c4b5fd',
        }}
      >
        Create first business →
      </Link>
    </div>
  )
}

function BusinessTeamsBlock({ business, teams, spawnOpen, onOpenSpawn, onCloseSpawn, busy, onSpawn, onPatch }: {
  business:     BusinessRow
  teams:        TeamRow[]
  spawnOpen:    boolean
  onOpenSpawn:  () => void
  onCloseSpawn: () => void
  busy:         string | null
  onSpawn:      (dept: DepartmentSlug) => void
  onPatch:      (teamId: string, patch: { status?: TeamRow['status']; ecosystemBindings?: Record<string, string> }) => Promise<void>
}) {
  const taken = new Set(teams.map(t => t.department_slug))
  const remaining = DEPARTMENT_ORDER.filter(s => !taken.has(s))

  return (
    <section className="p-4 space-y-3"
             style={{ background: 'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                      border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px' }}>
      <header className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{business.name}</div>
          <div className="text-[11px] mt-0.5 flex items-center gap-1.5" style={{ color: '#9090b0' }}>
            <span className="font-mono" style={{ color: '#a8a3ff' }}>{business.slug}</span>
            <span style={{ color: '#55556a' }}>·</span>
            <span>{business.niche}</span>
          </div>
        </div>
        {remaining.length > 0 && !spawnOpen && (
          <button
            type="button"
            onClick={onOpenSpawn}
            className="text-[11px] px-2.5 py-1.5 rounded-lg inline-flex items-center gap-1.5"
            style={{ color: '#e8e8f0', background: 'rgba(108,99,255,0.10)', border: '1px solid rgba(108,99,255,0.30)' }}
          >
            <PlusCircle size={12} /> Add department
          </button>
        )}
      </header>

      {teams.length === 0 && !spawnOpen && (
        <div className="text-xs px-3 py-2 rounded-lg" style={{ color: '#9090b0', background: 'rgba(255,255,255,0.02)' }}>
          No departments spawned yet. Click &quot;Add department&quot; to start.
        </div>
      )}

      {teams.map(t => <TeamCard key={t.id} team={t} busy={busy === t.id} onPatch={p => onPatch(t.id, p)} />)}

      {spawnOpen && (
        <SpawnPicker
          remaining={remaining}
          busy={busy}
          businessSlug={business.slug}
          onSpawn={onSpawn}
          onClose={onCloseSpawn}
        />
      )}
    </section>
  )
}

function TeamCard({ team, busy, onPatch }: {
  team:    TeamRow
  busy:    boolean
  onPatch: (patch: { status?: TeamRow['status']; ecosystemBindings?: Record<string, string> }) => Promise<void>
}) {
  const dept = DEPARTMENTS[team.department_slug]
  const [menuOpen, setMenuOpen] = useState(false)
  // Track which binding chip is in "rebind picker" mode (kind name, or null).
  const [rebindFor, setRebindFor] = useState<string | null>(null)

  const archived = team.status === 'archived'
  const paused   = team.status === 'paused'

  return (
    <div className="px-3 py-2.5 rounded-lg flex items-start gap-3"
         style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
                  opacity: archived ? 0.55 : 1 }}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{dept?.label ?? team.department_slug}</div>
        <div className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>{dept?.purpose}</div>
        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
          {Object.entries(team.ecosystem_bindings).map(([kind, name]) => (
            <BindingChip
              key={kind}
              kindRaw={kind}
              name={name}
              editing={rebindFor === kind}
              busy={busy}
              onClick={() => !archived && setRebindFor(prev => prev === kind ? null : kind)}
              onPick={async newName => {
                if (newName === name) { setRebindFor(null); return }
                const next = { ...team.ecosystem_bindings, [kind]: newName }
                await onPatch({ ecosystemBindings: next })
                setRebindFor(null)
              }}
              onCancel={() => setRebindFor(null)}
            />
          ))}
        </div>
        {!archived && <MembersDisclosure teamId={team.id} teamBindings={team.ecosystem_bindings} />}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0 relative">
        <span className="text-[9px] font-mono tracking-[0.12em] px-1.5 py-0.5 rounded-full"
              style={{
                color:      team.status === 'active' ? '#4ade80' : team.status === 'paused' ? '#fbbf24' : '#9090b0',
                background: team.status === 'active' ? 'rgba(34,197,94,0.10)' : team.status === 'paused' ? 'rgba(251,191,36,0.10)' : 'rgba(255,255,255,0.04)',
                border:     team.status === 'active' ? '1px solid rgba(34,197,94,0.20)' : team.status === 'paused' ? '1px solid rgba(251,191,36,0.22)' : '1px solid rgba(255,255,255,0.08)',
              }}>
          {team.status.toUpperCase()}
        </span>
        {!archived && (
          <button type="button" onClick={() => setMenuOpen(o => !o)} disabled={busy}
                  className="rounded-md p-1 transition-colors disabled:opacity-40"
                  style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
                  title="Team actions">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <MoreHorizontal size={11} />}
          </button>
        )}
        {menuOpen && !archived && (
          <div className="absolute right-0 top-full mt-1 z-10 min-w-[140px] rounded-lg overflow-hidden"
               style={{ background: 'rgba(5,5,16,0.92)', border: '1px solid rgba(255,255,255,0.10)',
                        backdropFilter: 'blur(20px)', boxShadow: '0 24px 48px -12px rgba(0,0,0,0.6)' }}>
            {paused ? (
              <MenuItem icon={<Play size={11} />} label="Resume" onClick={async () => { setMenuOpen(false); await onPatch({ status: 'active' }) }} />
            ) : (
              <MenuItem icon={<Pause size={11} />} label="Pause" onClick={async () => { setMenuOpen(false); await onPatch({ status: 'paused' }) }} />
            )}
            <MenuItem icon={<Archive size={11} />} label="Archive" onClick={async () => {
              setMenuOpen(false)
              if (confirm('Archive this team? It becomes read-only.')) await onPatch({ status: 'archived' })
            }} danger />
          </div>
        )}
      </div>
    </div>
  )
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
            className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[11px] transition-colors"
            style={{ color: danger ? '#f87171' : '#e8e8f0', background: 'transparent' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)' }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>
      {icon}{label}
    </button>
  )
}

/** Chip showing one ecosystem binding. Click to enter rebind mode, which
 *  swaps the chip for a small dropdown of every adapter of the same kind. */
function BindingChip({ kindRaw, name, editing, busy, onClick, onPick, onCancel }: {
  kindRaw:  string
  name:     string
  editing:  boolean
  busy:     boolean
  onClick:  () => void
  onPick:   (newName: string) => Promise<void>
  onCancel: () => void
}) {
  // Filter the registry to adapters of this kind. listEcosystemsByKind is
  // not directly exposed in older registry builds, so we filter manually.
  const candidates = useMemo(() => {
    return listAllEcosystems().filter(a => a.kind === (kindRaw as EcosystemKind))
  }, [kindRaw])

  if (!editing) {
    return (
      <button type="button" onClick={onClick} disabled={busy}
              data-testid={`binding-chip-${kindRaw}`}
              className="text-[10px] px-1.5 py-0.5 rounded-md font-mono inline-flex items-center gap-1 transition-colors disabled:opacity-50"
              style={{ color: '#a8a3ff', background: 'rgba(108,99,255,0.10)', border: '1px solid rgba(108,99,255,0.22)' }}
              title="Click to rebind">
        <Repeat size={9} className="opacity-60" />
        {kindRaw}: {name}
      </button>
    )
  }
  return (
    <div className="inline-flex items-center gap-1">
      <select
        defaultValue={name}
        disabled={busy}
        onChange={async e => { await onPick(e.target.value) }}
        data-testid={`binding-picker-${kindRaw}`}
        aria-label={`Pick a ${kindRaw} adapter`}
        className="text-[10px] px-1.5 py-0.5 rounded-md font-mono"
        style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(108,99,255,0.40)' }}
      >
        {candidates.map(c => (
          <option key={c.name} value={c.name} data-adapter-name={c.name}>{c.label} {c.available() ? '' : '(unwired)'}</option>
        ))}
      </select>
      <button type="button" onClick={onCancel} className="text-[10px]" style={{ color: '#9090b0' }}>cancel</button>
    </div>
  )
}

function SpawnPicker({ remaining, busy, businessSlug, onSpawn, onClose }: {
  remaining:    readonly DepartmentSlug[]
  busy:         string | null
  businessSlug: string
  onSpawn:      (dept: DepartmentSlug) => void
  onClose:      () => void
}) {
  return (
    <div className="px-3 py-3 rounded-lg space-y-2"
         style={{ background: 'rgba(108,99,255,0.06)', border: '1px solid rgba(108,99,255,0.22)' }}>
      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: '#e8e8f0' }}>Pick a department to spawn</span>
        <button onClick={onClose} className="text-[10px]" style={{ color: '#9090b0' }}>cancel</button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {remaining.map(slug => {
          const d   = DEPARTMENTS[slug]
          const key = `${businessSlug}:${slug}`
          const isBusy = busy === key
          return (
            <button
              key={slug}
              type="button"
              onClick={() => onSpawn(slug)}
              disabled={isBusy}
              className="text-left px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{d.label}</span>
                {isBusy ? <Loader2 size={11} className="animate-spin" style={{ color: '#9090b0' }} /> : <Sparkles size={11} style={{ color: '#a8a3ff' }} />}
              </div>
              <div className="text-[11px] mt-0.5 line-clamp-2" style={{ color: '#9090b0' }}>{d.purpose}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
