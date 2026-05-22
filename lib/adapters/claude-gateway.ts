/**
 * claude_gateway adapter — wraps the self-hosted Claude Code gateway at
 * services/claude-gateway/. One container per business at the per-business
 * gateway pattern (lib/claw/business-client.ts `resolveClawConfig`).
 *
 * invoke: POST <gatewayUrl>/api/sessions/<sessionId>/messages with the brief.
 * status: GET  <gatewayUrl>/api/sessions/<sessionId>
 * cancel: POST <gatewayUrl>/api/sessions/<sessionId>/cancel
 *
 * NOT YET WIRED — no existing dispatch route imports this adapter. The
 * abstraction is in place for the operator-reviewed Phase 4e PR.
 *
 * See: lib/adapters/types.ts
 *      lib/claw/business-client.ts (gateway config resolution)
 *      services/claude-gateway/README.md
 */

import type { Adapter, InvokeContext, RunHandle, RunStatus } from './types'

function gatewayBase(): { url: string; token: string } | null {
  const url = process.env.CLAUDE_CODE_GATEWAY_URL?.trim()
  const token = process.env.CLAUDE_CODE_BEARER_TOKEN?.trim()
  if (!url || !token) return null
  return { url, token }
}

async function postSession(base: { url: string; token: string }, sessionId: string, body: unknown): Promise<Response> {
  return await fetch(`${base.url}/api/sessions/${sessionId}/messages`, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${base.token}`,
    },
    body:   JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
}

export const claudeGatewayAdapter: Adapter = {
  type: 'claude_gateway',

  async invoke(ctx: InvokeContext): Promise<RunHandle> {
    const base = gatewayBase()
    if (!base) {
      throw new Error('claude_gateway adapter: CLAUDE_CODE_GATEWAY_URL / CLAUDE_CODE_BEARER_TOKEN unset')
    }
    const sessionId = `${ctx.business_slug}-${ctx.agent_slug}-${Date.now()}`
    const brief = [ctx.ancestry_prompt ?? '', JSON.stringify(ctx.inputs ?? {})].filter(Boolean).join('\n\n')
    const res = await postSession(base, sessionId, { role: 'user', content: brief })
    if (!res.ok) {
      throw new Error(`claude_gateway invoke failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    return {
      adapter_type:   'claude_gateway',
      adapter_run_id: sessionId,
      business_slug:  ctx.business_slug,
      agent_slug:     ctx.agent_slug,
      started_at:     new Date().toISOString(),
    }
  },

  async status(handle: RunHandle): Promise<RunStatus> {
    const base = gatewayBase()
    if (!base) return { state: 'errored', detail: 'gateway unconfigured' }
    const res = await fetch(`${base.url}/api/sessions/${handle.adapter_run_id}`, {
      headers: { Authorization: `Bearer ${base.token}` },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { state: 'errored', detail: `${res.status}` }
    const body = (await res.json().catch(() => ({}))) as { state?: string; detail?: string; cost_usd?: number; completed_at?: string }
    return {
      state:        (body.state as RunStatus['state']) ?? 'running',
      detail:       body.detail ?? null,
      cost_usd:     body.cost_usd ?? null,
      completed_at: body.completed_at ?? null,
    }
  },

  async cancel(handle: RunHandle): Promise<void> {
    const base = gatewayBase()
    if (!base) return
    await fetch(`${base.url}/api/sessions/${handle.adapter_run_id}/cancel`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${base.token}` },
      signal:  AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  },
}
