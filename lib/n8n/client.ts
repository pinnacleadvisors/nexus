/**
 * lib/n8n/client.ts
 * Lightweight client for the n8n REST API.
 * Requires N8N_BASE_URL and N8N_API_KEY in environment.
 */

import type {
  N8nWorkflow,
  N8nWorkflowStatus,
  N8nExecutionResult,
} from './types'

/**
 * Normalise a user-supplied N8N_BASE_URL:
 *   - auto-prefix `https://` if no protocol is present (so a bare hostname like
 *     `srv1610898.hstgr.cloud` works)
 *   - strip trailing slash so `${baseUrl}/api/v1/...` composes cleanly
 *   - also strip a trailing `/api` or `/api/v1` the user may have pasted
 */
function normaliseBaseUrl(raw: string): string {
  let url = raw.trim()
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`
  url = url.replace(/\/+$/, '')
  url = url.replace(/\/api\/v1$/i, '').replace(/\/api$/i, '')
  return url
}

function getConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.N8N_BASE_URL
  const apiKey  = process.env.N8N_API_KEY
  if (!baseUrl || !apiKey) return null
  return { baseUrl: normaliseBaseUrl(baseUrl), apiKey }
}

async function n8nFetch<T>(
  path:    string,
  options: RequestInit = {},
): Promise<T> {
  const cfg = getConfig()
  if (!cfg) throw new Error('N8N_BASE_URL and N8N_API_KEY must be configured in Doppler')

  const url = `${cfg.baseUrl}/api/v1${path}`
  let res: Response
  try {
    res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'X-N8N-API-KEY': cfg.apiKey,
        ...options.headers,
      },
    })
  } catch (err) {
    // Network-level failure (DNS, TLS, invalid URL, unreachable host). Surface
    // the target URL so the operator can tell from the error whether
    // N8N_BASE_URL is wrong (e.g. missing port, wrong protocol, typo).
    const reason = err instanceof Error ? err.message : String(err)
    throw new Error(`n8n unreachable at ${cfg.baseUrl} — ${reason}`)
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`n8n API error ${res.status} at ${url}${body ? `: ${body.slice(0, 300)}` : ''}`)
  }

  return res.json() as Promise<T>
}

// ── Workflow CRUD ─────────────────────────────────────────────────────────────
export async function listWorkflows(): Promise<N8nWorkflowStatus[]> {
  const data = await n8nFetch<{ data: N8nWorkflowStatus[] }>('/workflows')
  return data.data ?? []
}

export async function getWorkflow(id: string): Promise<N8nWorkflow> {
  return n8nFetch<N8nWorkflow>(`/workflows/${id}`)
}

export async function createWorkflow(workflow: N8nWorkflow): Promise<N8nWorkflow> {
  return n8nFetch<N8nWorkflow>('/workflows', {
    method: 'POST',
    body:   JSON.stringify(workflow),
  })
}

export async function activateWorkflow(id: string): Promise<void> {
  await n8nFetch(`/workflows/${id}/activate`, { method: 'POST' })
}

export async function deactivateWorkflow(id: string): Promise<void> {
  await n8nFetch(`/workflows/${id}/deactivate`, { method: 'POST' })
}

export async function deleteWorkflow(id: string): Promise<void> {
  await n8nFetch(`/workflows/${id}`, { method: 'DELETE' })
}

// ── Executions ────────────────────────────────────────────────────────────────
export async function listExecutions(
  workflowId?: string,
  limit        = 10,
): Promise<N8nExecutionResult[]> {
  const qs = new URLSearchParams({ limit: String(limit) })
  if (workflowId) qs.set('workflowId', workflowId)
  const data = await n8nFetch<{ data: N8nExecutionResult[] }>(`/executions?${qs}`)
  return data.data ?? []
}

export async function getExecution(id: string): Promise<N8nExecutionResult> {
  return n8nFetch<N8nExecutionResult>(`/executions/${id}`)
}

// ── Health ────────────────────────────────────────────────────────────────────
export async function checkHealth(): Promise<boolean> {
  try {
    await n8nFetch('/workflows?limit=1')
    return true
  } catch {
    return false
  }
}

export function isConfigured(): boolean {
  return !!getConfig()
}

export function getBaseUrl(): string | undefined {
  const raw = process.env.N8N_BASE_URL
  return raw ? normaliseBaseUrl(raw) : undefined
}
