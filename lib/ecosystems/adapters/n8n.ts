/**
 * lib/ecosystems/adapters/n8n.ts — `workflow` adapter for n8n.
 *
 * The capability-plane counterpart to the Paperclip-plane runtime adapter at
 * lib/adapters/n8n.ts (which runs a whole workflow AS an agent loop). This one
 * exposes the registry verb `run_workflow` (fire an n8n webhook) + a status
 * poll, so a department bound to `workflow:n8n` resolves to a real adapter
 * instead of returning null. Distinct from `workflow:composio` (run ONE
 * connected action) — n8n runs a multi-step workflow.
 *
 * Reuses the same env as lib/adapters/n8n.ts:
 *   N8N_BASE_URL — instance base (required to be "available")
 *   N8N_API_KEY  — X-N8N-API-KEY for execution-status polling (optional)
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['run_workflow', 'get_workflow_status'] as const
type Verb = (typeof VERBS)[number]

interface RunWorkflowPayload {
  workflow_webhook_id: string
  inputs?:             Record<string, unknown>
}

interface GetWorkflowStatusPayload {
  execution_id: string
}

function envBase(): string | undefined { return process.env.N8N_BASE_URL?.trim() }
function envKey():  string | undefined { return process.env.N8N_API_KEY?.trim() }

export const n8nEcosystemAdapter: EcosystemAdapter = {
  kind:         'workflow',
  name:         'n8n',
  label:        'n8n (visual workflow runner)',
  capabilities: VERBS,
  available:    () => Boolean(envBase()),
  invoke:       invokeN8n,
}

async function invokeN8n(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!n8nEcosystemAdapter.available()) {
    return unavailable('n8n', verb, 'Set N8N_BASE_URL to enable workflow runs.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('n8n', verb, VERBS)
  const base = envBase()!

  try {
    if (verb === 'run_workflow') {
      const p = (payload ?? {}) as RunWorkflowPayload
      if (!p.workflow_webhook_id) {
        return { ok: false, adapter: 'n8n', verb, error: 'upstream_error', message: 'run_workflow requires `workflow_webhook_id`' }
      }
      const t0 = Date.now()
      const res = await fetch(`${base}/webhook/${encodeURIComponent(p.workflow_webhook_id)}`, {
        method:  'POST',
        headers: { 'content-type': 'application/json' },
        body:    JSON.stringify({ inputs: p.inputs ?? {} }),
        signal:  AbortSignal.timeout(15_000),
      })
      const latency = Date.now() - t0
      if (!res.ok) return httpError(verb, res.status, latency)
      const body = (await res.json().catch(() => ({}))) as { executionId?: string | number }
      return {
        ok: true, adapter: 'n8n', verb,
        result: { execution_id: body.executionId !== undefined ? String(body.executionId) : null, status: 'submitted' },
        telemetry: { latency_ms: latency },
      }
    }

    const p = (payload ?? {}) as GetWorkflowStatusPayload
    if (!p.execution_id) {
      return { ok: false, adapter: 'n8n', verb, error: 'upstream_error', message: 'get_workflow_status requires `execution_id`' }
    }
    if (!envKey()) {
      return { ok: true, adapter: 'n8n', verb, result: { status: 'unknown', detail: 'N8N_API_KEY unset — cannot poll' } }
    }
    const t0 = Date.now()
    const res = await fetch(`${base}/api/v1/executions/${encodeURIComponent(p.execution_id)}`, {
      headers: { 'X-N8N-API-KEY': envKey()! },
      signal:  AbortSignal.timeout(10_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) return httpError(verb, res.status, latency)
    const body = (await res.json().catch(() => ({}))) as { finished?: boolean; data?: { resultData?: { error?: unknown } } }
    const status = !body.finished ? 'running' : body.data?.resultData?.error ? 'errored' : 'completed'
    return { ok: true, adapter: 'n8n', verb, result: { status }, telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'n8n', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'n8n call failed' }
  }
}

function httpError(verb: string, status: number, latency: number): EcosystemResult {
  return {
    ok: false, adapter: 'n8n', verb,
    error: status === 429 ? 'rate_limited' : 'upstream_error',
    message: `n8n ${verb} → ${status}`,
    telemetry: { http_status: status, latency_ms: latency },
  }
}
