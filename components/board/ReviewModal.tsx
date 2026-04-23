'use client'

import { useState } from 'react'
import type { KanbanCard } from '@/lib/types'
import { XCircle, CheckCircle2, ExternalLink, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import FeedbackBox from './FeedbackBox'
import DiffViewer from './DiffViewer'

interface Props {
  card: KanbanCard
  onClose: () => void
  onApprove: (card: KanbanCard, onResult: (ok: boolean) => void) => void
  onReject:  (card: KanbanCard, revision: string) => void
  /** Optional — when the card was produced by a Run, the diff viewer updates run_events. */
  runId?: string
}

/**
 * Detects GitHub branch / PR URLs so we can swap the iframe preview for the
 * diff viewer. Matches:
 *   - https://github.com/<o>/<r>/tree/<branch>
 *   - https://github.com/<o>/<r>/pull/<n>
 *   - git+https://github.com/<o>/<r>#<branch>
 */
function isGithubBranchUrl(url?: string): boolean {
  if (!url) return false
  try {
    const clean = url.startsWith('git+') ? url.slice(4) : url
    const u = new URL(clean)
    if (!u.hostname.endsWith('github.com')) return false
    if (/\/(tree|pull)\//.test(u.pathname)) return true
    if (u.hash && u.pathname.split('/').filter(Boolean).length === 2) return true
    return false
  } catch {
    return false
  }
}

export default function ReviewModal({ card, onClose, onApprove, onReject, runId }: Props) {
  const [showRevision,    setShowRevision]    = useState(false)
  const [revision,        setRevision]        = useState('')
  const [approveState,    setApproveState]    = useState<'idle' | 'dispatching' | 'ok' | 'err'>('idle')
  const [showFeedback,    setShowFeedback]    = useState(false)

  const isDiff = isGithubBranchUrl(card.assetUrl)

  function handleApprove() {
    setApproveState('dispatching')
    onApprove(card, ok => {
      setApproveState(ok ? 'ok' : 'err')
      // Modal will close via parent after onApprove runs; brief state flash only if user stays
    })
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        className="w-full max-w-2xl rounded-2xl overflow-hidden"
        style={{ backgroundColor: '#12121e', border: '1px solid #24243e' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: '1px solid #24243e' }}
        >
          <div>
            <h2 className="font-semibold" style={{ color: '#e8e8f0' }}>{card.title}</h2>
            <p className="text-xs mt-0.5" style={{ color: '#9090b0' }}>
              {card.assignee} · Ready for review
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ color: '#55556a' }}
            onMouseEnter={e => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = '#1a1a2e'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0'
            }}
            onMouseLeave={e => {
              ;(e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent'
              ;(e.currentTarget as HTMLButtonElement).style.color = '#55556a'
            }}
          >
            <XCircle size={16} />
          </button>
        </div>

        {/* Asset preview: diff viewer for GitHub branches, iframe for everything else */}
        {isDiff && card.assetUrl ? (
          <DiffViewer
            url={card.assetUrl}
            runId={runId}
            onApproved={() => {
              // Delegate to the parent so the card moves + any downstream
              // dispatch fires. DiffViewer already performed the git merge.
              onApprove(card, () => {})
              onClose()
            }}
            onRejected={() => {
              // Same shape as the "submit for regeneration" path but without
              // a revision note — the rejection reason lives in run_events.
              onReject(card, 'Diff rejected from Board')
              onClose()
            }}
          />
        ) : (
          <>
            <div
              className="mx-5 mt-5 rounded-xl overflow-hidden"
              style={{ height: 260, backgroundColor: '#0d0d14', border: '1px solid #24243e' }}
            >
              {card.assetUrl ? (
                <iframe
                  src={card.assetUrl}
                  className="w-full h-full"
                  title="Asset preview"
                  sandbox="allow-same-origin allow-scripts"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-sm" style={{ color: '#55556a' }}>No preview available</span>
                </div>
              )}
            </div>
          </>
        )}

        {/* Asset link — hidden in diff mode because the DiffViewer links to each file directly */}
        {!isDiff && card.assetUrl && (
          <div className="px-5 mt-2">
            <a
              href={card.assetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs"
              style={{ color: '#6c63ff' }}
            >
              <ExternalLink size={12} />
              Open in new tab
            </a>
          </div>
        )}

        {/* Description */}
        {!isDiff && (
          <p className="px-5 mt-3 text-sm" style={{ color: '#9090b0' }}>{card.description}</p>
        )}

        {/* Dispatch status — suppressed in diff mode (the diff viewer has its own feedback) */}
        {!isDiff && approveState === 'dispatching' && (
          <div className="mx-5 mt-3 flex items-center gap-2 text-xs" style={{ color: '#6c63ff' }}>
            <Loader2 size={12} className="animate-spin" />
            Dispatching next task to OpenClaw…
          </div>
        )}
        {!isDiff && approveState === 'ok' && (
          <div className="mx-5 mt-3 flex items-center gap-2 text-xs" style={{ color: '#22c55e' }}>
            <CheckCircle2 size={12} />
            Approved &amp; next task dispatched to OpenClaw
          </div>
        )}
        {!isDiff && approveState === 'err' && (
          <div className="mx-5 mt-3 text-xs" style={{ color: '#f59e0b' }}>
            Approved locally. OpenClaw dispatch failed — check connection at /tools/claw
          </div>
        )}

        {/* Revision input */}
        {!isDiff && showRevision && (
          <div className="px-5 mt-4">
            <textarea
              value={revision}
              onChange={e => setRevision(e.target.value)}
              placeholder="Describe what direction the regeneration should take..."
              rows={3}
              className="w-full rounded-xl px-3 py-2.5 text-sm resize-none outline-none"
              style={{ backgroundColor: '#0d0d14', border: '1px solid #24243e', color: '#e8e8f0' }}
              onFocus={e => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = '#6c63ff')}
              onBlur={e  => ((e.currentTarget as HTMLTextAreaElement).style.borderColor = '#24243e')}
              autoFocus
            />
          </div>
        )}

        {/* Actions — hidden in diff mode; DiffViewer owns the approve/reject buttons */}
        {!isDiff && (
        <div className="flex items-center justify-end gap-3 px-5 py-4">
          {showRevision ? (
            <>
              <button
                onClick={() => setShowRevision(false)}
                className="px-4 py-2 rounded-lg text-sm"
                style={{ color: '#9090b0' }}
              >
                Cancel
              </button>
              <button
                onClick={() => onReject(card, revision)}
                disabled={!revision.trim()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                style={
                  revision.trim()
                    ? { backgroundColor: '#ef4444', color: '#fff', cursor: 'pointer' }
                    : { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
                }
              >
                <XCircle size={14} />
                Submit for Regeneration
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setShowRevision(true)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                style={{ backgroundColor: '#1a1a2e', color: '#ef4444', border: '1px solid #24243e' }}
                onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#ef4444')}
                onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.borderColor = '#24243e')}
              >
                <XCircle size={14} />
                Reject
              </button>
              <button
                onClick={handleApprove}
                disabled={approveState === 'dispatching'}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
                style={
                  approveState === 'dispatching'
                    ? { backgroundColor: '#1a1a2e', color: '#55556a', cursor: 'not-allowed' }
                    : { backgroundColor: '#22c55e', color: '#fff', cursor: 'pointer' }
                }
              >
                {approveState === 'dispatching'
                  ? <Loader2 size={14} className="animate-spin" />
                  : <CheckCircle2 size={14} />
                }
                {approveState === 'dispatching' ? 'Approving…' : 'Approve'}
              </button>
            </>
          )}
        </div>
        )}

        {/* Feedback disclosure — routes to the workflow-optimizer agent */}
        <div style={{ borderTop: '1px solid #24243e' }}>
          <button
            onClick={() => setShowFeedback(v => !v)}
            className="flex w-full items-center justify-between px-5 py-3 text-xs font-semibold"
            style={{ color: '#9090b0' }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.color = '#e8e8f0')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.color = '#9090b0')}
          >
            <span>Not what you expected? Tell the optimizer.</span>
            {showFeedback ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          {showFeedback && (
            <FeedbackBox
              cardId={card.id}
              agentSlug={card.assignee}
              artifactUrl={card.assetUrl}
            />
          )}
        </div>
      </div>
    </div>
  )
}
