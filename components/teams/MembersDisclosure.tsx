'use client'

/**
 * Per-team member-list disclosure. Renders inside each TeamCard.
 *
 * Surfaces:
 *   - the team's roster (role slug + spec path + current tool budget)
 *   - inline edit for tool_budget_override (comma-separated text field)
 *   - inline rebind of per-member ecosystem_overrides (one chip per kind)
 *
 * v4 — tool budget shown as a CSV input. The override is a power-user
 * surface so the textual edit is fine; a drag-drop tool picker is a
 * later iteration.
 */

import { useEffect, useMemo, useState } from 'react'
import { Loader2, ChevronDown, ChevronUp, Check, X, Repeat } from 'lucide-react'
import { listAllEcosystems } from '@/lib/ecosystems/registry'
import type { EcosystemKind } from '@/lib/ecosystems/types'

interface MemberRow {
  id:                  string
  team_id:             string
  role_slug:           string
  agent_spec_path:     string | null
  ecosystem_overrides: Record<string, string>
  tool_budget:         string[]
  tool_budget_override?: string[] | null
}

export default function MembersDisclosure({ teamId, teamBindings }: { teamId: string; teamBindings: Record<string, string> }) {
  const [open, setOpen]         = useState(false)
  const [loading, setLoading]   = useState(false)
  const [loaded, setLoaded]     = useState(false)
  const [members, setMembers]   = useState<MemberRow[]>([])
  const [err, setErr]           = useState<string | null>(null)
  const [editing, setEditing]   = useState<string | null>(null)
  const [draft, setDraft]       = useState('')
  const [saving, setSaving]     = useState<string | null>(null)

  async function load() {
    setLoading(true); setErr(null)
    try {
      const res = await fetch(`/api/teams/${teamId}/members`)
      const json = (await res.json()) as { ok: boolean; members?: MemberRow[]; error?: string }
      if (!json.ok) throw new Error(json.error || 'load failed')
      setMembers(json.members ?? [])
      setLoaded(true)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'load failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && !loaded) void load()
  }, [open, loaded])

  async function saveOverride(member: MemberRow) {
    setSaving(member.id); setErr(null)
    try {
      const csv  = draft.trim()
      // Empty string → null (clear the override; revert to team-level budget).
      const next = csv.length === 0 ? null : csv.split(',').map(s => s.trim()).filter(Boolean)
      const res  = await fetch(`/api/teams/${teamId}/members/${member.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ toolBudgetOverride: next }),
      })
      const json = (await res.json()) as { ok: boolean; member?: MemberRow; error?: string }
      if (!json.ok || !json.member) throw new Error(json.error || 'save failed')
      setMembers(prev => prev.map(m => m.id === member.id ? json.member! : m))
      setEditing(null); setDraft('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(null)
    }
  }

  /** Rebind one ecosystem kind for one member. Pass empty string to clear
   *  the override (revert to team-level binding). */
  async function saveEcosystemOverride(member: MemberRow, kind: string, newName: string) {
    setSaving(member.id); setErr(null)
    try {
      const nextOverrides = { ...member.ecosystem_overrides }
      if (newName) nextOverrides[kind] = newName
      else delete nextOverrides[kind]
      const res = await fetch(`/api/teams/${teamId}/members/${member.id}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ ecosystemOverrides: nextOverrides }),
      })
      const json = (await res.json()) as { ok: boolean; member?: MemberRow; error?: string }
      if (!json.ok || !json.member) throw new Error(json.error || 'save failed')
      setMembers(prev => prev.map(m => m.id === member.id ? json.member! : m))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'save failed')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(o => !o)}
              className="text-[10px] inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md"
              style={{ color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
        {open ? <ChevronUp size={9} /> : <ChevronDown size={9} />} members
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {loading && (
            <div className="text-[11px] flex items-center gap-1.5" style={{ color: '#9090b0' }}>
              <Loader2 size={10} className="animate-spin" /> loading members…
            </div>
          )}
          {err && (
            <div className="text-[11px]" style={{ color: '#f87171' }}>{err}</div>
          )}
          {members.length === 0 && loaded && !loading && (
            <div className="text-[11px]" style={{ color: '#9090b0' }}>No members on this team yet.</div>
          )}
          {members.map(m => {
            const effective = m.tool_budget_override ?? m.tool_budget
            return (
              <div key={m.id} className="rounded-md px-2 py-1.5"
                   style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div className="flex items-center gap-2 text-[11px]">
                  <span style={{ color: '#e8e8f0' }}>{m.role_slug}</span>
                  {m.tool_budget_override && (
                    <span className="text-[9px] px-1 py-0.5 rounded-md font-mono"
                          style={{ color: '#fbbf24', background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.22)' }}>
                      override
                    </span>
                  )}
                </div>
                {editing === m.id ? (
                  <div className="mt-1 flex items-center gap-1.5">
                    <input
                      type="text"
                      value={draft}
                      onChange={e => setDraft(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') void saveOverride(m); if (e.key === 'Escape') { setEditing(null); setDraft('') } }}
                      placeholder="claude, memory-hq, tavily (empty to clear)"
                      className="flex-1 text-[10px] px-1.5 py-0.5 rounded-md font-mono"
                      style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(255,255,255,0.10)' }}
                      autoFocus
                    />
                    <button type="button" onClick={() => void saveOverride(m)} disabled={saving === m.id}
                            className="rounded-md p-0.5" style={{ color: '#4ade80' }} title="Save">
                      {saving === m.id ? <Loader2 size={10} className="animate-spin" /> : <Check size={10} />}
                    </button>
                    <button type="button" onClick={() => { setEditing(null); setDraft('') }}
                            className="rounded-md p-0.5" style={{ color: '#9090b0' }} title="Cancel">
                      <X size={10} />
                    </button>
                  </div>
                ) : (
                  <button type="button"
                          onClick={() => { setEditing(m.id); setDraft((m.tool_budget_override ?? m.tool_budget).join(', ')) }}
                          className="mt-1 text-left text-[10px] font-mono w-full px-1 py-0.5 rounded-md transition-colors"
                          style={{ color: '#a8a3ff' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.03)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
                          title="Click to override the tool budget for this role">
                    [{effective.join(', ') || '—'}]
                  </button>
                )}
                <EcosystemOverrideRow
                  member={m}
                  teamBindings={teamBindings}
                  busy={saving === m.id}
                  onChange={(kind, newName) => void saveEcosystemOverride(m, kind, newName)}
                />
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/**
 * One row of "kind → bound adapter" chips per member. Each chip shows the
 * effective binding (member override OR team default). Click a chip to
 * open a dropdown of all adapters of that kind; pick a new one to set the
 * override; pick the SAME as the team default to clear the override.
 */
function EcosystemOverrideRow({ member, teamBindings, busy, onChange }: {
  member:       MemberRow
  teamBindings: Record<string, string>
  busy:         boolean
  onChange:     (kind: string, newName: string) => void
}) {
  const [editing, setEditing] = useState<string | null>(null)
  const kinds = useMemo(() => {
    // Show one chip per kind the team uses. Member-level overrides for
    // unused kinds (rare) also surface so the operator can clear them.
    const set = new Set<string>([...Object.keys(teamBindings), ...Object.keys(member.ecosystem_overrides)])
    return [...set].sort()
  }, [teamBindings, member.ecosystem_overrides])

  if (kinds.length === 0) return null

  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {kinds.map(kind => {
        const isOverride  = kind in member.ecosystem_overrides
        const effective   = member.ecosystem_overrides[kind] ?? teamBindings[kind] ?? '—'
        const teamDefault = teamBindings[kind]
        if (editing === kind) {
          return (
            <EcosystemPicker
              key={kind}
              kind={kind}
              current={effective}
              teamDefault={teamDefault}
              busy={busy}
              onPick={name => { onChange(kind, name); setEditing(null) }}
              onCancel={() => setEditing(null)}
            />
          )
        }
        return (
          <button
            key={kind}
            type="button"
            onClick={() => setEditing(kind)}
            disabled={busy}
            className="text-[9px] px-1.5 py-0.5 rounded-md font-mono inline-flex items-center gap-1 disabled:opacity-50 transition-colors"
            style={isOverride
              ? { color: '#fbbf24', background: 'rgba(251,191,36,0.10)', border: '1px solid rgba(251,191,36,0.22)' }
              : { color: '#9090b0', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
            title={isOverride ? `override: ${effective} (team default: ${teamDefault ?? 'none'})` : `inherits team default: ${effective}`}
          >
            <Repeat size={7} className="opacity-60" />
            {kind}: {effective}
          </button>
        )
      })}
    </div>
  )
}

function EcosystemPicker({ kind, current, teamDefault, busy, onPick, onCancel }: {
  kind:        string
  current:     string
  teamDefault: string | undefined
  busy:        boolean
  onPick:      (name: string) => void
  onCancel:    () => void
}) {
  const candidates = useMemo(() => {
    return listAllEcosystems().filter(a => a.kind === (kind as EcosystemKind))
  }, [kind])
  return (
    <div className="inline-flex items-center gap-1">
      <select
        defaultValue={current}
        disabled={busy}
        onChange={e => {
          // Picking the team default = clearing the override.
          const picked = e.target.value
          onPick(picked === teamDefault ? '' : picked)
        }}
        className="text-[9px] px-1 py-0.5 rounded-md font-mono"
        style={{ color: '#e8e8f0', background: 'rgba(5,5,16,0.55)', border: '1px solid rgba(108,99,255,0.40)' }}
      >
        {candidates.map(c => (
          <option key={c.name} value={c.name}>
            {c.label}{c.name === teamDefault ? ' (team default)' : ''}{c.available() ? '' : ' (unwired)'}
          </option>
        ))}
      </select>
      <button type="button" onClick={onCancel} className="text-[9px]" style={{ color: '#9090b0' }}>cancel</button>
    </div>
  )
}
