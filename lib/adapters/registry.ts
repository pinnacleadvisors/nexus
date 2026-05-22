/**
 * Adapter registry — Paperclip absorption Task 4b.
 *
 * Adapters self-register at module init. The strategist resolves the adapter
 * for an agent's runtime type via `resolveAdapter(type)`, then calls invoke
 * with adapter-agnostic context.
 *
 * Important — this PR introduces the registry as ABSTRACTION ONLY. Existing
 * dispatch routes (/api/claude-session/dispatch, /api/n8n/dispatch, the
 * solopreneur-tick cron, Inngest functions) continue to call services
 * directly. The migration of those call sites to the registry is a separate
 * operator-reviewed PR per task_plan-paperclip-absorption.md Phase 4e.
 *
 * No-behavioural-change guarantee: nothing in this file is imported by any
 * existing dispatch route. New routes / new strategist code can opt in.
 *
 * See: lib/adapters/types.ts (interface)
 *      docs/research/paperclip-audit-2026-05.md §6
 */

import type { Adapter, AdapterType } from './types'

import { claudeGatewayAdapter }   from './claude-gateway'
import { codexGatewayAdapter }    from './codex-gateway'
import { coolifyBusinessAdapter } from './coolify-business'
import { n8nAdapter }             from './n8n'
import { inngestAdapter }         from './inngest'

const REGISTRY = new Map<AdapterType, Adapter>()

function register(adapter: Adapter) {
  REGISTRY.set(adapter.type, adapter)
}

// Self-register at module-init. Order does not matter — each adapter is
// independent.
register(claudeGatewayAdapter)
register(codexGatewayAdapter)
register(coolifyBusinessAdapter)
register(n8nAdapter)
register(inngestAdapter)

export function resolveAdapter(type: AdapterType): Adapter {
  const a = REGISTRY.get(type)
  if (!a) {
    const known = Array.from(REGISTRY.keys()).join(', ')
    throw new Error(`Unknown adapter type "${type}". Known: ${known}`)
  }
  return a
}

export function listAdapterTypes(): AdapterType[] {
  return Array.from(REGISTRY.keys())
}

/**
 * Test-only escape hatch — register a custom adapter (e.g. a mock) for unit
 * tests. Not exported from a barrel; callers must import the file directly.
 */
export function __registerAdapter(adapter: Adapter): void {
  register(adapter)
}
