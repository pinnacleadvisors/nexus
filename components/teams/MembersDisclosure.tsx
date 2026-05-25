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

import { useEffect, useState } from 'react'
import { Loader2, ChevronDown, ChevronUp, Check, X } from 'lucide-react'

interface MemberRow {
  id:                  string
  team_id:             string
  role_slug:           string
  agent_spec_path:     string | null
  ecosystem_overrides: Record<string, string>
  tool_budget:         string[]
  tool_budget_override?: string[] | null
}

export default function MembersDisclosure({ teamId }: { teamId: string }) {
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
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
