/**
 * lib/memory/event-client.ts
 *
 * Typed client for the universal memory write surface. Use this from any
 * in-process caller (managed agents, server components, cron jobs) so the
 * API contract stays single-source-of-truth at /api/memory/event/route.ts.
 *
 * For external callers (OpenClaw, n8n) prefer the raw HTTP shape.
 */

import type { Locator } from './locator'
import type { MemoryScope } from './scope'

export type MemoryEventType = 'atom' | 'entity' | 'moc' | 'source' | 'synthesis'
export type MemoryImportance = 'critical' | 'high' | 'normal' | 'low'

export interface MemoryEventPayload {
  title: string
  fact?: string
  body?: string
  links?: string[]
  sources?: string[]
  kind?: string
  importance?: MemoryImportance
}

export interface MemoryEventInput {
  type: MemoryEventType
  source: string                 // e.g. "claude-agent:nexus-architect"
  scope: MemoryScope
  payload: MemoryEventPayload
  locators?: Locator[]
  trace_id?: string
}

export interface MemoryEventResult {
  ok: true
  slug: string
  scopeId: string
  path: string
  html_url: string
  sha: string
  trace_id: string
}

export interface MemoryEventError {
  ok?: false
  error: string
}

const DEFAULT_BASE = process.env.MEMORY_EVENT_BASE_URL || ''

/**
 * Write a memory event. Auth: MEMORY_HQ_TOKEN bearer. Returns the
 * created/updated atom's URL + sha, or throws on a transport error.
 */
export async function writeMemoryEvent(
  input: MemoryEventInput,
  opts: { baseUrl?: string; token?: string } = {},
): Promise<MemoryEventResult> {
  const base = opts.baseUrl || DEFAULT_BASE
  const token = opts.token || process.env.MEMORY_HQ_TOKEN
  if (!token) throw new Error('MEMORY_HQ_TOKEN not in env (and no token override)')

  const url = `${base.replace(/\/$/, '')}/api/memory/event`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  })
  const json = (await res.json()) as MemoryEventResult | MemoryEventError
  if (!res.ok || (json as MemoryEventError).error) {
    throw new Error(`memory event failed (${res.status}): ${(json as MemoryEventError).error || 'unknown'}`)
  }
  return json as MemoryEventResult
}

/** Convenience: write an atom — the most common shape. */
export async function writeAtom(
  source: string,
  scope: MemoryScope,
  title: string,
  fact: string,
  extras: Partial<Pick<MemoryEventPayload, 'links' | 'sources' | 'kind' | 'importance'>> & {
    locators?: Locator[]
    trace_id?: string
  } = {},
): Promise<MemoryEventResult> {
  return writeMemoryEvent({
    type: 'atom',
    source,
    scope,
    payload: { title, fact, ...extras },
    locators: extras.locators,
    trace_id: extras.trace_id,
  })
}

/** Convenience: write an entity (person/company/concept). */
export async function writeEntity(
  source: string,
  scope: MemoryScope,
  type: string,
  name: string,
  description?: string,
  extras: { locators?: Locator[]; importance?: MemoryImportance; trace_id?: string } = {},
): Promise<MemoryEventResult> {
  return writeMemoryEvent({
    type: 'entity',
    source,
    scope,
    payload: { title: name, body: description, kind: type, importance: extras.importance },
    locators: extras.locators,
    trace_id: extras.trace_id,
  })
}
