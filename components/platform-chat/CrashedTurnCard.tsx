'use client'

/**
 * CrashedTurnCard — rendered above the assistant bubble when the turn
 * ended in a non-zero CLI exit. Surfaces:
 *
 *   - A clear "this turn crashed mid-stream — any tool calls the agent
 *     *described* but did not dispatch were dropped" warning so the
 *     operator doesn't trust prose like "writes are queued" / "I'll
 *     create the PR"
 *   - The exit code + (when available) the last ~200 chars of stderr
 *   - A nudge to reply with "continue" or specific instructions
 *
 * Designed to be expandable — click the row to reveal stderr detail.
 * Keeps the assistant bubble below it readable; the card is the LITTLE
 * warning above, not a replacement.
 */

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, Terminal as TerminalIcon } from 'lucide-react'

export interface CrashedInfo {
  exit_code?:   number | null
  stderr_tail?: string | null
  raw?:         string | null
}

interface Props {
  crashed: CrashedInfo
}

export default function CrashedTurnCard({ crashed }: Props) {
  const [open, setOpen] = useState(false)
  const exitCode = crashed.exit_code ?? null
  const tail     = crashed.stderr_tail ?? null
  const raw      = crashed.raw ?? null
  const hasDetail = !!tail || !!raw

  return (
    <div
      className="rounded-lg overflow-hidden mb-2 text-xs"
      style={{
        background:           'rgba(239,68,68,0.08)',
        border:               '1px solid rgba(239,68,68,0.35)',
        backdropFilter:       'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      <button
        onClick={() => hasDetail && setOpen(o => !o)}
        className="w-full flex items-start gap-2 px-3 py-2 text-left"
        style={{ color: '#fca5a5', cursor: hasDetail ? 'pointer' : 'default' }}
      >
        <AlertTriangle size={13} className="mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-semibold">
            This turn crashed before completing
            {exitCode !== null ? <span className="font-mono font-normal opacity-80"> · exit code {exitCode}</span> : null}
          </div>
          <div className="mt-1" style={{ color: '#f8c2c2' }}>
            Any tool calls the agent <i>described</i> but did not dispatch were dropped. Treat phrases like &ldquo;writes are queued&rdquo; or &ldquo;I&rsquo;ll now&hellip;&rdquo; as <b>unverified</b>. Reply with <span className="font-mono">continue</span> or specific instructions so the agent can re-issue them.
          </div>
        </div>
        {hasDetail && (open ? <ChevronDown size={11} className="mt-1 shrink-0" /> : <ChevronRight size={11} className="mt-1 shrink-0" />)}
      </button>
      {open && hasDetail && (
        <div className="px-3 pb-2.5 pt-1 space-y-2" style={{ borderTop: '1px solid rgba(239,68,68,0.25)' }}>
          {tail && (
            <div>
              <div className="font-mono uppercase tracking-wider text-[10px] mb-1 flex items-center gap-1" style={{ color: '#fca5a5' }}>
                <TerminalIcon size={9} /> stderr tail
              </div>
              <pre className="overflow-x-auto rounded px-2 py-1.5 text-[11px]" style={{ background: 'rgba(0,0,0,0.40)', color: '#f8c2c2' }}>{tail}</pre>
            </div>
          )}
          {!tail && raw && (
            <div>
              <div className="font-mono uppercase tracking-wider text-[10px] mb-1" style={{ color: '#fca5a5' }}>error</div>
              <pre className="overflow-x-auto rounded px-2 py-1.5 text-[11px]" style={{ background: 'rgba(0,0,0,0.40)', color: '#f8c2c2' }}>{raw}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
