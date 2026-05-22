'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Send, Loader2 } from 'lucide-react'

interface Props {
  issueId: string
}

/**
 * CommentForm — operator-side comment authoring under an issue.
 *
 * Posts to /api/issues/[id]/comment then router.refresh()es the parent so
 * the new comment appears in the IssueThread without a hard reload.
 *
 * Mounted by IssueThread.tsx beneath the comments list.
 */
export default function CommentForm({ issueId }: Props) {
  const [text, setText]       = useState('')
  const [error, setError]     = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [submitting, setSubmitting] = useState(false)
  const router = useRouter()

  const disabled = submitting || pending || text.trim().length === 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (disabled) return
    setError(null)
    setSubmitting(true)
    try {
      const res = await fetch(`/api/issues/${issueId}/comment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: text.trim() }),
      })
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      if (!j.ok) {
        setError(j.error ?? `HTTP ${res.status}`)
        return
      }
      setText('')
      startTransition(() => router.refresh())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unknown_error')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Add a comment…"
        rows={3}
        maxLength={20_000}
        className="w-full resize-none rounded-md border border-zinc-800 bg-zinc-950/60 p-2 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-700"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="min-h-[1rem] text-xs text-rose-400">{error}</p>
        <button
          type="submit"
          disabled={disabled}
          className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-800/40 px-3 py-1.5 text-xs text-zinc-200 transition hover:border-zinc-600 hover:bg-zinc-800/60 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {(submitting || pending) ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          Comment
        </button>
      </div>
    </form>
  )
}
