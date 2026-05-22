/**
 * inngest adapter — fires an Inngest event as a runtime. The Inngest function
 * handler is the agent's loop body. Useful for async / fan-out work that
 * doesn't need synchronous status polling (e.g. nightly batch agents).
 *
 * invoke: inngest.send({ name, data })
 * status: limited — Inngest's REST API for run lookup isn't enabled by default
 *         in this org. Returns 'queued' on invoke + 'running' until the
 *         caller observes a downstream side effect (e.g. a Supabase row).
 *         Mark as 'errored' only on explicit feedback from the function.
 * cancel: NOT SUPPORTED — Inngest doesn't expose per-event cancellation. The
 *         function itself must check a "cancelled" flag in its first step.
 *
 * inputs.event_name must be set on invoke; rest of inputs becomes data.
 *
 * NOT YET WIRED — same status as other adapters in this PR.
 */

import type { Adapter, InvokeContext, RunHandle, RunStatus } from './types'
import { inngest } from '@/inngest/client'

function eventName(ctx: InvokeContext): string {
  const v = (ctx.inputs as { event_name?: unknown } | undefined)?.event_name
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('inngest adapter: inputs.event_name is required')
  }
  return v
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

  async status(): Promise<RunStatus> {
    // Inngest event-status lookup isn't enabled in this org. Caller infers
    // status from downstream side effects (Supabase rows, downstream events).
    return { state: 'running', detail: 'inngest does not expose per-event status; observe side effects' }
  },

  async cancel(): Promise<void> {
    // No-op. Inngest functions are not directly cancellable. Cooperative
    // cancellation only — function code checks a flag.
  },
}
