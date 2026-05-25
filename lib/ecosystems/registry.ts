/**
 * lib/ecosystems/registry.ts — single resolver for ecosystem adapters.
 *
 * Departments + roles always call `getEcosystem(kind, name)` rather than
 * importing a concrete adapter directly. Lets us add a new ecosystem (e.g.
 * Veo for video, Cursor for code) by dropping a file in `adapters/` and
 * adding one row to ALL_ADAPTERS — zero changes to department code.
 */

import type { EcosystemAdapter, EcosystemKind } from './types'

import { higgsfieldAdapter } from './adapters/higgsfield'
import { openDesignAdapter } from './adapters/open-design'
import { openCodeAdapter   } from './adapters/open-code'
import { memoryHqAdapter   } from './adapters/memory-hq'
import { gbrainAdapter     } from './adapters/gbrain'
import { claudeLlmAdapter  } from './adapters/claude-llm'
import { tavilyAdapter     } from './adapters/tavily'
import { firecrawlAdapter  } from './adapters/firecrawl'
import { composioAdapter   } from './adapters/composio'

/**
 * Authoritative registry of every wired adapter in v1. Adding a new adapter:
 *   1. Write the file under `adapters/<name>.ts` implementing EcosystemAdapter.
 *   2. Import it here.
 *   3. Add it to this array.
 *   4. (Optional) update `lib/teams/default-bindings.ts` if it should be a
 *      default for any niche.
 */
const ALL_ADAPTERS: readonly EcosystemAdapter[] = [
  // v2 — real adapters wired through existing infra:
  claudeLlmAdapter,
  tavilyAdapter,
  firecrawlAdapter,
  composioAdapter,
  // v1 — stub adapters (verb routers; real wiring lands per team plans):
  higgsfieldAdapter,
  openDesignAdapter,
  openCodeAdapter,
  memoryHqAdapter,
  gbrainAdapter,
]

/** O(1) lookup keyed by `${kind}:${name}`. Built once on module load. */
const ADAPTER_INDEX: Map<string, EcosystemAdapter> = (() => {
  const m = new Map<string, EcosystemAdapter>()
  for (const a of ALL_ADAPTERS) m.set(`${a.kind}:${a.name}`, a)
  return m
})()

/** Resolve a bound adapter. Returns null when nothing matches; callers
 *  should treat null as "no provider configured" and surface a manual-task
 *  to the operator suggesting a rebind. */
export function getEcosystem(kind: EcosystemKind, name: string): EcosystemAdapter | null {
  return ADAPTER_INDEX.get(`${kind}:${name}`) ?? null
}

/** All adapters of a given kind — used by the /teams UI to populate the
 *  ecosystem-picker dropdown for a department. */
export function listEcosystemsByKind(kind: EcosystemKind): readonly EcosystemAdapter[] {
  return ALL_ADAPTERS.filter(a => a.kind === kind)
}

/** All adapters, full list. Used by the AGENTS.md doc-generator and
 *  /teams/status pages to show every option. */
export function listAllEcosystems(): readonly EcosystemAdapter[] {
  return ALL_ADAPTERS
}

/** Counts per-kind for the admin overview (e.g. "you have 1 video adapter
 *  wired, 0 image adapters"). */
export function countAvailableByKind(): Record<EcosystemKind, { wired: number; total: number }> {
  const buckets: Partial<Record<EcosystemKind, { wired: number; total: number }>> = {}
  for (const a of ALL_ADAPTERS) {
    const b = buckets[a.kind] ?? { wired: 0, total: 0 }
    b.total += 1
    if (a.available()) b.wired += 1
    buckets[a.kind] = b
  }
  return buckets as Record<EcosystemKind, { wired: number; total: number }>
}
