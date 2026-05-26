'use client'

/**
 * ReportIssueForm — operator-facing form mounted on /issues. Files a new
 * issue against a chosen business and (by default) immediately dispatches
 * the engineering-lead agent to triage + route.
 *
 * Why this exists: the 2026-05-26 walkthrough surfaced that the operator
 * had no UI to report a bug or feature request. They had to type it in chat
 * and hope an agent picked it up — slow, ambiguous, no audit trail. This
 * form gives a structured intake with explicit business scoping.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, AlertCircle, Send, Check } from 'lucide-react'

interface Business { slug: string; name: string }
interface Props { businesses: Business[] }

interface SubmitResp {
  ok:          boolean
  id?:         string
  dispatched?: boolean
  error?:      string
  detail?:     string
}

export default function ReportIssueForm({ businesses }: Props) {
  const router = useRouter()
  const [slug, setSlug]         = useState<string>(businesses[0]?.slug ?? '')
  const [title, setTitle]       = useState<string>('')
  const [body, setBody]         = useState<string>('')
  const [dispatch, setDispatch] = useState<boolean>(true)
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [result, setResult]     = useState<SubmitResp | null>(null)

  async function submit(e: React.FormEvent): Promise<void> {
    e.preventDefault()
    if (!slug || !title.trim() || submitting) return
    setSubmitting(true)
    setResult(null)
    try {
      const res = await fetch('/api/issues', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          business_slug: slug,
          title:         title.trim(),
          body:          body.trim() || undefined,
          dispatch,
        }),
      })
      const j = (await res.json().catch(() => ({}))) as SubmitResp
      setResult(j)
      if (j.ok) {
        // Reset on success
        setTitle('')
        setBody('')
        // Server-component refresh so the new row appears below the form.
        router.refresh()
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : 'fetch_failed' })
    } finally {
      setSubmitting(false)
    }
  }

  if (businesses.length === 0) {
    return (
      <div className="mb-6 rounded-xl border border-amber-700/30 bg-amber-500/5 p-4 text-sm text-amber-200">
        Create a business first (
        <a href="/businesses/new" className="underline">/businesses/new</a>
        ) before reporting issues — issues are always scoped to a business.
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="mb-3 flex items-center gap-2">
        <Send className="h-4 w-4 text-zinc-400" />
        <h3 className="text-sm font-medium uppercase tracking-wide text-zinc-300">Report an issue</h3>
        <span className="text-xs text-zinc-500">— agents pick this up and triage automatically</span>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr,minmax(240px,2fr)]">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Business
          <select
            value={slug}
            onChange={e => setSlug(e.target.value)}
            disabled={submitting}
            className="rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          >
            {businesses.map(b => (
              <option key={b.slug} value={b.slug}>{b.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Title <span className="text-zinc-600">(short, action-oriented)</span>
          <input
            type="text"
            value={title}
            onChange={e => setTitle(e.target.value)}
            disabled={submitting}
            maxLength={200}
            required
            placeholder="e.g. /dashboard tile says $0 even when there are recent spend rows"
            className="rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
          />
        </label>
      </div>

      <label className="mt-3 flex flex-col gap-1 text-xs text-zinc-400">
        Details <span className="text-zinc-600">(optional — paste logs, screenshots, repro steps)</span>
        <textarea
          value={body}
          onChange={e => setBody(e.target.value)}
          disabled={submitting}
          maxLength={5000}
          rows={4}
          placeholder="What happens, what should happen, anything you've already ruled out…"
          className="resize-y rounded-md border border-zinc-700 bg-zinc-950/40 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none disabled:opacity-50"
        />
      </label>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        <label className="flex cursor-pointer items-center gap-2 text-zinc-400">
          <input
            type="checkbox"
            checked={dispatch}
            onChange={e => setDispatch(e.target.checked)}
            disabled={submitting}
            className="rounded border-zinc-600 bg-zinc-900 text-emerald-500 focus:ring-emerald-600/40"
          />
          Dispatch engineering-lead immediately
          <span className="text-zinc-600">— uncheck to file silently for later triage</span>
        </label>

        <div className="flex items-center gap-3">
          {result && !result.ok && (
            <span className="inline-flex items-center gap-1 text-rose-400" role="alert">
              <AlertCircle className="h-3 w-3" />
              {result.error}{result.detail ? `: ${result.detail}` : ''}
            </span>
          )}
          {result && result.ok && (
            <span className="inline-flex items-center gap-1 text-emerald-400">
              <Check className="h-3 w-3" />
              Filed{result.dispatched ? ' + agent dispatched' : ''}
            </span>
          )}
          <button
            type="submit"
            disabled={!title.trim() || !slug || submitting}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-600/30 bg-emerald-600/15 px-3 py-2 text-sm font-medium text-emerald-300 transition hover:bg-emerald-600/25 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            Report issue
          </button>
        </div>
      </div>
    </form>
  )
}
