'use client'

/**
 * PermissionPromptCard — Claude-Code-Desktop-style Allow / Deny button
 * for CLI-level tool-permission requests caught by the
 * mcp-permission-broker (PR #189).
 *
 * Rendered inline above the running assistant bubble when the chat
 * poll surfaces pending requests. The card POSTs the operator's
 * decision to `/api/platform-chat/permission-requests/:id` which flips
 * the row's status; the broker MCP — currently polling that same row
 * inside the gateway — sees the change and returns the decision back
 * to the CLI, unblocking the turn.
 *
 * Smart per-tool rendering:
 *   - Bash:        shows the command in a code block + lets operator
 *                  edit it before allowing (via the "Allow with edit"
 *                  affordance — V2 feature; V1 shows edit-as-textarea)
 *   - Edit/Write:  shows file_path + a truncated preview of new content
 *   - MCP tools:   shows tool name + JSON-formatted args
 *   - Anything:    falls back to generic pretty-JSON
 */

import { useEffect, useState } from 'react'
import { Check, X, Shield, Terminal as TerminalIcon, FileEdit, Box, CheckCircle2, XCircle } from 'lucide-react'

export interface PermissionRequest {
  id:          string
  user_id:     string
  job_id:      string
  tool_name:   string
  tool_input:  Record<string, unknown>
  tool_use_id: string | null
  status:      'pending' | 'allowed' | 'denied' | 'expired'
  decision:    { reason?: string; updated_input?: Record<string, unknown> } | null
  created_at:  string
  resolved_at: string | null
}

interface Props {
  request:  PermissionRequest
  /** Called on Allow click. Optional updatedInput overrides original args. */
  onAllow?:  (id: string, updatedInput?: Record<string, unknown>) => void
  /** Called on Deny click. Optional reason captured from the operator. */
  onDeny?:   (id: string, reason?: string) => void
  disabled?: boolean
}

export default function PermissionPromptCard({ request, onAllow, onDeny, disabled }: Props) {
  const [showEdit, setShowEdit] = useState(false)
  const [editText, setEditText] = useState('')
  const [denyReason, setDenyReason] = useState('')
  const [editError, setEditError] = useState<string | null>(null)

  // Initialise edit textarea when the operator opens it.
  useEffect(() => {
    if (showEdit && !editText) setEditText(JSON.stringify(request.tool_input, null, 2))
  }, [showEdit, editText, request.tool_input])

  const resolved = request.status !== 'pending'
  const allowed  = request.status === 'allowed'
  const denied   = request.status === 'denied' || request.status === 'expired'

  function handleAllow() {
    if (!showEdit) { onAllow?.(request.id); return }
    let parsed: Record<string, unknown>
    try { parsed = JSON.parse(editText) } catch {
      setEditError('JSON parse failed — fix the syntax or cancel the edit.')
      return
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      setEditError('Edited input must be a JSON object.')
      return
    }
    setEditError(null)
    onAllow?.(request.id, parsed)
  }

  function handleDeny() {
    onDeny?.(request.id, denyReason.trim() || undefined)
  }

  // Tool-specific summary heading. Falls back to the raw tool name.
  let icon = <Shield size={16} style={{ color: '#fbbf24', marginTop: 1 }} />
  let summary = request.tool_name
  let preview: React.ReactNode = null
  if (request.tool_name === 'Bash') {
    icon = <TerminalIcon size={16} style={{ color: '#fbbf24', marginTop: 1 }} />
    const cmd = (request.tool_input.command as string | undefined) ?? ''
    summary = 'Run shell command'
    preview = <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto" style={{ color: '#e8e8f0' }}>{cmd || '(no command)'}</pre>
  } else if (request.tool_name === 'Edit' || request.tool_name === 'Write' || request.tool_name === 'NotebookEdit') {
    icon = <FileEdit size={16} style={{ color: '#fbbf24', marginTop: 1 }} />
    const path = (request.tool_input.file_path as string | undefined) ?? '(unknown path)'
    summary = `${request.tool_name === 'Write' ? 'Write' : 'Edit'} file`
    const snippet =
      request.tool_name === 'Edit'
        ? `- ${trim((request.tool_input.old_string as string | undefined) ?? '', 120)}\n+ ${trim((request.tool_input.new_string as string | undefined) ?? '', 120)}`
        : trim((request.tool_input.content as string | undefined) ?? '', 240)
    preview = (
      <>
        <div className="font-mono text-[10px] mb-1 opacity-70">{path}</div>
        <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto" style={{ color: '#e8e8f0' }}>{snippet}</pre>
      </>
    )
  } else if (request.tool_name.startsWith('mcp__')) {
    icon = <Box size={16} style={{ color: '#fbbf24', marginTop: 1 }} />
    summary = request.tool_name.replace(/^mcp__/, '').replace(/__/, ' · ')
    preview = <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto" style={{ color: '#e8e8f0' }}>{JSON.stringify(request.tool_input, null, 2)}</pre>
  } else {
    preview = <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto" style={{ color: '#e8e8f0' }}>{JSON.stringify(request.tool_input, null, 2)}</pre>
  }

  return (
    <div
      className="rounded-xl mt-2 mb-2"
      style={{
        background:           'linear-gradient(135deg, rgba(245,158,11,0.12), rgba(255,255,255,0.02))',
        border:               '1px solid rgba(245,158,11,0.35)',
        backdropFilter:       'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow:            '0 1px 0 0 rgba(255,255,255,0.06) inset',
      }}
    >
      {/* Header */}
      <div className="px-4 py-2.5 flex items-start gap-2" style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        {resolved
          ? (allowed ? <CheckCircle2 size={16} style={{ color: '#22c55e', marginTop: 1 }} /> : <XCircle size={16} style={{ color: '#ef4444', marginTop: 1 }} />)
          : icon}
        <div className="flex-1 min-w-0">
          <div className="text-xs uppercase tracking-[0.14em] mb-0.5" style={{ color: allowed ? '#22c55e' : denied ? '#ef4444' : '#fbbf24' }}>
            {resolved
              ? (allowed ? 'Allowed' : request.status === 'expired' ? 'Expired (no response)' : 'Denied')
              : 'Permission required'}
          </div>
          <div className="text-sm font-medium" style={{ color: '#e8e8f0' }}>{summary}</div>
        </div>
        <div className="text-[10px] font-mono opacity-60 shrink-0" style={{ color: '#9090b0' }}>
          {request.id.slice(0, 8)}
        </div>
      </div>

      {/* Preview body */}
      <div className="px-4 py-3" style={{ background: 'rgba(0,0,0,0.20)' }}>
        {preview}
      </div>

      {/* Edit panel — toggled via the "Allow with edits" link below */}
      {!resolved && showEdit && (
        <div className="px-4 py-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <div className="text-[10px] uppercase tracking-wider mb-1.5" style={{ color: '#fbbf24' }}>Edit tool input (JSON)</div>
          <textarea
            value={editText}
            onChange={e => { setEditText(e.target.value); setEditError(null) }}
            disabled={disabled}
            className="w-full font-mono text-[11px] rounded px-2 py-1.5"
            style={{ background: 'rgba(0,0,0,0.40)', color: '#e8e8f0', border: '1px solid rgba(255,255,255,0.08)', minHeight: 120, resize: 'vertical' }}
          />
          {editError && (
            <div className="mt-1 text-[11px]" style={{ color: '#fca5a5' }}>{editError}</div>
          )}
        </div>
      )}

      {/* Deny reason — captured optionally before clicking Deny */}
      {!resolved && (
        <div className="px-4 py-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <input
            value={denyReason}
            onChange={e => setDenyReason(e.target.value)}
            disabled={disabled}
            placeholder="(optional) deny reason the agent will see…"
            className="w-full text-[11px] px-2 py-1 rounded"
            style={{ background: 'rgba(255,255,255,0.04)', color: '#e8e8f0', border: '1px solid rgba(255,255,255,0.08)' }}
          />
        </div>
      )}

      {/* Action bar */}
      {!resolved && (
        <div
          className="px-4 py-2.5 flex items-center justify-between gap-2"
          style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
        >
          <button
            onClick={handleDeny}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40"
            style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
          >
            <X size={12} /> Deny
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEdit(s => !s)}
              disabled={disabled}
              className="text-[11px] underline opacity-80 hover:opacity-100"
              style={{ color: '#fbbf24' }}
            >
              {showEdit ? 'Cancel edit' : 'Edit input first'}
            </button>
            <button
              onClick={handleAllow}
              disabled={disabled}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.30), rgba(34,197,94,0.10))', border: '1px solid rgba(34,197,94,0.30)', color: '#e8e8f0' }}
            >
              <Check size={12} /> {showEdit ? 'Allow with edits' : 'Allow'}
            </button>
          </div>
        </div>
      )}

      {resolved && request.decision?.reason && (
        <div className="px-4 py-2 text-[11px] opacity-80" style={{ color: '#9090b0' }}>
          <span className="font-mono uppercase tracking-wider text-[9px] opacity-70">reason · </span>
          {request.decision.reason}
        </div>
      )}
    </div>
  )
}

function trim(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}
