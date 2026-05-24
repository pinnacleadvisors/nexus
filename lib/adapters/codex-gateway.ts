/**
 * codex_gateway adapter — wraps the Codex CLI sandbox gateway at
 * services/codex-gateway/. Single shared gateway on KVM4 (migrated from
 * KVM2 on 2026-05-22 per ADR 006 lean-mode pivot) with a sandbox Doppler  // topology-check: ignore
 * config that excludes financial / secret-management secrets, per ADR-002
 * (docs/adr/002-codex-gateway-sandbox.md).
 *
 * invoke: POST <gatewayUrl>/dispatch with { agent_slug, brief, env }
 * status: GET  <gatewayUrl>/runs/<runId>
 * cancel: POST <gatewayUrl>/runs/<runId>/cancel
 *
 * Use codex_gateway when the task is execution-heavy (debugging, container
 * setup, sysadmin, fresh-state research, deploy scripts) rather than
 * design-heavy.
 *
 * NOT YET WIRED — same status as claude_gateway adapter.
 */

import type { Adapter, InvokeContext, RunHandle, RunStatus } from './types'

function gatewayBase(): { url: string; token: string } | null {
  const url   = process.env.CODEX_GATEWAY_URL?.trim()
  const token = process.env.CODEX_GATEWAY_BEARER_TOKEN?.trim()
  if (!url || !token) return null
  return { url, token }
}

export const codexGatewayAdapter: Adapter = {
  type: 'codex_gateway',

  async invoke(ctx: InvokeContext): Promise<RunHandle> {
    const base = gatewayBase()
    if (!base) {
      throw new Error('codex_gateway adapter: CODEX_GATEWAY_URL / CODEX_GATEWAY_BEARER_TOKEN unset')
    }
    const brief = [ctx.ancestry_prompt ?? '', JSON.stringify(ctx.inputs ?? {})].filter(Boolean).join('\n\n')
    const res = await fetch(`${base.url}/dispatch`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${base.token}`,
      },
      body: JSON.stringify({
        agent_slug:    ctx.agent_slug,
        brief,
        business_slug: ctx.business_slug,
        inputs:        ctx.inputs ?? {},
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(`codex_gateway invoke failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    const body = (await res.json().catch(() => ({}))) as { run_id?: string }
    const runId = body.run_id ?? `codex-${Date.now()}`
    return {
      adapter_type:   'codex_gateway',
      adapter_run_id: runId,
      business_slug:  ctx.business_slug,
      agent_slug:     ctx.agent_slug,
      started_at:     new Date().toISOString(),
    }
  },

  async status(handle: RunHandle): Promise<RunStatus> {
    const base = gatewayBase()
    if (!base) return { state: 'errored', detail: 'gateway unconfigured' }
    const res = await fetch(`${base.url}/runs/${handle.adapter_run_id}`, {
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
    await fetch(`${base.url}/runs/${handle.adapter_run_id}/cancel`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${base.token}` },
      signal:  AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  },
}
