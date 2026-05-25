'use client'

/**
 * /teams admin client. Lists teams the operator owns, per business, with a
 * spawn picker that lets them materialise any of the 7 starter departments.
 *
 * v1 — list + spawn only. Rebind / pause / archive land in a later phase.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, PlusCircle, Sparkles, Users, AlertCircle, X } from 'lucide-react'
import type { BusinessRow } from '@/lib/business/types'
import { DEPARTMENT_ORDER, DEPARTMENTS, type DepartmentSlug } from '@/lib/teams/departments'

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
      ) : (
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
          />
        ))
      )}
    </div>
  )
}

function EmptyBusinessesCard() {
  return (
    <div className="px-4 py-6 text-center text-sm"
         style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)', borderRadius: '14px' }}>
      <Users size={18} className="mx-auto mb-2" style={{ color: '#a8a3ff' }} />
      <div>No businesses yet — add one from <span className="font-mono" style={{ color: '#a8a3ff' }}>/businesses</span> first.</div>
    </div>
  )
}

function BusinessTeamsBlock({ business, teams, spawnOpen, onOpenSpawn, onCloseSpawn, busy, onSpawn }: {
  business:     BusinessRow
  teams:        TeamRow[]
  spawnOpen:    boolean
  onOpenSpawn:  () => void
  onCloseSpawn: () => void
  busy:         string | null
  onSpawn:      (dept: DepartmentSlug) => void
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
          No departments spawned yet. Click "Add department" to start.
        </div>
      )}

      {teams.map(t => <TeamCard key={t.id} team={t} />)}

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

function TeamCard({ team }: { team: TeamRow }) {
  const dept = DEPARTMENTS[team.department_slug]
  return (
    <div className="px-3 py-2.5 rounded-lg flex items-start gap-3"
         style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{dept?.label ?? team.department_slug}</div>
        <div className="text-[11px] mt-0.5" style={{ color: '#9090b0' }}>{dept?.purpose}</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(team.ecosystem_bindings).map(([kind, name]) => (
            <span key={kind} className="text-[10px] px-1.5 py-0.5 rounded-md font-mono"
                  style={{ color: '#a8a3ff', background: 'rgba(108,99,255,0.10)', border: '1px solid rgba(108,99,255,0.22)' }}>
              {kind}: {name}
            </span>
          ))}
        </div>
      </div>
      <span className="text-[9px] font-mono tracking-[0.12em] px-1.5 py-0.5 rounded-full shrink-0"
            style={{ color: team.status === 'active' ? '#4ade80' : '#fbbf24',
                     background: team.status === 'active' ? 'rgba(34,197,94,0.10)' : 'rgba(251,191,36,0.10)',
                     border: `1px solid ${team.status === 'active' ? 'rgba(34,197,94,0.20)' : 'rgba(251,191,36,0.22)'}` }}>
        {team.status.toUpperCase()}
      </span>
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
