'use client'

/**
 * NotesView — per-scope markdown scratchpad.
 *
 * One blob per (user, scope). Not per session. Same scope opened in multiple
 * chat tabs share one set of notes. Concurrent edits use last-write-wins
 * with a soft conflict warning: on a stale-version save, a banner offers
 * "Discard local" / "Overwrite anyway" buttons.
 *
 * Autosave is debounced 800ms after the last keystroke. No save button —
 * the status line ("Saved 12s ago" / "Saving…" / "Conflict" / "Save failed")
 * tells the operator what's happening.
 *
 * Phase V1 of task_plan-chat-views.md (also Block B of task_plan-this-week.md).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react'

interface Props {
  scope: string   // 'admin' | 'business:<slug>'
}

interface NoteShape {
  body:       string
  updated_at: string
}

interface GetResp { ok: true;  note: NoteShape | null }
interface PutOk   { ok: true;  note: NoteShape }
interface PutConflict { ok: false; conflict: true;  current: NoteShape }
interface PutError    { ok: false; conflict: false; error: string }
type PutResp = PutOk | PutConflict | PutError

type SaveStatus =
  | { kind: 'idle';     savedAt: number | null }
  | { kind: 'dirty' }
  | { kind: 'saving' }
  | { kind: 'saved';    at: number }
  | { kind: 'conflict'; current: NoteShape }
  | { kind: 'error';    detail: string }

const DEBOUNCE_MS = 800

export default function NotesView({ scope }: Props) {
  const [body, setBody]         = useState<string>('')
  const [updatedAt, setUpdated] = useState<string | null>(null)
  const [status, setStatus]     = useState<SaveStatus>({ kind: 'idle', savedAt: null })
  const [loaded, setLoaded]     = useState(false)

  // Latest body value seen by the debounce timer — ref so the timer fires
  // with whatever the operator just typed, not a stale closure value.
  const latestBody = useRef<string>('')
  latestBody.current = body
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initial fetch.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(`/api/views/notes?scope=${encodeURIComponent(scope)}`, { cache: 'no-store' })
        const j = (await res.json()) as GetResp | { ok: false; error: string }
        if (cancelled) return
        if (!('ok' in j) || !j.ok) {
          setStatus({ kind: 'error', detail: 'load failed' })
          return
        }
        if (j.note) {
          setBody(j.note.body)
          setUpdated(j.note.updated_at)
        }
        setLoaded(true)
      } catch (e) {
        if (!cancelled) setStatus({ kind: 'error', detail: e instanceof Error ? e.message : 'load failed' })
      }
    })()
    return () => { cancelled = true }
  }, [scope])

  // Save dispatch. expectedUpdatedAt is the timestamp we saw last time —
  // null on the very first save (no row exists yet).
  const save = useCallback(async (expectedUpdatedAt: string | null, overrideBody?: string) => {
    setStatus({ kind: 'saving' })
    try {
      const res = await fetch('/api/views/notes', {
        method:  'PUT',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          scope,
          body:                overrideBody ?? latestBody.current,
          expected_updated_at: expectedUpdatedAt,
        }),
      })
      const j = (await res.json()) as PutResp | { ok: false; error: string }
      if ('conflict' in j && j.conflict === true) {
        setStatus({ kind: 'conflict', current: j.current })
        return
      }
      if (j.ok) {
        setUpdated(j.note.updated_at)
        setStatus({ kind: 'saved', at: Date.now() })
        return
      }
      setStatus({ kind: 'error', detail: ('error' in j && j.error) || 'save failed' })
    } catch (e) {
      setStatus({ kind: 'error', detail: e instanceof Error ? e.message : 'save failed' })
    }
  }, [scope])

  // Debounced autosave on edit. Schedules a save DEBOUNCE_MS after the
  // last keystroke. Replacing the timer on each keystroke means the
  // operator doesn't see "Saving…" flicker mid-typing.
  useEffect(() => {
    if (!loaded)                      return
    if (status.kind === 'conflict')   return  // operator must resolve before more saves
    setStatus({ kind: 'dirty' })
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => { void save(updatedAt) }, DEBOUNCE_MS)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [body, loaded])

  // Conflict resolution: either accept the server version (discard local)
  // or force-overwrite (server's body lost). Both clear the conflict.
  function discardLocal() {
    if (status.kind !== 'conflict') return
    setBody(status.current.body)
    setUpdated(status.current.updated_at)
    setStatus({ kind: 'saved', at: Date.now() })
  }
  function overwriteAnyway() {
    if (status.kind !== 'conflict') return
    // expectedUpdatedAt = null bypasses the concurrency check.
    void save(null, latestBody.current)
  }

  return (
    <div className="flex flex-col h-full">
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        disabled={!loaded || status.kind === 'conflict'}
        placeholder={loaded ? 'Markdown scratchpad — autosaved.\n\nLinks, todos, decisions, anything the agent doesn\'t need to see.' : 'Loading…'}
        className="flex-1 w-full resize-none outline-none p-4 font-mono text-[13px] leading-relaxed"
        style={{
          background:    'transparent',
          color:         '#e8e8f0',
          tabSize:       2,
        }}
        spellCheck={false}
      />

      <StatusFooter status={status} onDiscard={discardLocal} onOverwrite={overwriteAnyway} />
    </div>
  )
}

function StatusFooter({ status, onDiscard, onOverwrite }: { status: SaveStatus; onDiscard: () => void; onOverwrite: () => void }) {
  if (status.kind === 'conflict') {
    return (
      <div
        className="px-4 py-2.5 flex items-start gap-2 text-xs"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)', background: 'rgba(239,68,68,0.06)' }}
      >
        <AlertTriangle size={14} style={{ color: '#fca5a5', marginTop: 1 }} />
        <div className="flex-1">
          <div style={{ color: '#fca5a5' }}>Conflict — another tab saved newer notes.</div>
          <div className="mt-1 flex gap-2">
            <button
              onClick={onDiscard}
              className="px-2 py-1 rounded text-[11px]"
              style={{ background: 'rgba(255,255,255,0.06)', color: '#e8e8f0' }}
            >Discard local + load remote</button>
            <button
              onClick={onOverwrite}
              className="px-2 py-1 rounded text-[11px]"
              style={{ background: 'rgba(239,68,68,0.20)', color: '#fca5a5' }}
            >Overwrite anyway</button>
          </div>
        </div>
      </div>
    )
  }

  let label: string
  let Icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }> | null = null
  let color = '#9090b0'

  if (status.kind === 'idle')       { label = 'Idle' }
  else if (status.kind === 'dirty') { label = 'Unsaved changes' }
  else if (status.kind === 'saving'){ label = 'Saving…'; Icon = Loader2 }
  // eslint-disable-next-line react-hooks/purity -- pre-existing render-time value; refactor tracked separately
  else if (status.kind === 'saved') { label = `Saved ${humaniseAgo(Date.now() - status.at)}`; Icon = CheckCircle2; color = '#86efac' }
  else                              { label = `Save failed — ${status.detail}`; Icon = AlertTriangle; color = '#fca5a5' }

  return (
    <div
      className="px-4 py-2 flex items-center gap-2 text-[11px] shrink-0"
      style={{ borderTop: '1px solid rgba(255,255,255,0.06)', color }}
    >
      {Icon && <Icon size={11} style={status.kind === 'saving' ? { animation: 'spin 1s linear infinite' } : undefined} />}
      <span>{label}</span>
    </div>
  )
}

function humaniseAgo(ms: number): string {
  if (ms < 2_000)    return 'just now'
  if (ms < 60_000)   return `${Math.floor(ms / 1_000)}s ago`
  if (ms < 3_600_000)return `${Math.floor(ms / 60_000)}m ago`
  return `${Math.floor(ms / 3_600_000)}h ago`
}
