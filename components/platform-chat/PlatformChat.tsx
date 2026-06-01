'use client'

/**
 * PlatformChat — /manage-platform Console tab body.
 *
 * Phase 1 — chat shell + async dispatch (#145, #155)
 * Phase 3 — approval cards via the approval-request sentinel (this PR)
 * Phase 4 — persistence + multi-chat + delete via chat_sessions (this PR)
 *
 * Phase 2 (SSE streaming + tool-call cards) and Phase 5+ are deferred.
 * See task_plan-chat.md for the full plan.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Send, Sparkles, AlertTriangle, Terminal as TerminalIcon, Copy, Check, X as XIcon, Menu } from 'lucide-react'
import { safeJson } from '@/lib/chat/safe-json-response'
import ApprovalCard from './ApprovalCard'
import RetrospectiveBanner from '@/components/chat/RetrospectiveBanner'
import { type SessionSummary } from './SessionSidebar'
import MobileAwareSessionSidebar from './MobileAwareSessionSidebar'
import ToolCallCard from './ToolCallCard'
import CrashedTurnCard, { type CrashedInfo } from './CrashedTurnCard'
import ContextIndicator, { type ContextUsageView } from './ContextIndicator'
import EditPlanCard, { type EditPlanResolution } from './EditPlanCard'
import EditSelfCard, { type EditSelfResolution } from './EditSelfCard'
import PermissionPromptCard, { type PermissionRequest } from './PermissionPromptCard'
import FloatingActionBar from './FloatingActionBar'
import McpStatusStrip from '@/components/chat/McpStatusStrip'
import { findClaimedRanges } from '@/lib/chat/crash'
import { buildEditPlanReply, type EditPlan, type EditGroupComplete } from '@/lib/chat/edit-plan'
import { buildEditSelfReply, type EditSelfPlan } from '@/lib/chat/edit-self'
import { pickPendingAction } from '@/lib/chat/action-bar'
import ViewsDropdown, { type ViewName } from '@/components/chat-views/ViewsDropdown'
import ViewsPanel from '@/components/chat-views/ViewsPanel'
import TasksView from '@/components/chat-views/TasksView'
import ApprovalsView from '@/components/chat-views/ApprovalsView'
import CalendarView from '@/components/chat-views/CalendarView'
import BugHuntView from '@/components/chat-views/BugHuntView'
import HealthView from '@/components/chat-views/HealthView'
import BackgroundTasksView from '@/components/chat-views/BackgroundTasksView'
import NotesView from '@/components/chat-views/NotesView'
import { buildApprovalReply, isApprovalReply, type ApprovalRequest } from '@/lib/chat/approval'
import { computeApprovalResolutions } from '@/lib/chat/approval-resolutions'
import { fetchWithReauth } from '@/lib/chat/fetch-reauth'
import type { ToolCall } from '@/lib/claw/gateway-jobs'
import { TurnTimeoutSelector, useTurnTimeoutMs } from './TurnTimeoutSelector'
import { ModeSelector, useChatMode } from './ModeSelector'
import { ModelSelector, useChatModel } from './ModelSelector'
import { getModelById } from '@/lib/chat/models'

interface Message {
  role:       'user' | 'assistant'
  content:    string
  /** Wall-clock ms the turn took (assistant messages only). */
  durationMs?: number
  /** Approval requests extracted from the assistant text (Phase 3). */
  approval_requests?: ApprovalRequest[]
  /** Resolution state per approval_id, populated when the operator clicks
   *  Approve/Deny. Kept client-side so the card collapses but stays visible. */
  approval_resolutions?: Record<string, { approvedItemIds: string[]; deniedItemIds: string[] }>
  /** Tool calls observed during the turn (Phase 2b). Render as cards. */
  tool_calls?: ToolCall[]
  /** Crash info — when set, renders a CrashedTurnCard above the bubble
   *  and amber-highlights "claimed but unverified" phrases inline. */
  crashed?: CrashedInfo
  /** Multi-turn edit plans extracted from the assistant text. Rendered as
   *  EditPlanCards inline with the assistant bubble. */
  edit_plans?: EditPlan[]
  /** Per-group completion markers — used to flip status of prior cards. */
  edit_group_completes?: EditGroupComplete[]
  /** Continual Harness self-modification proposals (lib/chat/edit-self.ts).
   *  Rendered as EditSelfCard inline with the assistant bubble. */
  edit_selfs?: EditSelfPlan[]
  /** Durable chat (Phase D) — a persisted turn-level error stamped onto a
   *  user message when its dispatch failed. Survives reload (unlike the
   *  component-local `error` state) and renders an inline error note. */
  turn_error?: { code: string; message: string }
}

interface EnqueueOkAsync  { ok: true;  mode?: undefined;       jobId: string; sessionId: string; sessionTag: string; usage?: ContextUsageView }
interface EnqueueOkCodex  { ok: true;  mode: 'codex-direct';                  sessionId: string; sessionTag: string; text: string; usage?: ContextUsageView }
type    EnqueueOk         = EnqueueOkAsync | EnqueueOkCodex
interface EnqueueFail     { ok: false; error: string; code: string; fallbackHint?: string }
type EnqueueResponse = EnqueueOk | EnqueueFail

interface PollOk     { ok: true;  status: 'pending' | 'running' | 'done' | 'error'; text?: string; partialText?: string; approval_requests?: ApprovalRequest[]; tool_calls?: ToolCall[]; edit_plans?: EditPlan[]; edit_group_completes?: EditGroupComplete[]; edit_selfs?: EditSelfPlan[]; pending_permission_requests?: PermissionRequest[]; crashed?: CrashedInfo; jobError?: string; durationMs?: number; startedAt?: number; finishedAt?: number }
interface PollFail   { ok: false; error: string; code: string }
type PollResponse = PollOk | PollFail

interface SessionsResp { ok: true; sessions: SessionSummary[] }
interface MessagesResp { ok: true; session: SessionSummary & { retrospective_md?: string | null; retrospective_generated_at?: string | null; inflight_job_id?: string | null; inflight_started_at?: string | null }; messages: Array<{ id: string; role: 'user'|'assistant'|'system'; content: string; metadata: { approval_requests?: ApprovalRequest[]; tool_calls?: ToolCall[]; durationMs?: number; crashed?: CrashedInfo; edit_plans?: EditPlan[]; edit_group_completes?: EditGroupComplete[]; edit_selfs?: EditSelfPlan[]; turn_error?: { code: string; message: string } } }> }

const POLL_INTERVAL_MS = 2_500
const POLL_TIMEOUT_MS  = 5 * 60_000   // 5-min cap. Opus + tool-call workflows rarely exceed this.
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
  edit_selfs?:            EditSelfPlan[]
  cancelled?:             boolean
  continueWithPoll?:      boolean
}

/**
 * Walk the message list chronologically and build a per-plan_id snapshot
 * of approval + completion state. Operator `APPROVAL [<plan_id>]: approve
 * g1,g2` replies populate approvedGroupIds; assistant edit_group_completes
 * arrays populate completedGroupIds; `deny all` flips the denied flag.
 *
 * Returned map is keyed by plan_id so the MessageBubble can pass each
 * EditPlanCard the right slice without re-scanning.
 */
function computeEditPlanResolutions(messages: Message[]): Map<string, EditPlanResolution> {
  const out = new Map<string, EditPlanResolution>()
  // Track all known plan_ids first so we don't tag operator replies
  // against random strings — only against plans the agent actually emitted.
  const knownPlans = new Set<string>()
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
      if (/^continue\b/i.test(tail)) continue // no state change
      const approveMatch = /^approve\s+(.+)$/i.exec(tail)
      if (!approveMatch) continue
      const ids = approveMatch[1].split(/[,\s]+/).map(s => s.trim()).filter(Boolean)
      for (const id of ids) if (!r.approvedGroupIds.includes(id)) r.approvedGroupIds.push(id)
    }
  }
  return out
}

/**
 * Walk the message list and build a per-plan_id snapshot of approval state
 * for edit-self blocks. Simpler than computeEditPlanResolutions because
 * edit-self is one-shot — no `continue`, no per-group completion tracking.
 * Operator either approves the listed item_ids or denies the whole block.
 */
function computeEditSelfResolutions(messages: Message[]): Map<string, EditSelfResolution> {
  const out = new Map<string, EditSelfResolution>()
  const knownPlans = new Set<string>()
  for (const m of messages) for (const p of m.edit_selfs ?? []) knownPlans.add(p.plan_id)
  for (const m of messages) {
    if (m.role !== 'user') continue
    const match = /APPROVAL\s+\[([^\]]+)\]:\s*(.+?)\s*$/m.exec(m.content)
    if (!match) continue
    const planId = match[1].trim()
    if (!knownPlans.has(planId)) continue
    const tail = match[2].trim()
    if (/^deny\b/i.test(tail))     { out.set(planId, { approvedItemIds: [], denied: true }); continue }
    const approveMatch = /^approve\s+(.+)$/i.exec(tail)
    if (!approveMatch) continue
    const subset = approveMatch[1].trim()
    if (/^all$/i.test(subset))     { out.set(planId, { approvedItemIds: ['*'] }); continue }
    const ids = subset.split(',').map(s => s.trim()).filter(Boolean)
    out.set(planId, { approvedItemIds: ids })
  }
  return out
}

const PLACEHOLDER = [
  '"Show me the last 3 Vercel deploy failures and what broke"',
  '"Check the Slack channel #ops for anything I missed today"',
  '"Why is /api/gateway-status sometimes returning 503?"',
  '"Run tsc --noEmit and tell me what fails — delegate to codex if needed"',
  '"Add a new MCP entry for Beehiiv to lib/businesses/mcp-manifest.ts — propose the change first"',
].join('\n')

export default function PlatformChat() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [busy,     setBusy]     = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  // Phase 6 — Cancel button. cancelRef.current is set to true when the
  // operator clicks Cancel on a running job; the poll loop checks it on
  // each iteration and bails out. The server-side gateway job continues
  // to completion (wasted spend but bounded) — proper server-side cancel
  // is a follow-up that needs a gateway-side DELETE /api/jobs/:id endpoint.
  const cancelRef = useRef(false)
  // Phase 2a — partial text accumulated by the running job, polled on each
  // tick and rendered as a tentative assistant bubble while busy. Cleared
  // when the final message lands (or the turn is cancelled).
  const [partial, setPartial] = useState<string>('')
  // Phase 3 — in-flight tool calls observed during this turn. Keyed by
  // call.id so the SSE `tool_event` handler upserts in place when a
  // tool's tool_result lands (Wrench icon flips to CheckCircle). Rendered
  // ABOVE the partial-text bubble. Cleared on send() / cancel.
  const [inflightToolCalls, setInflightToolCalls] = useState<ToolCall[]>([])

  // Phase 4 — session state. activeSessionId is null until either the
  // operator creates/picks one explicitly, OR the first send() auto-creates
  // one (the server returns the new sessionId in the enqueue response).
  const [sessions,        setSessions]        = useState<SessionSummary[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Phase 9 — Views dropdown (Tasks / Approvals / Calendar).
  // Scope = 'admin' for platform-copilot.
  const [activeView,     setActiveView]     = useState<ViewName | null>(null)
  const [tasksBadge,     setTasksBadge]     = useState<number>(0)
  const [approvalsBadge, setApprovalsBadge] = useState<number>(0)
  const [bugHuntBadge,   setBugHuntBadge]   = useState<number>(0)

  // Context usage from the most-recent successful enqueue. Surfaces in
  // the bottom-right ContextIndicator (Claude-Code-Desktop style).
  const [usage, setUsage] = useState<ContextUsageView | null>(null)

  // Phase 1 of task_plan-mobile-copilot.md — per-turn timeout selector.
  // value is null when "No limit" is picked (gateway uses its env cap).
  const { value: turnTimeoutMs, setValue: setTurnTimeoutMs } = useTurnTimeoutMs('nexus:platform-chat:turn-timeout-ms')

  // Phase 1 of task_plan-collaborative-chat.md — per-turn mode + model.
  const { value: chatMode,  setValue: setChatMode  } = useChatMode('nexus:platform-chat:mode')
  const { value: chatModel, setValue: setChatModel } = useChatModel('nexus:platform-chat:model')

  // Phase 2C — mobile session sidebar reveal state. Closed by default; the
  // hamburger button in the chat header toggles it. Desktop ignores this.
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false)

  // Pending CLI tool-permission requests from the broker MCP (PR #189).
  // Refreshes on every poll tick while the turn is running; cleared when
  // the turn lands or the operator resolves them. Rendered above the
  // partial bubble so the operator sees them immediately.
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([])

  // Per-plan resolution map — aggregated across ALL messages on every
  // render. Each plan_id → { approvedGroupIds, completedGroupIds, denied }.
  // Computed inline (not memoized) because messages array changes on
  // every send/poll anyway, so memoization gains nothing meaningful.
  const editPlanResolutions = computeEditPlanResolutions(messages)
  // Mirror for edit-self blocks — same APPROVAL grammar, different shape.
  const editSelfResolutions = computeEditSelfResolutions(messages)
  // Mirror for approval-request blocks — derived from history so a card stays
  // resolved across reloads + re-emits (the per-message approval_resolutions
  // React state is ephemeral). Fixes the "Provision … (N items)" card that
  // re-appeared after approval + completion.
  const approvalResolutions = computeApprovalResolutions(messages)

  // The "current actionable thing" picked from messages + resolutions.
  // Feeds the FloatingActionBar above the input so the operator never
  // has to scroll up to an inline card to click Continue / Approve.
  const pendingAction = pickPendingAction(messages, editPlanResolutions, approvalResolutions)

  // Auto-scroll to bottom whenever new content arrives.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages, busy])

  // Prefill the composer from `?prompt=...` once on mount. The `/businesses/new`
  // "Start consultation in chat" link passes the consultation framing via the
  // prompt query param so the operator lands here ready to send. Without this
  // effect the param was silently dropped — operator landed on an empty
  // composer and had to retype the framing themselves.
  //
  // We strip the param from the URL after reading so a refresh doesn't
  // re-prefill (which would overwrite operator edits) and a Back navigation
  // sees a clean URL.
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const url      = new URL(window.location.href)
      const prefill  = url.searchParams.get('prompt')
      if (!prefill) return
      setInput(prev => prev.length === 0 ? prefill : prev)
      url.searchParams.delete('prompt')
      window.history.replaceState({}, '', url.toString())
    } catch {
      // window.history can throw in rare sandboxed contexts — non-fatal.
    }
  }, [])

  // Phase 2E — keep the latest message above the iOS keyboard. When the
  // textarea is focused on mobile, Safari fires visualViewport resize events
  // as the soft keyboard slides up; without intervention, the last message
  // disappears behind the keyboard. Scrolling on resize keeps it pinned.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return
    const vv = window.visualViewport
    function onResize() {
      bottomRef.current?.scrollIntoView({ block: 'end' })
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Load session list on mount + after each delete/create.
  const reloadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetchWithReauth('/api/platform-chat/sessions', { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      const j = (await res.json()) as SessionsResp | { ok: false; error: string }
      if (j.ok) setSessions(j.sessions)
    } catch { /* swallow — sidebar shows empty state */ }
    finally { setSessionsLoading(false) }
  }, [])
  useEffect(() => { void reloadSessions() }, [reloadSessions])

  // R9 — LLM-generated retrospective banner at the top of the chat
  // when the cron has summarised this session. Null on fresh sessions /
  // missing migration; the banner component returns null in that case.
  const [retrospective,   setRetrospective]   = useState<string | null>(null)
  const [retrospectiveAt, setRetrospectiveAt] = useState<string | null>(null)

  // Load message history when the operator switches sessions.
  useEffect(() => {
    if (!activeSessionId) {
      setMessages([])
      setRetrospective(null)
      setRetrospectiveAt(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`/api/platform-chat/sessions/${activeSessionId}/messages`, { cache: 'no-store' })
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
          edit_selfs:           m.metadata?.edit_selfs,
          // Phase D5 — a persisted dispatch error survives the reload here
          // (the component-local `error` state is lost on navigation).
          turn_error:           m.metadata?.turn_error,
        })))
        setRetrospective(j.session.retrospective_md ?? null)
        setRetrospectiveAt(j.session.retrospective_generated_at ?? null)
        setError(null)

        // Durable chat (Phase C) — re-attach to a turn that was still running
        // when the tab/app closed, so the reply lands without the operator
        // resending. `!busy` skips this when send() just set activeSessionId
        // for the turn it's already polling (no double-append). The server
        // reconciler + claimInflightTurn guard the persist race either way, so
        // a duplicate poll only costs an extra GET — never a duplicate row.
        const liveJobId = j.session.inflight_job_id ?? null
        if (liveJobId && !busy && !cancelled) {
          cancelRef.current = false
          setBusy(true)
          const resumeSessionId = activeSessionId
          pollUntilDone(liveJobId, resumeSessionId)
            .then(result => {
              if (cancelled || result.cancelled) return
              setMessages(prev => [...prev, {
                role:                 'assistant',
                content:              result.text,
                durationMs:           result.durationMs,
                approval_requests:    result.approval_requests,
                tool_calls:           result.tool_calls,
                crashed:              result.crashed,
                edit_plans:           result.edit_plans,
                edit_group_completes: result.edit_group_completes,
                edit_selfs:           result.edit_selfs,
              }])
              void reloadSessions()
            })
            .catch(() => { /* poll timeout / transient — operator can resend */ })
            .finally(() => { if (!cancelled) { setBusy(false); setPartial('') } })
        }
      } catch { /* swallow */ }
    })()
    return () => { cancelled = true }
    // pollUntilDone / reloadSessions are stable-enough component fns; listing
    // them would re-run this loader every render. Intentionally keyed on the
    // session id only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId])

  async function handleNewChat() {
    setActiveSessionId(null)
    setMessages([])
    setRetrospective(null)
    setRetrospectiveAt(null)
    setError(null)
  }

  async function handleDeleteSession(sessionId: string) {
    try {
      const res = await fetch(`/api/platform-chat/sessions/${sessionId}`, { method: 'DELETE' })
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
    // Mark resolution on the last message that contains this approval_id so
    // the card collapses to read-only state instead of duplicating.
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
    // The APPROVAL [...] reply is the wire format the agent reads, but
    // showing it as a user bubble in the chat just adds noise. Mirroring
    // Claude Code Desktop: the approval card's state change IS the visual
    // confirmation. Skip setInput, fire send directly with the reply text.
    // (The MessageBubble filter at render time also hides any APPROVAL
    // messages that already landed via DB persistence.)
    void send(reply)
  }

  function handleCancel() {
    if (!busy) return
    cancelRef.current = true
    // The poll loop notices on its next tick (max 2.5s) and bails out.
  }

  // Edit-plan handler — Approve / Continue / Deny all flow into one path
  // because the wire format is just an `APPROVAL [<plan_id>]: ...` string.
  // The card itself decides which mode applies for the current state.
  function handleEditPlanReply(planId: string, mode: 'approve' | 'continue' | 'deny', approvedGroupIds?: string[]) {
    const reply = buildEditPlanReply(planId, mode, approvedGroupIds)
    // Same pattern as handleApproval — fire-and-forget, no visible reply
    // bubble. The EditPlanCard's resolution state IS the confirmation.
    void send(reply)
  }

  // Edit-self handler — mirrors handleEditPlanReply but one-shot (no
  // continue). The agent's next turn reads the approval from history and
  // materialises the items via the standard Edit tool (per
  // .claude/agents/platform-copilot.md "Mid-cycle self-modification").
  function handleEditSelfReply(planId: string, mode: 'approve' | 'deny', approvedItemIds?: string[]) {
    const reply = buildEditSelfReply(planId, mode, approvedItemIds)
    void send(reply)
  }

  // FloatingActionBar dispatchers — all three just delegate to the
  // existing handleApproval / handleEditPlanReply paths so the inline
  // card + the bar share one code path. Each handler is safe to call
  // when pendingAction is the wrong kind because it null-checks first.
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

  async function send(forcedText?: string) {
    const text = (forcedText ?? input).trim()
    if (!text || busy) return
    setError(null)
    cancelRef.current = false   // reset flag for the new turn
    setPartial('')               // clear stale partial text from a prior run
    setInflightToolCalls([])     // clear stale in-flight tool calls
    setPendingPermissions([])    // clear any leftover permission cards
    const nextMessages: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(nextMessages)
    setInput('')
    setBusy(true)

    try {
      // Step 1 — enqueue. The route auto-creates a session when sessionId
      // is null and returns its id; subsequent turns include it so the
      // user + assistant messages persist into the same conversation.
      // Provider derives from the selected model — picking "Codex 5.5" from
      // the model dropdown routes through the codex-direct dispatch path,
      // any Claude model routes through claude-gateway. Subsumes the
      // pre-2026-05-24 ChatProviderToggle pill.
      const provider = getModelById(chatModel).provider
      const enqRes = await fetchWithReauth('/api/platform-chat', {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({
          messages:  nextMessages,
          sessionId: activeSessionId,
          provider,
          // Phase 1 of task_plan-mobile-copilot.md — null means "No limit",
          // omit the field so the gateway uses its env cap REQUEST_MAX_MS.
          ...(turnTimeoutMs !== null ? { requestTimeoutMs: turnTimeoutMs } : {}),
          // Phase 1 of task_plan-collaborative-chat.md — per-turn model + mode.
          modelOverride: chatModel,
          mode:          chatMode,
        }),
      })
      if (enqRes.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        return
      }
      // Defensive JSON parse — if the upstream proxy (Coolify / Cloudflare
      // Tunnel) hits a timeout and returns HTML instead of the route's JSON,
      // Safari throws "The string did not match the expected pattern" and
      // the operator sees a cryptic "Turn failed" banner instead of the
      // actual upstream issue. See lib/chat/safe-json-response.ts.
      const enqResult = await safeJson<EnqueueResponse>(enqRes)
      if (!enqResult.ok) {
        const detail = enqResult.snippet ? `\n\n${enqResult.snippet}` : ''
        setError(`${enqResult.error}${detail}`)
        return
      }
      const enq = enqResult.data
      if (!enq.ok) {
        setError(enq.fallbackHint ? `${enq.error} — ${enq.fallbackHint}` : enq.error)
        return
      }
      // Bind the session id (may have been auto-created on this turn).
      if (!activeSessionId) setActiveSessionId(enq.sessionId)
      // Surface context usage so the ContextIndicator in the input footer
      // reflects this turn's load.
      if (enq.usage) setUsage(enq.usage)

      // Phase 0 of task_plan-model-agnostic-chat.md — Codex direct dispatch
      // returns the assistant text in the enqueue response. No jobId, no
      // polling. Render it as a plain bubble (typed blocks unreliable on
      // this path — operator opted into the cost-savings trade).
      if (enq.mode === 'codex-direct') {
        setMessages(prev => [...prev, {
          role:    'assistant',
          content: enq.text,
        }])
        return
      }

      // Step 2 — stream the reply (SSE) when enabled, else fall back to
      // poll. The SSE bridge inner-polls the gateway at 250ms cadence
      // (vs 2.5s poll) and pushes text deltas as they arrive. On Vercel
      // function timeout or any mid-stream error, streamUntilDone returns
      // continueWithPoll=true so we transparently pick up via the existing
      // poll path with the same jobId — the gateway job is unaffected.
      let finalResult: StreamOrPollResult
      const streamEnabled = process.env.NEXT_PUBLIC_PLATFORM_CHAT_STREAM_ENABLED === '1'
      if (streamEnabled) {
        const streamed = await streamUntilDone(enq.jobId, enq.sessionId)
                                .catch(err => { console.warn('[platform-chat] stream failed, falling back to poll:', err); return null })
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
        role:                  'assistant',
        content:               finalResult.text,
        durationMs:            finalResult.durationMs,
        approval_requests:     finalResult.approval_requests,
        tool_calls:            finalResult.tool_calls,
        crashed:               finalResult.crashed,
        edit_plans:            finalResult.edit_plans,
        edit_group_completes:  finalResult.edit_group_completes,
        edit_selfs:            finalResult.edit_selfs,
      }])
      setPartial('')   // final landed, clear tentative bubble
      setInflightToolCalls([])   // final tool_calls live on the message now
      // Refresh sidebar (title may have been auto-derived from first message,
      // and last_message_at definitely changed).
      void reloadSessions()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'network error — check your connection and try again')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Poll /api/platform-chat/poll until the gateway job completes. The
   * sessionId is included in the query so the poll route persists the
   * assistant reply into chat_messages with the parsed approval_requests
   * already in metadata — page reloads recover the same UI state.
   */
  async function pollUntilDone(
    jobId: string,
    sessionId: string,
  ): Promise<StreamOrPollResult> {
    const start = Date.now()
    const qs = `jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sessionId)}`
    while (Date.now() - start < POLL_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, POLL_INTERVAL_MS))
      if (cancelRef.current) {
        return { text: '', durationMs: Date.now() - start, cancelled: true }
      }
      const res = await fetchWithReauth(`/api/platform-chat/poll?${qs}`, { cache: 'no-store' })
      if (res.status === 401) {
        const here = window.location.pathname + window.location.search
        window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
        throw new Error('session expired during poll')
      }
      const j = (await res.json()) as PollResponse
      if (!j.ok) throw new Error(j.error)
      if (j.status === 'done') {
        return {
          text:               (j.text ?? '').trim()
                                  || (j.crashed
                                       || (j.approval_requests?.length ?? 0) > 0
                                       || (j.tool_calls?.length ?? 0) > 0
                                       || (j.edit_plans?.length ?? 0) > 0
                                       ? ''
                                       : '(the gateway returned an empty assistant message — usually means the agent finished without writing a final reply)'),
          durationMs:           j.durationMs ?? (Date.now() - start),
          approval_requests:    j.approval_requests,
          tool_calls:           j.tool_calls,
          crashed:              j.crashed,
          edit_plans:           j.edit_plans,
          edit_group_completes: j.edit_group_completes,
          edit_selfs:           j.edit_selfs,
        }
      }
      if (j.status === 'error') {
        // Mid-stream crash — surface as a returned message with the
        // crashed metadata, NOT a thrown error. The agent may have
        // streamed partial text; the operator should still see it +
        // the CrashedTurnCard above explaining the discontinuity.
        return {
          text:                 (j.text ?? '').trim(),
          durationMs:           j.durationMs ?? (Date.now() - start),
          tool_calls:           j.tool_calls,
          crashed:              j.crashed ?? { exit_code: null, stderr_tail: null, raw: j.jobError ?? null },
          edit_plans:           j.edit_plans,
          edit_group_completes: j.edit_group_completes,
          edit_selfs:           j.edit_selfs,
        }
      }
      // status === 'pending' | 'running' — Phase 2a pushes the running
      // partial text into UI state so the chat shows progressive output.
      if (j.partialText) setPartial(j.partialText)
      // Surface any pending permission requests the broker MCP wrote
      // during this turn. The card renders above the partial bubble.
      setPendingPermissions(j.pending_permission_requests ?? [])
    }
    throw new Error(`timed out waiting for response (>${Math.round(POLL_TIMEOUT_MS / 60_000)} min). The agent may still be running on the gateway — check Coolify logs for the claude-gateway service.`)
  }

  /**
   * Stream `/api/platform-chat/stream` via SSE. Mirrors the parser in
   * `lib/claw/gateway-call.ts` L103-149: double-newline frame, eventName
   * / dataLine split, JSON.parse each `data:` line. Updates `partial` on
   * each `delta` event so the streaming bubble grows in real time.
   *
   * Returns a result with `continueWithPoll: true` whenever the stream
   * couldn't deliver a complete reply (Vercel maxDuration, recoverable
   * gateway error, network drop). Caller transparently falls back to
   * `pollUntilDone(jobId, sessionId)` using the same jobId — the gateway
   * job continues server-side regardless of what happens to the stream.
   */
  async function streamUntilDone(
    jobId: string,
    sessionId: string,
  ): Promise<StreamOrPollResult> {
    const start = Date.now()
    const qs = `jobId=${encodeURIComponent(jobId)}&sessionId=${encodeURIComponent(sessionId)}`
    const ac  = new AbortController()
    // Watcher: if the operator clicks Cancel mid-stream, abort the reader.
    // The gateway job continues server-side — same semantics as poll cancel.
    const cancelWatch = setInterval(() => { if (cancelRef.current) ac.abort() }, 200)
    // Outer timeout — purely defensive; the server's own maxDuration
    // guard emits `continue` long before this fires.
    const timeoutTimer = setTimeout(() => ac.abort(), STREAM_TIMEOUT_MS)

    let res: Response
    try {
      res = await fetchWithReauth(`/api/platform-chat/stream?${qs}`, {
        cache:   'no-store',
        headers: { 'Accept': 'text/event-stream' },
        signal:  ac.signal,
      })
    } catch {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
      if (cancelRef.current) return { text: '', durationMs: Date.now() - start, cancelled: true }
      // Network failure / abort before headers — fall back to poll.
      return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
    }

    if (res.status === 401) {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
      const here = window.location.pathname + window.location.search
      window.location.href = `/sign-in?returnUrl=${encodeURIComponent(here)}`
      throw new Error('session expired during stream')
    }
    if (!res.ok || !res.body) {
      // 503 streaming_disabled, 404 not_found, 400 invalid — fall back.
      // Logged at the call site so the operator sees the reason in console.
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
      console.warn(`[platform-chat] stream returned ${res.status} — falling back to poll`)
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
          // Skip comments (start with `:`) — used for keep-alive heartbeats.
          if (block.startsWith(':')) continue

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
            // Phase 3 — upsert this tool call into the inflight map. The
            // SSE bridge sends an event whenever a call starts (Wrench)
            // or finishes (CheckCircle), so the ToolCallCard render flips
            // state in place without us tracking it explicitly here.
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
              edit_selfs:           Array.isArray(parsed.edit_selfs)           ? parsed.edit_selfs           as EditSelfPlan[]       : undefined,
              crashed:              parsed.crashed as CrashedInfo | undefined,
            }
            // Surface any pending permission requests one final time —
            // matches the poll path's behaviour.
            const perms = Array.isArray(parsed.pending_permission_requests) ? parsed.pending_permission_requests as PermissionRequest[] : []
            setPendingPermissions(perms)
            break
          } else if (eventName === 'continue') {
            // Vercel function approaching maxDuration — fall back to poll.
            return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
          } else if (eventName === 'error') {
            // Typed code on the error event tells us whether the gateway
            // job is still alive (gateway_error / mid_stream → still
            // running → poll fallback) or whether the route refused
            // (streaming_disabled / not_found → poll fallback too — same
            // behaviour, but logged so operator sees why).
            const code = typeof parsed.code === 'string' ? parsed.code : 'gateway_error'
            const msg  = typeof parsed.message === 'string' ? parsed.message : 'stream error'
            console.warn(`[platform-chat] stream error code=${code} message=${msg} — falling back to poll`)
            return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
          }
        }
        if (final) break
      }
    } catch (err) {
      if (cancelRef.current) return { text: '', durationMs: Date.now() - start, cancelled: true }
      console.warn('[platform-chat] stream reader threw — falling back to poll:', err)
      return { text: '', durationMs: Date.now() - start, continueWithPoll: true }
    } finally {
      clearInterval(cancelWatch); clearTimeout(timeoutTimer)
    }

    return final ?? { text: '', durationMs: Date.now() - start, continueWithPoll: true }
  }

  // Permission-broker handlers — POST to the decide route which flips the
  // row's status. The broker MCP polling that row inside the gateway
  // returns the decision on its next tick (≤1s), and the gateway turn
  // resumes. The local pending list is optimistically pruned so the card
  // doesn't briefly re-appear before the next poll tick clears it.
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
        // 409 = already resolved (race). Anything else: nudge the list
        // back so the operator can retry. The card itself stays gone —
        // next poll tick refetches authoritative state.
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(`permission decide failed: ${body.error ?? res.status}`)
      }
    } catch (e) {
      setError(`permission decide network error: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex h-[calc(100vh-200px)] min-h-[500px]">
      {/* Phase 4 — session sidebar (left rail) */}
      <div className="hidden md:flex md:h-full">
        <MobileAwareSessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={sessionsLoading}
          onSelect={setActiveSessionId}
          onNew={handleNewChat}
          onDelete={handleDeleteSession}
          mobileOpen={false}
          onMobileClose={() => {}}
        />
      </div>
      {/* Mobile-only sidebar — drawer with hamburger reveal. */}
      <div className="md:hidden">
        <MobileAwareSessionSidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          loading={sessionsLoading}
          onSelect={setActiveSessionId}
          onNew={handleNewChat}
          onDelete={handleDeleteSession}
          mobileOpen={mobileSidebarOpen}
          onMobileClose={() => setMobileSidebarOpen(false)}
        />
      </div>

      {/* Chat column (right of sidebar) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header strip — explains scope + Views dropdown on the right */}
        <div className="px-4 py-3 border-b flex flex-col gap-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="flex items-center gap-3">
            {/* Phase 2C — hamburger to reveal session sidebar on mobile. */}
            <button
              onClick={() => setMobileSidebarOpen(true)}
              aria-label="Open chat sessions"
              title="Chat sessions"
              className="md:hidden shrink-0 p-2 min-h-[44px] min-w-[44px] rounded-lg flex items-center justify-center transition-colors"
              style={{ color: '#9090b0', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
            >
              <Menu size={16} />
            </button>
            <div className="flex items-center gap-2 text-sm flex-1 min-w-0">
              <Sparkles size={14} style={{ color: '#a8a3ff' }} className="shrink-0" />
              <span style={{ color: '#e8e8f0' }}>Platform copilot</span>
              <span className="hidden sm:inline" style={{ color: '#55556a' }}>—</span>
              <span className="hidden sm:inline truncate" style={{ color: '#9090b0' }}>
                scoped to Nexus itself, uses admin-scope connections (Vercel, GitHub, Slack, Stripe, …) via the hard-isolation MCP
              </span>
            </div>
            <ViewsDropdown
              scope="admin"
              activeView={activeView}
              onOpen={setActiveView}
              badges={{ tasks: tasksBadge, approvals: approvalsBadge, 'bug-hunt': bugHuntBadge }}
            />
          </div>
          {/* MCP awareness strip (audit 2026-05-16 §6.6) — shows what's
              powering this chat before the operator types. */}
          <McpStatusStrip scope="platform" />
        </div>

        {/* Message list */}
        <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
          {/* R9 — retrospective banner pinned at the top when the cron
              has summarised this session. Null on fresh sessions / when
              migration 092 isn't applied. */}
          <RetrospectiveBanner retrospective={retrospective} generatedAt={retrospectiveAt} />
          {messages.length === 0 && <EmptyState />}
          {messages.map((m, i) => {
            // APPROVAL replies are wire-format only — never render as a
            // user bubble. See isApprovalReply() for the rationale.
            if (m.role === 'user' && isApprovalReply(m.content)) return null
            return (
              <MessageBubble
                key={i}
                message={m}
                onApprove={handleApproval}
                onEditPlanReply={handleEditPlanReply}
                editPlanResolutions={editPlanResolutions}
                onEditSelfReply={handleEditSelfReply}
                editSelfResolutions={editSelfResolutions}
                approvalResolutions={approvalResolutions}
                busy={busy}
              />
            )
          })}
          {/* Permission-broker cards — surfaced while the turn is running
              and the broker has pending Allow/Deny requests. Rendered
              ABOVE the partial bubble so the operator sees them first. */}
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
          {/* Phase 2a + Phase 3 — tentative assistant bubble showing partial
              text + in-flight tool calls. Tool calls render ABOVE the text
              (Wrench → CheckCircle as each tool_result lands), mirroring
              the layout of the final MessageBubble below. Both clear when
              status='done' and the final bubble takes over. */}
          {busy && (partial || inflightToolCalls.length > 0) && (
            <div className="flex justify-start">
              <div
                className="max-w-[85%] rounded-2xl px-4 py-3 text-sm"
                style={{
                  background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                  border:     '1px dashed rgba(168,163,255,0.30)',
                  color:      '#c8c8d8',
                }}
              >
                <div className="text-[10px] uppercase tracking-[0.14em] mb-1" style={{ color: '#a8a3ff' }}>
                  Streaming
                </div>
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

      {/* Floating action bar — surfaces the most-recent pending Continue /
          Approve / Deny just above the input. Hides while a turn is
          running (busy=true) and reappears when the next action lands.
          The inline ApprovalCard / EditPlanCard buttons remain for
          fine-grained control (per-group / per-item selection). */}
      {pendingAction && !busy && (
        <FloatingActionBar
          action={pendingAction}
          onApproveAll={handleBarApproveAll}
          onContinue={handleBarContinue}
          onDeny={handleBarDeny}
        />
      )}

      {/* Input */}
      <div className="border-t p-4" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
        <div
          className="flex gap-2 rounded-xl p-3"
          style={{
            background:           'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
            border:               '1px solid rgba(255,255,255,0.10)',
            backdropFilter:       'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
          }}
        >
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={messages.length === 0 ? 'Ask the platform copilot anything — Enter to send, Shift+Enter for newline' : 'Reply… (Enter to send)'}
            rows={Math.min(8, Math.max(2, input.split('\n').length))}
            disabled={busy}
            className="flex-1 resize-none bg-transparent focus:outline-none text-sm font-mono"
            style={{ color: '#e8e8f0' }}
          />
          <button
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            // Tap-target ≥44px on mobile per Phase 2 of task_plan-mobile-copilot.md.
            // px-3.5 keeps the desktop weight; min-h-[44px] is the floor.
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
            {process.env.NEXT_PUBLIC_PLATFORM_CHAT_STREAM_ENABLED === '1'
              ? 'SSE streaming + persistent sessions + approval cards. Falls back to async poll if the stream drops.'
              : 'Async polling + persistent sessions + approval cards. SSE streaming is wired but disabled — flip NEXT_PUBLIC_PLATFORM_CHAT_STREAM_ENABLED=1 to enable.'}
          </span>
          {/* Spacer pushes the right-side chips to the edge on mobile too. */}
          <span className="flex-1 sm:hidden" />
          <TurnTimeoutSelector value={turnTimeoutMs} onChange={setTurnTimeoutMs} />
          <ModeSelector  value={chatMode}  onChange={setChatMode} />
          <ModelSelector value={chatModel} onChange={setChatModel} />
          {/* Bottom-right context-usage indicator — mirrors Claude Code Desktop. */}
          <ContextIndicator usage={usage} />
        </div>
      </div>
      </div>{/* close chat column */}

      {/* Phase 9 — Views side panel. Renders only when the operator picks a
          view from the dropdown. Resizable via left-edge handle (persisted
          per-view in localStorage). Drag below threshold or click X to close. */}
      {activeView === 'tasks' && (
        <ViewsPanel title="Manual to-dos" subtitle="Tasks the agent flagged for you (admin scope)" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:tasks">
          <TasksView scope="admin" onCountChange={setTasksBadge} />
        </ViewsPanel>
      )}
      {activeView === 'approvals' && (
        <ViewsPanel title="Approval queue" subtitle="Pending approval cards across every admin chat" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:approvals">
          <ApprovalsView scope="admin" sessionsBasePath="/manage-platform" onCountChange={setApprovalsBadge} />
        </ViewsPanel>
      )}
      {activeView === 'background-tasks' && (
        <ViewsPanel title="Background tasks" subtitle="Long-running work the agent delegated" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:background-tasks">
          <BackgroundTasksView scope="admin" />
        </ViewsPanel>
      )}
      {activeView === 'calendar' && (
        <ViewsPanel title="Calendar" subtitle="Upcoming due dates + scheduled runs" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:calendar">
          <CalendarView scope="admin" />
        </ViewsPanel>
      )}
      {activeView === 'notes' && (
        <ViewsPanel title="Notes" subtitle="Per-scope markdown scratchpad — autosaved" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:notes">
          <NotesView scope="admin" />
        </ViewsPanel>
      )}
      {activeView === 'bug-hunt' && (
        <ViewsPanel title="Bug hunt" subtitle="Operator-gated audit loop" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:bug-hunt">
          <BugHuntView
            onCountChange={setBugHuntBadge}
            onSendChatMessage={text => void send(text)}
          />
        </ViewsPanel>
      )}
      {activeView === 'health' && (
        <ViewsPanel title="Platform health" subtitle="Where is the platform leaking right now" onClose={() => setActiveView(null)} storageKey="nexus:views-panel:admin:health">
          <HealthView scope="admin" />
        </ViewsPanel>
      )}
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <div className="max-w-2xl mx-auto py-12 text-center space-y-4">
      <Sparkles size={32} style={{ color: '#a8a3ff' }} className="mx-auto" />
      <h2 className="text-lg font-semibold" style={{ color: '#e8e8f0' }}>What can I help with on the Nexus platform?</h2>
      <p className="text-sm" style={{ color: '#9090b0' }}>
        I have read access to your shared-scope connected accounts and can correlate logs across them.
        For execution-heavy debugging I can delegate to the codex gateway. I'll always propose a plan
        and ask for approval before making changes.
      </p>
      <pre
        className="text-xs text-left p-3 rounded-lg overflow-x-auto"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border:     '1px solid rgba(255,255,255,0.08)',
          color:      '#9090b0',
          fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        }}
      >
        Try:{'\n'}{PLACEHOLDER}
      </pre>
    </div>
  )
}

function ThinkingIndicator({ onCancel }: { onCancel?: () => void }) {
  // Tick an elapsed-seconds counter so the operator sees the chat hasn't
  // frozen during long agent runs (Opus + MCP tool calls easily hit 30-90s).
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <div className="flex items-center gap-2 text-sm" style={{ color: '#9090b0' }}>
      <Loader2 size={14} className="animate-spin" />
      <span>Claude is working — checking platforms, reading code, maybe delegating to codex… ({elapsed}s)</span>
      {onCancel && (
        <button
          onClick={onCancel}
          title="Cancel — stop polling. The gateway job continues server-side but its result is ignored."
          className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs"
          style={{
            background: 'rgba(239,68,68,0.10)',
            border:     '1px solid rgba(239,68,68,0.30)',
            color:      '#fca5a5',
          }}
        >
          <XIcon size={10} /> Cancel
        </button>
      )}
    </div>
  )
}

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      className="rounded-lg p-3 flex items-start gap-2"
      style={{ background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.30)', color: '#fca5a5' }}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
      <div className="flex-1 text-sm">
        <div className="font-semibold mb-1">Turn failed</div>
        <div className="font-mono text-xs whitespace-pre-wrap">{message}</div>
      </div>
      <button onClick={onDismiss} className="text-xs underline opacity-80 hover:opacity-100">Dismiss</button>
    </div>
  )
}

function MessageBubble({
  message, onApprove, onEditPlanReply, editPlanResolutions, onEditSelfReply, editSelfResolutions, approvalResolutions, busy,
}: {
  message:             Message
  onApprove:           (request: ApprovalRequest, approvedItemIds: string[]) => void
  onEditPlanReply:     (planId: string, mode: 'approve' | 'continue' | 'deny', approvedGroupIds?: string[]) => void
  editPlanResolutions: Map<string, EditPlanResolution>
  onEditSelfReply:     (planId: string, mode: 'approve' | 'deny', approvedItemIds?: string[]) => void
  editSelfResolutions: Map<string, EditSelfResolution>
  approvalResolutions: Map<string, import('@/lib/chat/approval-resolutions').ApprovalResolution>
  busy:                boolean
}) {
  const isUser = message.role === 'user'
  return (
    <div className={isUser ? 'flex justify-end' : 'flex justify-start'}>
      <div
        className={isUser ? 'max-w-[85%] rounded-2xl px-4 py-3 text-sm' : 'max-w-[85%] rounded-2xl px-4 py-3 text-sm'}
        style={{
          background: isUser
            ? 'linear-gradient(135deg, rgba(108,99,255,0.25), rgba(108,99,255,0.10))'
            : 'linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.02))',
          border: isUser ? '1px solid rgba(108,99,255,0.30)' : '1px solid rgba(255,255,255,0.08)',
          color:  '#e8e8f0',
        }}
      >
        {/* Mid-turn crash card — renders ABOVE the tool calls / prose so
            the operator sees the discontinuity warning first. Phrases like
            "writes are queued" in the message body get amber-highlighted
            below. */}
        {!isUser && message.crashed && (
          <CrashedTurnCard crashed={message.crashed} />
        )}
        {/* Phase 2b — tool-call cards. Rendered ABOVE the prose so the
            operator sees "what Claude did" before reading the synthesis.
            Each card collapses by default; click to expand input/output. */}
        {!isUser && message.tool_calls && message.tool_calls.length > 0 && (
          <div className="mb-2">
            {message.tool_calls.map(call => <ToolCallCard key={call.id} call={call} />)}
          </div>
        )}
        {message.content && <RenderedMarkdown text={message.content} highlightClaimed={!!message.crashed} />}
        {/* Phase D5 — a persisted dispatch error (the turn never reached the
            gateway). Survives reload via metadata.turn_error; the transient
            `error` banner below the list only covers the live session. */}
        {message.turn_error && (
          <div
            className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
            style={{ background: 'rgba(255,90,90,0.10)', border: '1px solid rgba(255,90,90,0.30)', color: '#ffb4b4' }}
          >
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>This turn didn’t reach the agent: {message.turn_error.message}</span>
          </div>
        )}
        {/* Phase 3 — render any approval-request blocks the agent emitted as
            inline cards. Each card carries its own approval_id; on click we
            auto-send the canonical APPROVAL [<id>]: ... reply. */}
        {!isUser && message.approval_requests?.map(req => (
          <ApprovalCard
            key={req.approval_id}
            request={req}
            resolution={approvalResolutions.get(req.approval_id) ?? message.approval_resolutions?.[req.approval_id] ?? null}
            disabled={busy}
            onSubmit={ids => onApprove(req, ids)}
          />
        ))}
        {/* Multi-turn edit-plan cards — render with the AGGREGATED resolution
            from the whole conversation so a plan emitted in turn 3 reflects
            approvals + completions from turns 4..N. */}
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
        {/* Self-modification proposals (Continual Harness pattern) — one-shot,
            no continue. Operator approves a subset of items; the agent's next
            turn materialises the approved items via the Edit tool as a draft PR. */}
        {!isUser && message.edit_selfs?.map(plan => (
          <EditSelfCard
            key={plan.plan_id}
            plan={plan}
            resolution={editSelfResolutions.get(plan.plan_id) ?? null}
            disabled={busy}
            onApprove={ids => onEditSelfReply(plan.plan_id, 'approve', ids)}
            onDeny={()      => onEditSelfReply(plan.plan_id, 'deny')}
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

/**
 * Very lightweight markdown render — preserves newlines, extracts fenced
 * code blocks for monospace styling. Avoids pulling a full markdown lib
 * in the MVP. Phase 2 swaps for react-markdown when tool-call cards land.
 */
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

/**
 * Wrap "claimed but unverified" phrases in amber <mark> spans when the
 * turn crashed. Title attribute makes the highlight self-explanatory on
 * hover. Falls back to plain text when no matches.
 */
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

// Keep imported for Phase 2 use — Tool call card dropdown / Codex delegation card
