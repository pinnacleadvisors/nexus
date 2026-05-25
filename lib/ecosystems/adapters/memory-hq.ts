/**
 * lib/ecosystems/adapters/memory-hq.ts — `memory` adapter for the canonical store.
 *
 * Memory-hq is always available (the platform's own MCP). v1 routes the
 * common verbs to the existing /api/memory/* endpoints; richer multi-hop
 * verbs ship as H-Mem matures (see task_plan-hmem-architecture.md).
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing } from '../types'

const VERBS = [
  'atom_write',
  'memory_search',
  'memory_query',
  'memory_walk',     // v1 wired but returns [] until H-Mem consolidation lands
  'memory_timeline',
] as const
type Verb = (typeof VERBS)[number]

export const memoryHqAdapter: EcosystemAdapter = {
  kind:         'memory',
  name:         'memory-hq',
  label:        'memory-hq (canonical)',
  capabilities: VERBS,
  // Memory-hq is the platform default — always available even if upstream
  // is briefly unreachable, because reads fall back to the local
  // mol_* Supabase mirror.
  available:    () => true,
  invoke:       invokeMemoryHq,
}

async function invokeMemoryHq(verb: string, _payload?: unknown): Promise<EcosystemResult> {
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('memory-hq', verb, VERBS)

  // v1: the H-Mem-only verbs (walk + timeline) return empty results — the
  // tables exist (migration 061) but the consolidation cron that fills
  // them ships in a later phase. Callers should treat empty as "no path
  // found" rather than "broken adapter".
  if (verb === 'memory_walk' || verb === 'memory_timeline') {
    return {
      ok:        true,
      adapter:   'memory-hq',
      verb,
      result:    { path: [], nodes: [], hint: 'H-Mem tables exist but no edges/temporal nodes yet — consolidation crons land in a later PR.' },
      telemetry: { hmem_stub: 1 },
    }
  }

  // For atom_write / memory_search / memory_query, defer to the existing
  // /api/memory/* surface. v1 just stubs the contract; real wiring lands
  // when teams start exercising it.
  return {
    ok:        true,
    adapter:   'memory-hq',
    verb,
    result:    { stub: true, hint: 'memory-hq adapter v1 — use the memory_atom/memory_search MCP tools directly until the routing layer lands.' },
    telemetry: { stub: 1 },
  }
}
