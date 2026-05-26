'use client'

/**
 * MissionPanel — inline mission editor for a business overview.
 *
 * Renders the saved mission as prose by default. Clicking Edit swaps the
 * prose for a textarea + save/cancel pair. Save → PATCH /api/businesses/[slug]
 * with `{ mission }`. Optimistic update so the prose flips immediately.
 *
 * Before this was editable the panel told the operator "Set mission on the
 * business row in Settings" — but there was no Settings UI for it. PR #344's
 * walkthrough flagged that as P3, this is the fix.
 */

import { useState } from 'react'
import { Target, Pencil, Loader2, X, Check } from 'lucide-react'

interface Props {
  slug:       string
  mission:    string | null
  brandVoice: string | null
}

export default function MissionPanel({ slug, mission: initialMission, brandVoice }: Props) {
  const [mission, setMission] = useState<string | null>(initialMission)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft]     = useState<string>(initialMission ?? '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState<string | null>(null)

  async function save(): Promise<void> {
    setSaving(true)
    setError(null)
    try {
      const next = draft.trim().length === 0 ? null : draft.trim()
      const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}`, {
        method:  'PATCH',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ mission: next }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!j.ok) {
        setError(j.error ?? 'unknown_error')
        return
      }
      setMission(next)
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'save_failed')
    } finally {
      setSaving(false)
    }
  }

  function startEdit(): void {
    setDraft(mission ?? '')
    setError(null)
    setEditing(true)
  }
  function cancel(): void {
    setDraft(mission ?? '')
    setEditing(false)
    setError(null)
  }

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Target className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Mission</h3>
        <span className="flex-1" />
        {!editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1 rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1 text-xs text-zinc-300 transition hover:bg-zinc-800/70"
            title={mission ? 'Edit mission' : 'Set mission'}
          >
            <Pencil className="h-3 w-3" />
            {mission ? 'Edit' : 'Set'}
          </button>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            disabled={saving}
            placeholder="One paragraph: what this business does, who it serves, and the bet. Max 1000 chars."
            rows={4}
            maxLength={1000}
            className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>{draft.length} / 1000</span>
            {error && (
              <span className="text-rose-400" role="alert">Save failed: {error}</span>
            )}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                disabled={saving}
                className="inline-flex items-center gap-1 rounded-md border border-zinc-700/60 bg-zinc-800/40 px-2 py-1 text-zinc-300 transition hover:bg-zinc-800/70 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || draft === (mission ?? '')}
                className="inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-600/15 px-2 py-1 font-medium text-emerald-300 transition hover:bg-emerald-600/25 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                Save
              </button>
            </div>
          </div>
        </div>
      ) : mission ? (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-zinc-200">{mission}</p>
      ) : (
        <p className="text-sm italic text-zinc-500">
          No mission set. Click <strong>Set</strong> above to add one — keep it short and durable.
        </p>
      )}

      {brandVoice ? (
        <div className="mt-4 border-t border-zinc-800 pt-3">
          <h4 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Brand voice</h4>
          <p className="mt-1 text-sm text-zinc-400">{brandVoice}</p>
        </div>
      ) : null}
    </div>
  )
}
