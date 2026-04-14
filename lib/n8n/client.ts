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

function getConfig(): { baseUrl: string; apiKey: string } | null {
  const baseUrl = process.env.N8N_BASE_URL
  const apiKey  = process.env.N8N_API_KEY
  if (!baseUrl || !apiKey) return null
  return { baseUrl: baseUrl.replace(/\/$/, ''), apiKey }
}

async function n8nFetch<T>(
  path:    string,
  options: RequestInit = {},
): Promise<T> {
  const cfg = getConfig()
  if (!cfg) throw new Error('N8N_BASE_URL and N8N_API_KEY must be configured in Doppler')

  const res = await fetch(`${cfg.baseUrl}/api/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': cfg.apiKey,
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`n8n API error ${res.status}: ${body}`)
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
  return process.env.N8N_BASE_URL
}
