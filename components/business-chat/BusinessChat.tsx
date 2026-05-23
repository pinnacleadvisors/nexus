'use client'

/**
 * BusinessChat — /businesses/[slug]/chat body.
 *
 * Phase 5b — full parity with PlatformChat. Per-business mirror of the
 * platform copilot:
 *   - Multi-session sidebar (scope='business:<slug>')
 *   - Approval cards (Phase 3 inheritance)
 *   - Streaming partial text bubble (Phase 2a inheritance)
 *   - Tool-call cards (Phase 2b inheritance)
 *   - Persistence + delete via per-business sessions API
 *
 * Differences from PlatformChat:
 *   - Hits /api/businesses/<slug>/chat and /api/businesses/<slug>/chat/sessions/*
 *   - Header shows the business name + scope hint
 *   - Empty-state copy mentions this business's connections
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, AlertTriangle, X as XIcon, Briefcase, Terminal as TerminalIcon, Copy, Check } from 'lucide-react'
import ApprovalCard from '@/components/platform-chat/ApprovalCard'
import SessionSidebar, { type SessionSummary } from '@/components/platform-chat/SessionSidebar'
import ToolCallCard from '@/components/platform-chat/ToolCallCard'
import CrashedTurnCard, { type CrashedInfo } from '@/components/platform-chat/CrashedTurnCard'
import ContextIndicator, { type ContextUsageView } from '@/components/platform-chat/ContextIndicator'
import ChatProviderToggle, { readChatProvider } from '@/components/chat/ChatProviderToggle'
import { TurnTimeoutSelector, useTurnTimeoutMs } from '@/components/platform-chat/TurnTimeoutSelector'
import EditPlanCard, { type EditPlanResolution } from '@/components/platform-chat/EditPlanCard'
import PermissionPromptCard, { type PermissionRequest } from '@/components/platform-chat/PermissionPromptCard'
import FloatingActionBar from '@/components/platform-chat/FloatingActionBar'
import McpStatusStrip from '@/components/chat/McpStatusStrip'
import { pickPendingAction } from '@/lib/chat/action-bar'
import { findClaimedRanges } from '@/lib/chat/crash'
import { buildEditPlanReply, type EditPlan, type EditGroupComplete } from '@/lib/chat/edit-plan'
import { isApprovalReply } from '@/lib/chat/approval'
import ViewsDropdown, { type ViewName } from '@/components/chat-views/ViewsDropdown'
import ViewsPanel from '@/components/chat-views/ViewsPanel'
import TasksView from '@/components/chat-views/TasksView'
import ApprovalsView from '@/components/chat-views/ApprovalsView'
import CalendarView from '@/components/chat-views/CalendarView'
import HealthView from '@/components/chat-views/HealthView'
import { buildApprovalReply, type ApprovalRequest } from '@/lib/chat/approval'
import type { ToolCall } from '@/lib/claw/gateway-jobs'

interface Message {
  role:                  'user' | 'assistant'
  content:               string
  durationMs?:           number
  approval_requests?:    ApprovalRequest[]
  approval_resolutions?: Record<string, { approvedItemIds: string[]; deniedItemIds: string[] }>
  tool_calls?:           ToolCall[]
  crashed?:              CrashedInfo
  edit_plans?:           EditPlan[]
  edit_group_completes?: EditGroupComplete[]
}

/**
 * Walk messages chronologically and build a per-plan_id resolution
 * snapshot. Mirror of PlatformChat.computeEditPlanResolutions — kept
 * locally because the Message type is per-component (slug-aware).
 */
function computeEditPlanResolutions(messages: Message[]): Map<string, EditPlanResolution> {
  const out         = new Map<string, EditPlanResolution>()
  const knownPlans  = new Set<string>()
  for (const m of messages) for (const p of m.edit_plans ?? []) knownPlans.add(p.plan_id)
  for (const m of messages) {
    if (m.role === 'assistant') {
      for (const c of m.edit_group_completes ?? []) {
        if (!out.has(c.plan_id)) out.set(c.plan_id, { approvedGroupIds: [], completedGroupIds: [] })
        const r = out.get(c.plan_id)!
        if (!r.completedGroupIds.includes(c.group_id)) r.completedGroupIds.push(c.group_id)
      }
    } else if (m.role === 'user') {
      const match = /APPROVAL\s+\[([^\]]+)\]:\s*(.+?)\s*$/m.exec(m.content)
      if (!match) continue
      const planId = match[1].trim()
      if (!knownPlans.has(planId)) continue
      const tail = match[2].trim()
      if (!out.has(planId)) out.set(planId, { approvedGroupIds: [], completedGroupIds: [] })
      const r = out.get(planId)!
      if (/^deny\b/i.test(tail)) { r.denied = true; continue }
      if (/^continue\b/i.test(tail)) continue
      const approveMatch = /^approve\s+(.+)$/i.exec(tail)
      if (!approveMatch) continue
      const ids = approveMatch[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      for (const id of ids) if (!r.approvedGroupIds.includes(id)) r.approvedGroupIds.push(id)
    }
  }
  return out
}

interface EnqueueOkAsync  { ok: true;  mode?: undefined;       jobId: string; sessionId: string; usage?: ContextUsageView }
interface EnqueueOkCodex  { ok: true;  mode: 'codex-direct';                  sessionId: string; sessionTag: string; text: string; usage?: ContextUsageView }
type    EnqueueOk         = EnqueueOkAsync | EnqueueOkCodex
interface EnqueueFail     { ok: false; error: string; code: string; fallbackHint?: string }
type EnqueueResponse = EnqueueOk | EnqueueFail

interface PollOk     { ok: true;  status: 'pending' | 'running' | 'done' | 'error'; text?: string; partialText?: string; approval_requests?: ApprovalRequest[]; tool_calls?: ToolCall[]; edit_plans?: EditPlan[]; edit_group_completes?: EditGroupComplete[]; pending_permission_requests?: PermissionRequest[]; crashed?: CrashedInfo; jobError?: string; durationMs?: number }
interface PollFail   { ok: false; error: string; code: string }
type PollResponse = PollOk | PollFail

interface SessionsResp { ok: true; sessions: SessionSummary[] }
interface MessagesResp { ok: true; session: SessionSummary; messages: Array<{ id: string; role: 'user'|'assistant'|'system'; content: string; metadata: { approval_requests?: ApprovalRequest[]; tool_calls?: ToolCall[]; durationMs?: number; crashed?: CrashedInfo; edit_plans?: EditPlan[]; edit_group_completes?: EditGroupComplete[] } }> }

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS  = 5 * 60_000
/** Stream-side hard cap. Slightly tighter than the server's MAX_DURATION_GUARD_MS
 *  so the client gives up first and the server's `continue` event has time to
 *  flush before the connection is torn down. */
const STREAM_TIMEOUT_MS = 295_000

/**
 * Unified shape `pollUntilDone` and `streamUntilDone` both return. The
 * `cancelled` flag means the operator clicked Cancel; `continueWithPoll`
 * means the stream couldn't complete (Vercel timeout or recoverable error)
 * and the caller should fall through to `pollUntilDone(jobId, sessionId)`.
 */
interface StreamOrPollResult {
  text:                   string
  durationMs:             number
  approval_requests?:     ApprovalRequest[]
  tool_calls?:            ToolCall[]
  crashed?:               CrashedInfo
  edit_plans?:            EditPlan[]
  edit_group_completes?:  EditGroupComplete[]
  cancelled?:             boolean
  continueWithPoll?:      boolean
}

interface Props {
  slug: string
  name: string
}

export default function BusinessChat({ slug, name }: Props) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [partial,  setPartial]  = useState<string>('')
  // Phase 3 — in-flight tool calls observed during the running turn.
  // See components/platform-chat/PlatformChat.tsx for design notes.
  const [inflightToolCalls, setInflightToolCalls] = useState<ToolCall[]>([])
  const bottomRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef(false)

  // Multi-session state — mirrors PlatformChat but talks to the
  // per-business sessions API so the scope filter is 'business:<slug>'.
  const [sessions,        setSessions]        = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Phase 9 — Views dropdown (Tasks / Approvals / Calendar). Scope is
  // `business:<slug>` so the views show this business's items only.
  const viewScope = `business:${slug}`
  const [activeView,     setActiveView]     = useState<ViewName | null>(null)
  const [tasksBadge,     setTasksBadge]     = useState<number>(0)
  const [approvalsBadge, setApprovalsBadge] = useState<number>(0)

  // Context usage from the most-recent successful enqueue. Surfaces in
  // the bottom-right ContextIndicator.
  const [usage, setUsage] = useState<ContextUsageView | null>(null)

  // Phase 1 of task_plan-mobile-copilot.md — per-turn timeout selector.
  // Storage key is per-business so different businesses can keep different defaults.
  const { value: turnTimeoutMs, setValue: setTurnTimeoutMs } = useTurnTimeoutMs(`nexus:business-chat:${slug}:turn-timeout-ms`)

  // Pending CLI tool-permission requests — same wiring as PlatformChat.
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([])

  // Per-plan resolution map for EditPlanCards — mirror of PlatformChat.
  const editPlanResolutions = computeEditPlanResolutions(messages)
  // Pick the current pending action so FloatingActionBar can surface it.
  const pendingAction = pickPendingAction(messages, editPlanResolutions)

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [messages, busy, partial])

  // Reload session list — called on mount + after create/delete.
  const reloadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat/sessions`, { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      const j = (await res.json()) as SessionsResp | { ok: false; error: string }
      if (j.ok) setSessions(j.sessions)
    } catch { /* swallow — sidebar shows empty state */ }
    finally { setSessionsLoading(false) }
  }, [slug])
  useEffect(() => { void reloadSessions() }, [reloadSessions])

  // Load history when the operator picks a session.
  useEffect(() => {
    if (!activeSessionId) { setMessages([]); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat/sessions/${activeSessionId}/messages`, { cache: 'no-store' })
        if (!res.ok) return
        const j = (await res.json()) as MessagesResp | { ok: false }
        if (!j.ok || cancelled) return
        setMessages(j.messages.map(m => ({
          role:                 m.role === 'system' ? 'assistant' : m.role,
          content:              m.content,
          durationMs:           m.metadata?.durationMs,
          approval_requests:    m.metadata?.approval_requests,
          tool_calls:           m.metadata?.tool_calls,
          crashed:              m.metadata?.crashed,
          edit_plans:           m.metadata?.edit_plans,
          edit_group_completes: m.metadata?.edit_group_completes,
        })))
        setError(null)
      } catch { /* swallow */ }
    })()
    return () => { cancelled = true }
  }, [activeSessionId, slug])

  function handleNewChat() {
    setActiveSessionId(null)
    setMessages([])
    setError(null)
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat/sessions/${sessionId}`, { method: 'DELETE' })
      if (!res.ok && res.status !== 404) {
        setError('Failed to delete chat — please retry.')
        return
      }
      if (sessionId === activeSessionId) {
        setActiveSessionId(null)
        setMessages([])
      }
      await reloadSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'delete failed')
    }
  }

  function handleApproval(approval: ApprovalRequest, approvedItemIds: string[]) {
    const reply = buildApprovalReply(approval.approval_id, approvedItemIds, approval.items.map(it => it.id))
    setMessages(prev => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        const m = next[i]
        if (m.approval_requests?.some(r => r.approval_id === approval.approval_id)) {
          next[i] = {
            ...m,
            approval_resolutions: {
              ...(m.approval_resolutions ?? {}),
              [approval.approval_id]: {
                approvedItemIds,
                deniedItemIds: approval.items.map(it => it.id).filter(id => !approvedItemIds.includes(id)),
              },
            },
          }
          break
        }
      }
      return next
    })
    // Mirror PlatformChat: fire send() directly, never put the wire-format
    // reply in the input box. The card's resolution state is the visual
    // confirmation. See isApprovalReply() for the render filter.
    void send(reply)
  }

  function handleEditPlanReply(planId: string, mode: 'approve' | 'continue' | 'deny', approvedGroupIds?: string[]) {
    const reply = buildEditPlanReply(planId, mode, approvedGroupIds)
    void send(reply)
  }

  function handleBarApproveAll() {
    if (!pendingAction) return
    if (pendingAction.kind === 'approval-request') {
      handleApproval(pendingAction.request, pendingAction.request.items.map(it => it.id))
    } else if (pendingAction.kind === 'edit-plan-approve') {
      handleEditPlanReply(pendingAction.plan.plan_id, 'approve', pendingAction.plan.groups.map(g => g.id))
    }
  }
  function handleBarContinue() {
    if (pendingAction?.kind === 'edit-plan-continue') {
      handleEditPlanReply(pendingAction.plan.plan_id, 'continue')
    }
  }
  function handleBarDeny() {
    if (!pendingAction) return
    if (pendingAction.kind === 'approval-request') {
      handleApproval(pendingAction.request, [])
    } else {
      handleEditPlanReply(pendingAction.plan.plan_id, 'deny')
    }
  }

  // The permission-broker endpoint is platform-scoped (not business-
  // scoped) because rows are keyed by user_id + job_id only — see
  // app/api/platform-chat/permission-requests/[id]/route.ts. So we hit
  // the same URL from both chat surfaces.
  async function decidePermission(id: string, allow: boolean, opts?: { updatedInput?: Record<string, unknown>; reason?: string }) {
    setPendingPermissions(prev => prev.filter(r => r.id !== id))
    try {
      const res = await fetch(`/api/platform-chat/permission-requests/${encodeURIComponent(id)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          allow,
          ...(opts?.updatedInput ? { updated_input: opts.updatedInput } : {}),
          ...(opts?.reason       ? { reason:        opts.reason }       : {}),
        }),
      })
      if (!res.ok && res.status !== 409) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(`permission decide failed: ${body.error ?? res.status}`)
      }
    } catch (e) {
      setError(`permission decide network error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function handleCancel() {
    if (!busy) return
    cancelRef.current = true
  }

  async function send(forcedText?: string) {
    const text = (forcedText ?? input).trim()
    if (!text || busy) return
    setError(null)
    cancelRef.current = false
    setPartial('')
    setInflightToolCalls([])
    setPendingPermissions([])
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)

    try {
      const provider = readChatProvider(`nexus:business-chat:${slug}:provider`)
      const enqRes = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          messages:  nextMessages,
          sessionId: activeSessionId,
          provider,
          // Phase 1 of task_plan-mobile-copilot.md — null = "No limit"
          // (omit field so gateway uses its env cap).
          ...(turnTimeoutMs !== null ? { requestTimeoutMs: turnTimeoutMs } : {}),
        }),
      })
      if (enqRes.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      const enq = (await enqRes.json()) as EnqueueResponse
      if (!enq.ok) { setError(enq.fallbackHint ? `${enq.error} — ${enq.fallbackHint}` : enq.error); return }
      if (!activeSessionId) setActiveSessionId(enq.sessionId)
      if (enq.usage) setUsage(enq.usage)

      // Phase 0 of task_plan-model-agnostic-chat.md — Codex direct dispatch
      // returns the assistant text inline. No jobId, no polling. Render as
      // a plain bubble (typed blocks unreliable on this path).
      if (enq.mode === 'codex-direct') {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: enq.text,
        }])
        return
      }

      // Stream the reply (SSE) when enabled, else fall back to poll. The
      // SSE bridge inner-polls the gateway at 250ms (vs 2.5s poll) and
      // pushes text deltas as they arrive. On Vercel function timeout or
      // any mid-stream error, streamUntilDone returns continueWithPoll=true
      // so we transparently pick up via the existing poll path with the
      // same jobId — the gateway job is unaffected.
      let finalResult: StreamOrPollResult
      const streamEnabled = process.env.NEXT_PUBLIC_BUSINESS_CHAT_STREAM_ENABLED === '1'
      if (streamEnabled) {
        const streamed = await streamUntilDone(enq.jobId, enq.sessionId)
                                .catch(err => { console.warn(`[business-chat:${slug}] stream failed, falling back to poll:`, err); return null })
        if (streamed && !streamed.continueWithPoll) {
          finalResult = streamed
        } else {
          finalResult = await pollUntilDone(enq.jobId, enq.sessionId)
        }
      } else {
        finalResult = await pollUntilDone(enq.jobId, enq.sessionId)
      }
      if (finalResult.cancelled) {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: '_Run cancelled by operator. The gateway job continues server-side and will finish silently — its cost still applies (server-side cancel is a follow-up)._',
        }])
        void reloadSessions()
        return
      }
      setMessages(prev => [...prev, {
        role:                 'assistant',
        content:              finalResult.text,
        durationMs:           finalResult.durationMs,
        approval_requests:    finalResult.approval_requests,
        tool_calls:           finalResult.tool_calls,
        crashed:              finalResult.crashed,
        edit_plans:           finalResult.edit_plans,
        edit_group_completes: finalResult.edit_group_completes,
      }])
      setPartial('')
      setInflightToolCalls([])
      void reloadSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  async function pollUntilDone(jobId: string, sessionId: string): Promise<StreamOrPollResult> {
    const start = Date.now()
    const qs = `jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sessionId)}`
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      if (cancelRef.current) {
        return { text: '', durationMs: Date.now() - start, cancelled: true }
      }
      const res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat/poll?${qs}`, { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        throw new Error('session expired during poll')
      }
      const j = (await res.json()) as PollResponse
      if (!j.ok) throw new Error(j.error)
      if (j.status === 'done') {
        return {
          text:                 (j.text ?? '').trim()
                                    || (j.crashed
                                         || (j.approval_requests?.length ?? 0) > 0
                                         || (j.tool_calls?.length ?? 0) > 0
                                         || (j.edit_plans?.length ?? 0) > 0
                                         ? ''
                                         : '(empty response from the gateway — the agent finished without writing a final reply)'),
          durationMs:           j.durationMs ?? (Date.now() - start),
          approval_requests:    j.approval_requests,
          tool_calls:           j.tool_calls,
          crashed:              j.crashed,
          edit_plans:           j.edit_plans,
          edit_group_completes: j.edit_group_completes,
        }
      }
      if (j.status === 'error') {
        // Mid-stream crash — return a message with crashed metadata
        // instead of throwing so the operator sees both partial text
        // and the CrashedTurnCard.
        return {
          text:                 (j.text ?? '').trim(),
          durationMs:           j.durationMs ?? (Date.now() - start),
          tool_calls:           j.tool_calls,
          edit_plans:           j.edit_plans,
          edit_group_completes: j.edit_group_completes,
          crashed:            j.crashed ?? { exit_code: null, stderr_tail: null, raw: j.jobError ?? null },
        }
      }
      if (j.partialText) setPartial(j.partialText)
      setPendingPermissions(j.pending_permission_requests ?? [])
    }
    throw new Error(`timed out waiting for response (>${Math.round(POLL_TIMEOUT_MS / 60_000)} min). The agent may still be running on the business gateway — check Coolify logs.`)
  }

  /**
   * Stream `/api/businesses/[slug]/chat/stream` via SSE — mirror of the
   * platform-chat stream client. Same wire format (ready / delta /
   * heartbeat / done / continue / error). Returns continueWithPoll=true
   * on any recoverable failure so the caller can transparently fall
   * back to pollUntilDone(jobId, sessionId) using the same jobId.
   * See components/platform-chat/PlatformChat.tsx for design notes.
   */
  async function streamUntilDone(
    jobId: string,
    sessionId: string,
  ): Promise<StreamOrPollResult> {
    const start = Date.now()
    const qs = `jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sessionId)}`
    const ac  = new AbortController()
    // Cancel watcher — operator's Cancel button aborts the reader.
    // The gateway job continues server-side; client falls back to poll
    // if it ever needs to re-attach.
    const cancelWatch = setInterval(() => { if (cancelRef.current) ac.abort() }, 200)
    const timeoutTimer = setTimeout(() => ac.abort(), STREAM_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetch(`/api/businesses/${encodeURIComponent(slug)}/chat/stream?${qs}`, {
        cache:   'no-store',
        headers: { 'Accept': 'text/event-stream' },
        signal:  ac.signal,
      })
    } catch {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
      if (cancelRef.current) return { text: '', durationMs: Date.now() - start, cancelled: true }
      return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
    }

    if (res.status === 401) {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
      const here = window.location.pathname + window.location.search
      window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
      throw new Error('session expired during stream')
    }
    if (!res.ok || !res.body) {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
      console.warn(`[business-chat:${slug}] stream returned ${res.status} — falling back to poll`)
      return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
    }

    const reader  = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer    = ''
    let final: StreamOrPollResult | null = null

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        if (cancelRef.current) {
          await reader.cancel().catch(() => { /* already done */ })
          return { text: '', durationMs: Date.now() - start, cancelled: true }
        }
        buffer += decoder.decode(value, { stream: true })

        let idx: number
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const block = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          if (block.startsWith(':')) continue   // SSE comment — heartbeat

          let eventName = 'message'
          let dataLine  = ''
          for (const line of block.split('\n')) {
            if (line.startsWith('event:')) eventName = line.slice(6).trim()
            else if (line.startsWith('data:')) dataLine += line.slice(5).trim()
          }
          if (!dataLine) continue
          let parsed: Record<string, unknown> = {}
          try { parsed = JSON.parse(dataLine) } catch { continue }

          if (eventName === 'delta' && typeof parsed.text === 'string') {
            const chunk = parsed.text
            setPartial(prev => prev + chunk)
          } else if (eventName === 'tool_event' && parsed.call && typeof (parsed.call as { id?: unknown }).id === 'string') {
            // Phase 3 — see PlatformChat.tsx for design notes.
            const call = parsed.call as ToolCall
            setInflightToolCalls(prev => {
              const idx = prev.findIndex(c => c.id === call.id)
              if (idx === -1) return [...prev, call]
              const next = prev.slice()
              next[idx] = call
              return next
            })
          } else if (eventName === 'done') {
            final = {
              text:                 typeof parsed.text === 'string' ? parsed.text : '',
              durationMs:           typeof parsed.durationMs === 'number' ? parsed.durationMs : Date.now() - start,
              approval_requests:    Array.isArray(parsed.approval_requests)    ? parsed.approval_requests    as ApprovalRequest[]    : undefined,
              tool_calls:           Array.isArray(parsed.tool_calls)           ? parsed.tool_calls           as ToolCall[]           : undefined,
              edit_plans:           Array.isArray(parsed.edit_plans)           ? parsed.edit_plans           as EditPlan[]           : undefined,
              edit_group_completes: Array.isArray(parsed.edit_group_completes) ? parsed.edit_group_completes as EditGroupComplete[] : undefined,
              crashed:              parsed.crashed as CrashedInfo | undefined,
            }
            const perms = Array.isArray(parsed.pending_permission_requests) ? parsed.pending_permission_requests as PermissionRequest[] : []
            setPendingPermissions(perms)
            break
          } else if (eventName === 'continue') {
            return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
          } else if (eventName === 'error') {
            const code = typeof parsed.code === 'string' ? parsed.code : 'gateway_error'
            const msg  = typeof parsed.message === 'string' ? parsed.message : 'stream error'
            console.warn(`[business-chat:${slug}] stream error code=${code} message=${msg} — falling back to poll`)
            return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
          }
        }
        if (final) break
      }
    } catch (err) {
      if (cancelRef.current) return { text: '', durationMs: Date.now() - start, cancelled: true }
      console.warn(`[business-chat:${slug}] stream reader threw — falling back to poll:`, err)
      return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
    } finally {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
    }

    return final ?? { text: '', durationMs: Date.now() - start, continueWithPoll: true }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[500px]">
      <SessionSidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        loading={sessionsLoading}
        onSelect={setActiveSessionId}
        onNew={handleNewChat}
        onDelete={handleDeleteSession}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="px-4 py-3 border-b flex flex-col gap-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
              <Briefcase size={14} style={{ color: '#a8a3ff' }} className="shrink-0" />
              <span style={{ color: '#e8e8f0' }}>{name} copilot</span>
              <span style={{ color: '#55556a' }}>—</span>
              <span className="truncate" style={{ color: '#9090b0' }}>scoped to this business, uses per-business + Shared connections</span>
            </div>
            <ViewsDropdown
              scope={viewScope}
              activeView={activeView}
              onOpen={setActiveView}
              badges={{ tasks: tasksBadge, approvals: approvalsBadge }}
            />
          </div>
          {/* MCP awareness strip (audit 2026-05-16 §6.6) — shows what's
              powering this chat before the operator types. */}
          <McpStatusStrip scope={`business:${slug}`} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {messages.length === 0 && <EmptyState name={name} />}
          {messages.map((m, i) => {
            if (m.role === 'user' && isApprovalReply(m.content)) return null
            return (
              <MessageBubble key={i} message={m} onApprove={handleApproval} onEditPlanReply={handleEditPlanReply} editPlanResolutions={editPlanResolutions} busy={busy} />
            )
          })}
          {busy && pendingPermissions.length > 0 && (
            <div className="flex justify-start">
              <div className="max-w-[85%] w-full">
                {pendingPermissions.map(req => (
                  <PermissionPromptCard
                    key={req.id}
                    request={req}
                    onAllow={(id, updatedInput) => void decidePermission(id, true,  { updatedInput })}
                    onDeny={(id, reason)        => void decidePermission(id, false, { reason })}
                  />
                ))}
              </div>
            </div>
          )}
          {/* Phase 2a + Phase 3 — tentative bubble with partial text +
              progressively-arriving tool calls. Mirrors PlatformChat. */}
          {busy && (partial || inflightToolCalls.length > 0) && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm" style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                border:     '1px dashed rgba(168,163,255,0.30)',
                color:      '#c8c8d8',
              }}>
                <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: '#a8a3ff' }}>Streaming</div>
                {inflightToolCalls.length > 0 && (
                  <div className="mb-2">
                    {inflightToolCalls.map(call => <ToolCallCard key={call.id} call={call} />)}
                  </div>
                )}
                {partial && <div className="whitespace-pre-wrap">{partial}</div>}
              </div>
            </div>
          )}
          {busy && <ThinkingIndicator onCancel={handleCancel} />}
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          <div ref={bottomRef} />
        </div>

        {pendingAction && !busy && (
          <FloatingActionBar
            action={pendingAction}
            onApproveAll={handleBarApproveAll}
            onContinue={handleBarContinue}
            onDeny={handleBarDeny}
          />
        )}

        <div className="border-t p-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex gap-2 rounded-xl p-3" style={{
            background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            border:               '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={messages.length === 0 ? `Ask the ${name} copilot anything — Enter to send, Shift+Enter for newline` : 'Reply… (Enter to send)'}
              rows={Math.min(8, Math.max(2, input.split('\n').length))}
              disabled={busy}
              className="flex-1 resize-none bg-transparent focus:outline-none text-sm font-mono"
              style={{ color: '#e8e8f0' }}
            />
            <button
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              // Tap-target ≥44px on mobile per Phase 2 of task_plan-mobile-copilot.md.
              className="self-end px-3.5 py-2 min-h-[44px] rounded-lg flex items-center gap-1.5 text-sm font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
              style={{
                background: 'linear-gradient(135deg, rgba(108,99,255,0.30), rgba(108,99,255,0.06))',
                border:     '1px solid rgba(108,99,255,0.30)',
                color:      '#e8e8f0',
              }}
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              <span>{busy ? 'Working…' : 'Send'}</span>
            </button>
          </div>
          <div className="mt-2 text-[11px] flex flex-wrap items-center gap-2" style={{ color: '#55556a' }}>
            <TerminalIcon size={11} className="hidden sm:inline" />
            <span className="hidden sm:inline flex-1 min-w-0 truncate">
              Scoped to <span className="font-mono">business:{slug}</span> — per-business + Shared fallback.
              {process.env.NEXT_PUBLIC_BUSINESS_CHAT_STREAM_ENABLED === '1'
                ? ' SSE streaming on; falls back to poll if the stream drops.'
                : ' Async polling — flip NEXT_PUBLIC_BUSINESS_CHAT_STREAM_ENABLED=1 to enable streaming.'}
            </span>
            <span className="flex-1 sm:hidden" />
            <TurnTimeoutSelector value={turnTimeoutMs} onChange={setTurnTimeoutMs} />
            <ChatProviderToggle storageKey={`nexus:business-chat:${slug}:provider`} />
            {/* Bottom-right context-usage indicator — mirrors Claude Code Desktop. */}
            <ContextIndicator usage={usage} />
          </div>
        </div>
      </div>

      {/* Phase 9 — Views side panel (per-business scope). Resizable via
          left-edge handle (persisted per-business per-view in localStorage). */}
      {activeView === 'tasks' && (
        <ViewsPanel title="Manual to-dos" subtitle={`Tasks the ${name} copilot flagged for you`} onClose={() => setActiveView(null)} storageKey={`nexus:views-panel:business:${slug}:tasks`}>
          <TasksView scope={viewScope} onCountChange={setTasksBadge} />
        </ViewsPanel>
      )}
      {activeView === 'approvals' && (
        <ViewsPanel title="Approval queue" subtitle={`Pending approval cards in ${name}`} onClose={() => setActiveView(null)} storageKey={`nexus:views-panel:business:${slug}:approvals`}>
          <ApprovalsView scope={viewScope} sessionsBasePath={`/businesses/${encodeURIComponent(slug)}/chat`} onCountChange={setApprovalsBadge} />
        </ViewsPanel>
      )}
      {activeView === 'calendar' && (
        <ViewsPanel title="Calendar" subtitle={`Upcoming due dates + runs for ${name}`} onClose={() => setActiveView(null)} storageKey={`nexus:views-panel:business:${slug}:calendar`}>
          <CalendarView scope={viewScope} />
        </ViewsPanel>
      )}
      {activeView === 'health' && (
        <ViewsPanel title="Health" subtitle={`Failure surfaces scoped to ${name}`} onClose={() => setActiveView(null)} storageKey={`nexus:views-panel:business:${slug}:health`}>
          <HealthView scope={viewScope} />
        </ViewsPanel>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState({ name }: { name: string }) {
  const examples = [
    `"What did ${name} ship this week?"`,
    `"Show me the last 3 errors from the ${name} Vercel project."`,
    `"Draft a tweet from the ${name} Twitter — propose it first."`,
    `"Why is the ${name} Stripe webhook 500-ing?"`,
    `"Sync the ${name} domain DNS to Cloudflare — show the diff before applying."`,
  ].join('\n')
  return (
    <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
      <Briefcase size={32} style={{ color: '#a8a3ff' }} className="mx-auto" />
      <h2 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>
        How can I help with {name}?
      </h2>
      <p className="text-sm" style={{ color: '#9090b0' }}>
        I have read access to this business&apos;s connected accounts (and any Shared fallbacks).
        I&apos;ll always propose a plan and ask for approval before making any change that mutates state.
      </p>
      <pre className="text-xs text-left p-3 rounded-lg overflow-x-auto" style={{
        background: 'rgba(255,255,255,0.03)',
        border:     '1px solid rgba(255,255,255,0.08)',
        color:      '#9090b0',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
      }}>
        Try:{'\n'}{examples}
      </pre>
    </div>
  )
}

function ThinkingIndicator({ onCancel }: { onCancel?: () => void }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: '#9090b0' }}>
      <Loader2 size={14} className="animate-spin" />
      <span>Claude is working — checking this business&apos;s connections… ({elapsed}s)</span>
      {onCancel && (
        <button
          onClick={onCancel}
          title="Cancel — stop polling. The gateway job continues server-side but its result is ignored."
          className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
          style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
        >
          <XIcon size={10} /> Cancel
        </button>
      )}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="rounded-lg p-3 flex items-start gap-2" style={{
      background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5',
    }}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <div className="font-semibold mb-1">Turn failed</div>
        <div className="font-mono text-xs whitespace-pre-wrap">{message}</div>
      </div>
      <button onClick={onDismiss} className="text-xs underline opacity-80 hover:opacity-100">Dismiss</button>
    </div>
  )
}

function MessageBubble({ message, onApprove, onEditPlanReply, editPlanResolutions, busy }: { message: Message; onApprove: (request: ApprovalRequest, approvedItemIds: string[]) => void; onEditPlanReply: (planId: string, mode: 'approve' | 'continue' | 'deny', approvedGroupIds?: string[]) => void; editPlanResolutions: Map<string, EditPlanResolution>; busy: boolean }) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div className="max-w-[85%] rounded-2xl px-4 py-3 text-sm" style={{
        background: isUser
          ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.10))'
          : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
        border: isUser ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
        color:  '#e8e8f0',
      }}>
        {!isUser && message.crashed && (
          <CrashedTurnCard crashed={message.crashed} />
        )}
        {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mb-2">
            {message.tool_calls.map(call => <ToolCallCard key={call.id} call={call} />)}
          </div>
        )}
        {message.content && <RenderedMarkdown text={message.content} highlightClaimed={!!message.crashed} />}
        {!isUser && message.approval_requests?.map(req => (
          <ApprovalCard
            key={req.approval_id}
            request={req}
            resolution={message.approval_resolutions?.[req.approval_id] ?? null}
            disabled={busy}
            onSubmit={ids => onApprove(req, ids)}
          />
        ))}
        {!isUser && message.edit_plans?.map(plan => (
          <EditPlanCard
            key={plan.plan_id}
            plan={plan}
            resolution={editPlanResolutions.get(plan.plan_id) ?? null}
            disabled={busy}
            onApprove={ids => onEditPlanReply(plan.plan_id, 'approve', ids)}
            onContinue={()  => onEditPlanReply(plan.plan_id, 'continue')}
            onDeny={()      => onEditPlanReply(plan.plan_id, 'deny')}
          />
        ))}
        {message.durationMs !== undefined && (
          <div className="mt-2 text-[10px]" style={{ color: '#55556a' }}>
            {(message.durationMs / 1000).toFixed(1)}s
          </div>
        )}
      </div>
    </div>
  )
}

function RenderedMarkdown({ text, highlightClaimed = false }: { text: string; highlightClaimed?: boolean }) {
  const blocks = splitFencedCode(text)
  return (
    <div className="space-y-2">
      {blocks.map((b, i) => b.kind === 'code'
        ? <CodeBlock key={i} code={b.body} lang={b.lang} />
        : <p key={i} className="whitespace-pre-wrap">
            {highlightClaimed ? renderWithClaimedHighlights(b.body) : b.body}
          </p>,
      )}
    </div>
  )
}

/** Same as PlatformChat's amber-highlight wrapper — duplicated here so
 *  BusinessChat doesn't have to import a UI helper from a sibling chat. */
function renderWithClaimedHighlights(body: string): React.ReactNode {
  const ranges = findClaimedRanges(body)
  if (ranges.length === 0) return body
  const out: React.ReactNode[] = []
  let cursor = 0
  for (let i = 0; i < ranges.length; i++) {
    const [s, e] = ranges[i]
    if (s > cursor) out.push(body.slice(cursor, s))
    out.push(
      <mark
        key={`claim-${i}-${s}`}
        title="The agent claimed this work — but the turn crashed mid-stream. Verify it actually happened."
        style={{ background: 'rgba(245,158,11,0.20)', color: '#fbbf24', padding: '0 2px', borderRadius: 3 }}
      >
        {body.slice(s, e)}
      </mark>,
    )
    cursor = e
  }
  if (cursor < body.length) out.push(body.slice(cursor))
  return out
}

function splitFencedCode(text: string): Array<{ kind: 'text' | 'code'; body: string; lang?: string }> {
  const re = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g
  const out: Array<{ kind: 'text' | 'code'; body: string; lang?: string }> = []
  let last = 0
  let m
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push({ kind: 'text', body: text.slice(last, m.index) })
    out.push({ kind: 'code', body: m[2], lang: m[1] || undefined })
    last = m.index + m[0].length
  }
  if (last < text.length) out.push({ kind: 'text', body: text.slice(last) })
  return out.length > 0 ? out : [{ kind: 'text', body: text }]
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="relative rounded-lg overflow-hidden" style={{ background: 'rgba(0,0,0,0.40)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex items-center justify-between px-3 py-1.5 text-[10px]" style={{ color: '#9090b0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span className="font-mono uppercase tracking-wider">{lang || 'text'}</span>
        <button onClick={onCopy} className="flex items-center gap-1 hover:opacity-100 opacity-70">
          {copied ? <Check size={10} /> : <Copy size={10} />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-xs font-mono" style={{ color: '#e8e8f0' }}>{code}</pre>
    </div>
  )
}
