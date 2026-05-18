'use client'

/**
 * McpStatusStrip — compact "MCPs powering this chat" strip for the
 * /manage-platform and /businesses/<slug>/chat headers.
 *
 * Audit 2026-05-16 Section 6 #6: the operator should see what's powering
 * the chat BEFORE typing. V1 shows the manifested set + an expand-to-detail
 * row revealing each MCP's summary + envVars. V2 (deferred) wires live
 * list_tools counts — needs a gateway-side endpoint that doesn't exist yet.
 *
 * Reads /api/chat/mcp-status?scope=... — one fetch on mount, no polling
 * (the manifest is static, only changes on deploy).
 */

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Plug, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

interface McpSummaryEntry {
  id:          string
  name:        string
  summary:     string
  status:      'verified' | 'placeholder' | 'admin-builtin'
  envVars:     readonly string[]
  /** V2 fields — present when ?live=1 succeeded. */
  toolCount?:  number | null
  liveStatus?: 'ready' | 'timeout' | 'spawn_error' | 'protocol_error' | 'not-in-config'
  toolNames?:  string[]
  liveError?:  string
}

interface McpSummary {
  scope:     'platform' | { business: string }
  profile:   string
  entries:   McpSummaryEntry[]
  note:      string
  /** V2: 'live' when the gateway probe enriched this; 'manifest' otherwise. */
  source:    'live' | 'manifest'
  liveError?: string
}

interface ApiOk  { ok: true;  summary: McpSummary }
interface ApiErr { ok: false; error: string }

export default function McpStatusStrip({ scope }: {
  /** 'platform' for /manage-platform, 'business:<slug>' for per-business chats. */
  scope: string
}) {
  const [summary, setSummary]   = useState<McpSummary | null>(null)
  const [error, setError]       = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        // Two-step load: first render the manifest fast, then enrich with
        // live counts when the gateway probe returns. V1 callers / gateway-
        // unreachable paths still get a usable strip on the first response.
        const manifestRes = await fetch(`/api/chat/mcp-status?scope=${encodeURIComponent(scope)}`, {
          cache:  'no-store',
          signal: AbortSignal.timeout(10_000),
        })
        if (manifestRes.ok) {
          const j = (await manifestRes.json()) as ApiOk | ApiErr
          if (!cancelled && j.ok) setSummary(j.summary)
        }

        // Live probe — graceful degrade if it errors or takes too long.
        // 10s budget client-side (gateway has its own 5s timeout +
        // 5-min cache, so a cold first hit is the worst case).
        const liveRes = await fetch(`/api/chat/mcp-status?scope=${encodeURIComponent(scope)}&live=1`, {
          cache:  'no-store',
          signal: AbortSignal.timeout(15_000),
        })
        if (!liveRes.ok) return   // keep the manifest-only summary already set
        const j = (await liveRes.json()) as ApiOk | ApiErr
        if (cancelled || !j.ok) return
        setSummary(j.summary)
      } catch (e) {
        if (cancelled) return
        setError(e instanceof Error ? e.message : 'failed to load MCP status')
      }
    })()
    return () => { cancelled = true }
  }, [scope])

  // Render nothing on error — the chat surface has many other panels and
  // a non-critical strip shouldn't blank them with a stack trace.
  if (error) return null

  if (!summary) {
    return (
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 text-[10px]"
        style={{
          background:           'linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
          backdropFilter:       'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border:               '1px solid rgba(255,255,255,0.06)',
          borderRadius:         '10px',
          color:                '#9090b0',
        }}
        aria-busy="true"
      >
        <Loader2 size={11} className="animate-spin" />
        <span>Resolving MCPs…</span>
      </div>
    )
  }

  return (
    <div
      className="text-[10px]"
      style={{
        background:           'linear-gradient(135deg, rgba(108,99,255,0.05), rgba(255,255,255,0.02))',
        backdropFilter:       'blur(20px) saturate(180%)',
        WebkitBackdropFilter: 'blur(20px) saturate(180%)',
        border:               '1px solid rgba(255,255,255,0.08)',
        borderRadius:         '10px',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.04) inset',
      }}
    >
      {/* Strip header — chip row + expand toggle */}
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 transition-colors text-left"
        style={{ color: '#9090b0' }}
        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.02)' }}
        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}
        aria-expanded={expanded}
        aria-label={`${summary.entries.length} MCPs in scope — click to ${expanded ? 'collapse' : 'expand'} details`}
      >
        <Plug size={11} style={{ color: '#a8a3ff' }} />
        <span className="font-mono uppercase tracking-wider">{summary.profile}</span>
        <span style={{ color: '#55556a' }}>·</span>
        <div className="flex-1 flex items-center gap-1.5 min-w-0 overflow-hidden">
          {summary.entries.slice(0, 6).map(e => (
            <McpChip key={e.id} entry={e} />
          ))}
          {summary.entries.length > 6 && (
            <span className="font-mono shrink-0" style={{ color: '#55556a' }}>
              +{summary.entries.length - 6}
            </span>
          )}
        </div>
        {summary.source === 'live' && (
          <span
            className="font-mono shrink-0 px-1 py-0.5 rounded"
            style={{
              color:      '#4ade80',
              background: 'rgba(34,197,94,0.10)',
              border:     '1px solid rgba(34,197,94,0.22)',
              fontSize:   '8px',
            }}
            title="Live tool counts from the gateway probe (cached 5 min)"
          >
            LIVE
          </span>
        )}
        <span className="font-mono shrink-0" style={{ color: '#55556a' }}>
          {summary.entries.length} MCP{summary.entries.length === 1 ? '' : 's'}
        </span>
        {expanded
          ? <ChevronUp   size={11} style={{ color: '#9090b0' }} />
          : <ChevronDown size={11} style={{ color: '#9090b0' }} />}
      </button>

      {/* Expanded detail panel — full row per MCP with summary + env */}
      {expanded && (
        <div
          className="px-2.5 py-2 space-y-1.5"
          style={{
            borderTop: '1px solid rgba(255,255,255,0.06)',
            color:     '#c8c8d8',
          }}
        >
          {summary.entries.map(e => <McpRow key={e.id} entry={e} />)}
          <div
            className="text-[9px] italic mt-1.5 pt-1.5 flex items-start gap-1.5"
            style={{ color: '#55556a', borderTop: '1px solid rgba(255,255,255,0.04)' }}
          >
            <AlertTriangle size={9} className="shrink-0 mt-0.5" />
            <span>{summary.note}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function McpChip({ entry }: { entry: McpSummaryEntry }) {
  // V2: live status overrides manifest status when present.
  // ready=green, timeout/spawn_error/protocol_error=red, not-in-config=amber.
  const dot =
    entry.liveStatus === 'ready'           ? '#4ade80' :
    entry.liveStatus === 'timeout'         ? '#ef4444' :
    entry.liveStatus === 'spawn_error'     ? '#ef4444' :
    entry.liveStatus === 'protocol_error'  ? '#ef4444' :
    entry.liveStatus === 'not-in-config'   ? '#fbbf24' :
    entry.status     === 'verified'        ? '#4ade80' :
    entry.status     === 'admin-builtin'   ? '#a8a3ff' :
    /* placeholder */                        '#fbbf24'
  const titleParts = [entry.summary]
  if (typeof entry.toolCount === 'number') {
    titleParts.push(`${entry.toolCount} tool${entry.toolCount === 1 ? '' : 's'}`)
  } else if (entry.liveStatus && entry.liveStatus !== 'ready') {
    titleParts.push(`probe: ${entry.liveStatus}${entry.liveError ? ` — ${entry.liveError}` : ''}`)
  }
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md font-mono whitespace-nowrap shrink-0"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border:     '1px solid rgba(255,255,255,0.06)',
        color:      '#e8e8f0',
        fontSize:   '9px',
      }}
      title={titleParts.join(' · ')}
    >
      <span
        className="w-1 h-1 rounded-full"
        style={{ background: dot, boxShadow: `0 0 4px ${dot}80` }}
      />
      {entry.name}
      {typeof entry.toolCount === 'number' && entry.liveStatus === 'ready' && (
        <span style={{ color: '#9090b0' }}>·{entry.toolCount}</span>
      )}
    </span>
  )
}

function McpRow({ entry }: { entry: McpSummaryEntry }) {
  // V2: when a live probe is present, surface its status alongside the
  // manifest status. The expanded row gets a "live: ready · 12 tools" line
  // OR "live: timeout — <err>" when the gateway couldn't reach the MCP.
  const StatusIcon =
    entry.liveStatus === 'ready'          ? CheckCircle2 :
    entry.liveStatus === 'timeout'        ? AlertTriangle :
    entry.liveStatus === 'spawn_error'    ? AlertTriangle :
    entry.liveStatus === 'protocol_error' ? AlertTriangle :
    entry.liveStatus === 'not-in-config'  ? AlertTriangle :
    entry.status     === 'verified'       ? CheckCircle2 :
    entry.status     === 'admin-builtin'  ? CheckCircle2 :
    /* placeholder */                       AlertTriangle
  const statusColor =
    entry.liveStatus === 'ready'          ? '#4ade80' :
    entry.liveStatus === 'timeout'        ? '#ef4444' :
    entry.liveStatus === 'spawn_error'    ? '#ef4444' :
    entry.liveStatus === 'protocol_error' ? '#ef4444' :
    entry.liveStatus === 'not-in-config'  ? '#fbbf24' :
    entry.status     === 'verified'       ? '#4ade80' :
    entry.status     === 'admin-builtin'  ? '#a8a3ff' :
    /* placeholder */                       '#fbbf24'
  return (
    <div className="flex items-start gap-2">
      <StatusIcon size={10} style={{ color: statusColor }} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="font-medium" style={{ color: '#e8e8f0' }}>{entry.name}</span>
          <span className="font-mono uppercase tracking-wider" style={{ color: statusColor, fontSize: '8px' }}>
            {entry.status === 'admin-builtin' ? 'admin' : entry.status}
          </span>
        </div>
        <div className="leading-snug" style={{ color: '#9090b0' }}>{entry.summary}</div>
        {entry.envVars.length > 0 && (
          <div className="font-mono mt-0.5" style={{ color: '#55556a' }}>
            {entry.envVars.join(' · ')}
          </div>
        )}
        {/* V2: live probe detail line — only when ?live=1 returned data. */}
        {entry.liveStatus && (
          <div className="font-mono mt-0.5 flex items-center gap-1.5" style={{ color: statusColor }}>
            <span style={{ opacity: 0.7 }}>live:</span>
            <span>{entry.liveStatus}</span>
            {typeof entry.toolCount === 'number' && (
              <>
                <span style={{ color: '#55556a' }}>·</span>
                <span>{entry.toolCount} tool{entry.toolCount === 1 ? '' : 's'}</span>
              </>
            )}
            {entry.liveError && (
              <>
                <span style={{ color: '#55556a' }}>·</span>
                <span style={{ color: '#fbbf24' }}>{entry.liveError}</span>
              </>
            )}
          </div>
        )}
        {/* V2: tool names — first 6, with a "+N" overflow hint */}
        {entry.toolNames && entry.toolNames.length > 0 && (
          <div className="font-mono mt-0.5" style={{ color: '#9090b0', fontSize: '9px' }}>
            {entry.toolNames.slice(0, 6).join(' · ')}
            {entry.toolNames.length > 6 && (
              <span style={{ color: '#55556a' }}> · +{entry.toolNames.length - 6} more</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
