/**
 * lib/teams/default-bindings.ts — pick the default ecosystem adapter per
 * (department, business-niche) pair when a team is first spawned.
 *
 * Operator can rebind any time via /teams. This registry only seeds the
 * initial value — it's never read again after the team's `ecosystem_bindings`
 * JSON column has been set.
 */

import type { EcosystemKind } from '@/lib/ecosystems/types'
import type { DepartmentSlug } from './departments'

/** Per-niche bindings; falls back to DEFAULT_BINDINGS when a niche isn't
 *  in the table. Adding a niche-specific override doesn't require code
 *  changes in any department or role spec. */
const NICHE_OVERRIDES: Record<string, Partial<Record<EcosystemKind, string>>> = {
  saas: {
    video:  'runway',     // crisper product-demo style
    design: 'open-design',
  },
  ecommerce: {
    video:  'higgsfield',
    image:  'muapi',      // photo-realistic product shots (no flux adapter yet → muapi)
  },
}

/** Platform-wide defaults — used when no niche override exists. */
const DEFAULT_BINDINGS: Record<EcosystemKind, string> = {
  llm:          'claude',
  // Explicit: code runs on the claude-gateway today (Open Code isn't GA). The
  // `open-code` binding stays registered for when Open Code GAs; until then
  // `claude-code` names the backend honestly instead of open-code's silent
  // gateway fallback. Rebind to `code-codex` for execution-heavy work.
  code:         'claude-code',
  design:       'open-design',
  video:        'higgsfield',
  image:        'muapi',
  voice:        'elevenlabs',
  music:        'suno',
  avatar:       'heygen',
  speech:       'whisper',
  memory:       'memory-hq',
  search:       'tavily',
  browser:      'playwright',
  workflow:     'n8n',
  'voice-agent':'pipecat',   // wired OSS voice-agent (no vapi adapter yet)
  'doc-parse':  'firecrawl', // the registered doc-parse adapter (no docling adapter yet)
}

/**
 * Build the initial ecosystem-binding map for a team. Only kinds the
 * department actually uses are included; the binding is sparse on purpose
 * so a future override doesn't accidentally bind unused kinds.
 */
export function defaultBindingsFor(
  dept:  DepartmentSlug,
  niche: string | null | undefined,
  kinds: readonly EcosystemKind[],
): Record<string, string> {
  const out: Record<string, string> = {}
  const overrides = niche ? NICHE_OVERRIDES[niche] ?? {} : {}
  for (const k of kinds) {
    out[k] = overrides[k] ?? DEFAULT_BINDINGS[k]
  }
  // Department-specific tweaks live here. Example: the engineering dept's
  // memory binding should always be memory-hq for now — GBrain is opt-in
  // at the operator level, not seeded by default.
  if (dept === 'engineering' && out.memory !== 'memory-hq') out.memory = 'memory-hq'
  return out
}
