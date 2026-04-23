'use client'

import { useEffect, useState } from 'react'
import { FileDiff, CheckCircle2, XCircle, Loader2, AlertCircle, GitCommit, ExternalLink } from 'lucide-react'

interface DiffFile {
  filename:  string
  status:    string
  additions: number
  deletions: number
  changes:   number
  patch?:    string
}

interface FetchedDiff {
  ref: {
    owner:     string
    repo:      string
    ref:       string
    kind:      'branch' | 'pull'
    prNumber?: number
  }
  diff: {
    base:    string
    head:    string
    headSha: string
    aheadBy: number
    behindBy: number
    files:   DiffFile[]
    commits: Array<{ sha: string; message: string; authorDate: string }>
  }
  status: {
    state:    'success' | 'pending' | 'failure' | 'error' | 'unknown'
    contexts: Array<{ context: string; state: string; description?: string; targetUrl?: string }>
  }
}

interface Props {
  url:        string
  runId?:     string
  onApproved: () => void
  onRejected: () => void
}

const STATE_COLOUR: Record<string, string> = {
  success: '#22c55e',
  pending: '#f59e0b',
  failure: '#ef4444',
  error:   '#ef4444',
  unknown: '#55556a',
}

function statLine(f: DiffFile): string {
  const plus  = '+'.repeat(Math.min(f.additions, 30))
  const minus = '-'.repeat(Math.min(f.deletions, 30))
  return `${plus}${minus}`
}

export default function DiffViewer({ url, runId, onApproved, onRejected }: Props) {
  const [data,       setData]       = useState<FetchedDiff | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [err,        setErr]        = useState<string | null>(null)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<'approve' | 'reject' | null>(null)
  const [actionErr,  setActionErr]  = useState<string | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    ;(async () => {
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch(`/api/build/diff?url=${encodeURIComponent(url)}`, { signal: ac.signal })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error ?? `Request failed (${res.status})`)
        }
        setData(await res.json() as FetchedDiff)
      } catch (e) {
        if ((e as Error).name !== 'AbortError') {
          setErr((e as Error).message ?? 'Failed to load diff')
        }
      } finally {
        setLoading(false)
      }
    })()
    return () => ac.abort()
  }, [url])

  async function act(action: 'approve' | 'reject') {
    setActionBusy(action)
    setActionErr(null)
    try {
      const res = await fetch('/api/build/diff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, action, runId }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `Action failed (${res.status})`)
      }
      if (action === 'approve') onApproved()
      else onRejected()
    } catch (e) {
      setActionErr((e as Error).message ?? 'Action failed')
    } finally {
      setActionBusy(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs p-5" style={{ color: '#9090b0' }}>
        <Loader2 size={12} className="animate-spin" /> Loading diff…
      </div>
    )
  }

  if (err) {
    return (
      <div className="flex items-center gap-2 text-xs p-5" style={{ color: '#f59e0b' }}>
        <AlertCircle size={12} /> {err}
      </div>
    )
  }

  if (!data) return null

  const { ref, diff, status } = data
  const stateColour = STATE_COLOUR[status.state]

  return (
    <div className="p-5 space-y-4">
      {/* Ref + CI status header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs">
          <FileDiff size={13} style={{ color: '#6c63ff' }} />
          <span style={{ color: '#9090b0' }}>
            {ref.owner}/{ref.repo}
          </span>
          <span style={{ color: '#e8e8f0', fontWeight: 600 }}>
            {diff.base} ← {diff.head}
          </span>
          <span style={{ color: '#55556a' }}>
            ({diff.aheadBy} ahead · {diff.behindBy} behind · {diff.files.length} files)
          </span>
        </div>
        <div className="flex items-center gap-1 text-xs" title={status.contexts.map(c => `${c.context}: ${c.state}`).join('\n')}>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: stateColour }}
          />
          <span style={{ color: stateColour }}>CI: {status.state}</span>
        </div>
      </div>

      {/* Commits list */}
      {diff.commits.length > 0 && (
        <div className="rounded-lg" style={{ border: '1px solid #24243e' }}>
          {diff.commits.slice(0, 5).map(c => (
            <div
              key={c.sha}
              className="px-3 py-2 flex items-center gap-2 text-xs"
              style={{ borderBottom: '1px solid #24243e', color: '#9090b0' }}
            >
              <GitCommit size={11} />
              <code style={{ color: '#6c63ff' }}>{c.sha.slice(0, 7)}</code>
              <span style={{ color: '#e8e8f0' }}>{c.message.split('\n')[0].slice(0, 80)}</span>
            </div>
          ))}
        </div>
      )}

      {/* File list with expandable patches */}
      <div className="space-y-1">
        {diff.files.map(f => (
          <div key={f.filename} className="rounded-lg" style={{ border: '1px solid #24243e' }}>
            <button
              onClick={() => setExpanded(expanded === f.filename ? null : f.filename)}
              className="w-full flex items-center justify-between px-3 py-2 text-xs"
              style={{ color: '#e8e8f0' }}
            >
              <span className="flex items-center gap-2">
                <FileDiff size={11} style={{ color: '#6c63ff' }} />
                <span>{f.filename}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: '#1a1a2e', color: '#9090b0' }}>
                  {f.status}
                </span>
              </span>
              <span className="flex items-center gap-2">
                <span style={{ color: '#22c55e' }}>+{f.additions}</span>
                <span style={{ color: '#ef4444' }}>-{f.deletions}</span>
                <code className="text-[10px]" style={{ color: '#55556a' }}>{statLine(f)}</code>
              </span>
            </button>
            {expanded === f.filename && f.patch && (
              <pre
                className="px-3 py-2 text-[11px] overflow-x-auto"
                style={{ borderTop: '1px solid #24243e', backgroundColor: '#0d0d14', color: '#e8e8f0' }}
              >
                {f.patch.split('\n').map((ln, i) => {
                  const col = ln.startsWith('+') && !ln.startsWith('+++') ? '#22c55e'
                            : ln.startsWith('-') && !ln.startsWith('---') ? '#ef4444'
                            : ln.startsWith('@@') ? '#6c63ff'
                            : '#9090b0'
                  return <div key={i} style={{ color: col, whiteSpace: 'pre' }}>{ln}</div>
                })}
              </pre>
            )}
            {expanded === f.filename && !f.patch && (
              <div className="px-3 py-2 text-[11px]" style={{ borderTop: '1px solid #24243e', color: '#55556a' }}>
                Binary file or patch unavailable.
                <a
                  href={`https://github.com/${ref.owner}/${ref.repo}/blob/${ref.ref}/${f.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2"
                  style={{ color: '#6c63ff' }}
                >
                  View on GitHub <ExternalLink size={10} className="inline" />
                </a>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Action errors */}
      {actionErr && (
        <div className="flex items-center gap-2 text-xs" style={{ color: '#f59e0b' }}>
          <AlertCircle size={12} /> {actionErr}
        </div>
      )}

      {/* Merge / close actions */}
      <div className="flex items-center justify-end gap-3 pt-2" style={{ borderTop: '1px solid #24243e' }}>
        <button
          onClick={() => act('reject')}
          disabled={Boolean(actionBusy)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{ backgroundColor: '#1a1a2e', color: '#ef4444', border: '1px solid #24243e', cursor: actionBusy ? 'not-allowed' : 'pointer' }}
        >
          {actionBusy === 'reject' ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
          {ref.kind === 'pull' ? 'Close (manual on GitHub)' : 'Reject & delete branch'}
        </button>
        <button
          onClick={() => act('approve')}
          disabled={Boolean(actionBusy) || status.state === 'failure'}
          title={status.state === 'failure' ? 'CI failure — resolve before merging' : 'Squash-merge into the default branch'}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
          style={{
            backgroundColor: status.state === 'failure' ? '#1a1a2e' : '#22c55e',
            color: status.state === 'failure' ? '#55556a' : '#fff',
            cursor: (actionBusy || status.state === 'failure') ? 'not-allowed' : 'pointer',
          }}
        >
          {actionBusy === 'approve' ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          Approve &amp; merge
        </button>
      </div>
    </div>
  )
}
