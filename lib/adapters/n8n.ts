/**
 * n8n adapter — fires an n8n workflow as a runtime. The workflow is the
 * agent's loop body (multi-node sequence with managed-agent sub-dispatches).
 *
 * invoke: POST <N8N_BASE_URL>/webhook/<workflow_webhook_id> with the brief
 * status: GET  <N8N_BASE_URL>/api/v1/executions/<execution_id>
 * cancel: POST <N8N_BASE_URL>/api/v1/executions/<execution_id>/stop
 *
 * inputs.workflow_webhook_id must be set on invoke. The strategist resolves
 * this from agent config when the adapter is wired in.
 *
 * NOT YET WIRED — same status as other adapters in this PR.
 */

import type { Adapter, InvokeContext, RunHandle, RunStatus } from './types'

function n8nBase(): { url: string; apiKey: string | null } | null {
  const url = process.env.N8N_BASE_URL?.trim()
  if (!url) return null
  return { url, apiKey: process.env.N8N_API_KEY?.trim() ?? null }
}

function webhookId(ctx: InvokeContext): string {
  const v = (ctx.inputs as { workflow_webhook_id?: unknown } | undefined)?.workflow_webhook_id
  if (typeof v !== 'string' || v.length === 0) {
    throw new Error('n8n adapter: inputs.workflow_webhook_id is required')
  }
  return v
}

export const n8nAdapter: Adapter = {
  type: 'n8n',

  async invoke(ctx: InvokeContext): Promise<RunHandle> {
    const base = n8nBase()
    if (!base) throw new Error('n8n adapter: N8N_BASE_URL unset')
    const id = webhookId(ctx)
    const res = await fetch(`${base.url}/webhook/${id}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_slug:   ctx.business_slug,
        agent_slug:      ctx.agent_slug,
        ancestry_prompt: ctx.ancestry_prompt ?? null,
        inputs:          ctx.inputs ?? {},
      }),
      signal: AbortSignal.timeout(15_000),
    })
    if (!res.ok) {
      throw new Error(`n8n invoke failed: ${res.status} ${await res.text().catch(() => '')}`)
    }
    // n8n webhook responses vary; commonly returns the execution id when
    // wait-mode is enabled. Fall back to a synthetic handle if absent.
    const body = (await res.json().catch(() => ({}))) as { executionId?: string | number; data?: unknown }
    const executionId = body.executionId !== undefined ? String(body.executionId) : `n8n-${Date.now()}`
    return {
      adapter_type:   'n8n',
      adapter_run_id: executionId,
      business_slug:  ctx.business_slug,
      agent_slug:     ctx.agent_slug,
      started_at:     new Date().toISOString(),
    }
  },

  async status(handle: RunHandle): Promise<RunStatus> {
    const base = n8nBase()
    if (!base) return { state: 'errored', detail: 'n8n unconfigured' }
    if (!base.apiKey) return { state: 'running', detail: 'N8N_API_KEY unset — cannot poll execution status' }
    const res = await fetch(`${base.url}/api/v1/executions/${handle.adapter_run_id}`, {
      headers: { 'X-N8N-API-KEY': base.apiKey },
      signal:  AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { state: 'errored', detail: `${res.status}` }
    const body = (await res.json().catch(() => ({}))) as {
      finished?: boolean
      stoppedAt?: string
      mode?:    string
      data?:    { resultData?: { error?: unknown } }
    }
    if (!body.finished) return { state: 'running' }
    const hasError = Boolean(body.data?.resultData?.error)
    return {
      state:        hasError ? 'errored' : 'completed',
      completed_at: body.stoppedAt ?? null,
    }
  },

  async cancel(handle: RunHandle): Promise<void> {
    const base = n8nBase()
    if (!base || !base.apiKey) return
    await fetch(`${base.url}/api/v1/executions/${handle.adapter_run_id}/stop`, {
      method:  'POST',
      headers: { 'X-N8N-API-KEY': base.apiKey },
      signal:  AbortSignal.timeout(10_000),
    }).catch(() => undefined)
  },
}
