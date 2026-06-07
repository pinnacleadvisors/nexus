/**
 * inngest adapter — fires an Inngest event as a runtime. The Inngest function
 * handler is the agent's loop body. Useful for async / fan-out work that
 * doesn't need synchronous status polling (e.g. nightly batch agents).
 *
 * invoke: inngest.send({ name, data }) — stores the returned event id as the
 *         handle's adapter_run_id.
 * status: when INNGEST_SIGNING_KEY (or INNGEST_API_KEY) is set, polls the
 *         Inngest Cloud REST API `GET /v1/events/{eventId}/runs` and maps the
 *         run status. When unset, degrades to the legacy best-effort 'running'
 *         (caller infers completion from downstream side effects). No regression.
 * cancel: cooperative. Inngest Cloud exposes no stable PER-RUN cancel from an
 *         event id alone (the bulk Cancellation API needs a function_id we do
 *         not track in the handle). We look up the run id (for observability)
 *         but the authoritative stop is the function checking a cancelled flag
 *         in its first step. Documented honestly rather than faked.
 *
 * inputs.event_name must be set on invoke; rest of inputs becomes data.
 *
 * Env (all optional — adapter degrades gracefully):
 *   INNGEST_SIGNING_KEY / INNGEST_API_KEY — Bearer auth for the REST API
 *   INNGEST_API_BASE                      — default https://api.inngest.com
 */

import type { Adapter, AgentState, InvokeContext, RunHandle, RunStatus } from './types'
import { inngest } from '@/inngest/client'

function eventName(ctx: InvokeContext): string {
  const v = (ctx.inputs as { event_name?: unknown } | undefined)?.event_name
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('inngest adapter: inputs.event_name is required')
  }
  return v
}

/** REST API config — null when no signing key is set (adapter degrades). */
function inngestApi(): { base: string; key: string } | null {
  const key = process.env.INNGEST_SIGNING_KEY?.trim() || process.env.INNGEST_API_KEY?.trim()
  if (!key) return null
  return { base: process.env.INNGEST_API_BASE?.trim() || 'https://api.inngest.com', key }
}

/** Map Inngest's run status string → our AgentState. */
function mapRunStatus(s: string | undefined): AgentState {
  switch ((s ?? '').toUpperCase()) {
    case 'COMPLETED': return 'completed'
    case 'FAILED':    return 'errored'
    case 'CANCELLED': return 'cancelled'
    case 'RUNNING':   return 'running'
    case 'QUEUED':    return 'queued'
    default:          return 'running'
  }
}

export const inngestAdapter: Adapter = {
  type: 'inngest',

  async invoke(ctx: InvokeContext): Promise<RunHandle> {
    const name = eventName(ctx)
    const inputsWithoutMeta = { ...(ctx.inputs ?? {}) } as Record<string, unknown>
    delete inputsWithoutMeta.event_name

    const result = (await (inngest as unknown as {
      send: (e: { name: string; data: Record<string, unknown> }) => Promise<{ ids?: string[] }>
    }).send({
      name,
      data: {
        business_slug:   ctx.business_slug,
        agent_slug:      ctx.agent_slug,
        ancestry_prompt: ctx.ancestry_prompt ?? null,
        ...inputsWithoutMeta,
      },
    }))

    const eventId = result?.ids?.[0] ?? `inngest-${Date.now()}`
    return {
      adapter_type:   'inngest',
      adapter_run_id: eventId,
      business_slug:  ctx.business_slug,
      agent_slug:     ctx.agent_slug,
      started_at:     new Date().toISOString(),
    }
  },

  async status(handle: RunHandle): Promise<RunStatus> {
    const api = inngestApi()
    // Degrade to the legacy behaviour when no signing key is configured — the
    // caller infers completion from downstream side effects. No regression.
    if (!api) {
      return { state: 'running', detail: 'INNGEST_SIGNING_KEY unset — observe side effects for completion' }
    }
    // Synthetic handles (event id absent at invoke) can't be polled.
    if (handle.adapter_run_id.startsWith('inngest-')) {
      return { state: 'running', detail: 'no event id captured at invoke; cannot poll' }
    }
    try {
      const res = await fetch(`${api.base}/v1/events/${encodeURIComponent(handle.adapter_run_id)}/runs`, {
        headers: { authorization: `Bearer ${api.key}` },
        signal:  AbortSignal.timeout(10_000),
      })
      if (!res.ok) return { state: 'running', detail: `inngest runs lookup → ${res.status}` }
      const body = (await res.json().catch(() => ({}))) as {
        data?: Array<{ status?: string; ended_at?: string | null; run_id?: string }>
      }
      const runs = body.data ?? []
      if (runs.length === 0) return { state: 'queued', detail: 'no runs yet for this event' }
      // An event can fan out to multiple functions; surface the worst state
      // (errored > running > completed) so a caller doesn't declare done early.
      const states = runs.map(r => mapRunStatus(r.status))
      const worst: AgentState =
        states.includes('errored')   ? 'errored'   :
        states.includes('cancelled') ? 'cancelled' :
        states.includes('running')   ? 'running'   :
        states.includes('queued')    ? 'queued'    : 'completed'
      const ended = runs.map(r => r.ended_at).filter(Boolean).sort().pop() ?? null
      return {
        state:        worst,
        completed_at: (worst === 'completed' || worst === 'errored' || worst === 'cancelled') ? ended : null,
        detail:       `${runs.length} run(s)`,
      }
    } catch (e) {
      // Observability call must never throw into the caller's loop.
      return { state: 'running', detail: e instanceof Error ? e.message : 'inngest status lookup failed' }
    }
  },

  async cancel(handle: RunHandle): Promise<void> {
    // Inngest Cloud has no stable per-run cancel reachable from an event id
    // alone (the bulk Cancellation API requires app_id + function_id, which
    // this handle doesn't carry). Cancellation is therefore COOPERATIVE: the
    // function checks a cancelled flag in its first step. We log the run id
    // for observability when the REST API is configured, but do not fabricate
    // a stop call that the upstream contract doesn't support.
    const api = inngestApi()
    if (!api || handle.adapter_run_id.startsWith('inngest-')) return
    try {
      const res = await fetch(`${api.base}/v1/events/${encodeURIComponent(handle.adapter_run_id)}/runs`, {
        headers: { authorization: `Bearer ${api.key}` },
        signal:  AbortSignal.timeout(10_000),
      })
      if (res.ok) {
        const body = (await res.json().catch(() => ({}))) as { data?: Array<{ run_id?: string }> }
        const ids = (body.data ?? []).map(r => r.run_id).filter(Boolean)
        if (ids.length) console.warn(`[inngest] cancel requested for event ${handle.adapter_run_id}; cooperative-only. runs=${ids.join(',')}`)
      }
    } catch {
      // Best-effort observability only.
    }
  },
}
