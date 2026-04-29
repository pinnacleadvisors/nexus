/**
 * lib/memory/scope.ts
 *
 * Canonicalises {repo, business_slug, namespace} into a deterministic
 * scope-id used by the memory-hq storage path layout:
 *
 *   <kind>/<scope-id>/<slug>.md
 *
 * scope-id = first 8 chars of sha1(canonicalJSON) + "-" + humanSuffix
 *
 * Why both: the hash guarantees uniqueness across logically distinct scopes
 * even when the human-readable part collides; the suffix keeps the path
 * browsable on GitHub. Two writers using identical scope inputs always
 * produce the same scope-id (deterministic).
 */
import { createHash } from 'node:crypto'

export interface MemoryScope {
  repo?: string            // GitHub "owner/name", e.g. "pinnacleadvisors/nexus"
  business_slug?: string   // e.g. "acme-coffee" — for multi-business setups
  namespace?: string       // optional logical grouping (e.g. "integration", "research")
}

export interface CanonicalScope extends MemoryScope {
  id: string  // <8-char sha prefix>-<human suffix>
}

const SAFE_RE = /[^a-z0-9-]/g
const COLLAPSE_RE = /-+/g

function humanSuffix(scope: MemoryScope): string {
  const raw =
    scope.business_slug ||
    (scope.repo ? scope.repo.split('/').pop() : null) ||
    'unknown'
  return raw.toLowerCase().replace(SAFE_RE, '-').replace(COLLAPSE_RE, '-').replace(/^-|-$/g, '')
}

export function canonicalScope(input: MemoryScope): CanonicalScope {
  const repo = input.repo?.trim() || undefined
  const business_slug = input.business_slug?.trim() || undefined
  const namespace = input.namespace?.trim() || undefined
  if (!repo && !business_slug) {
    throw new Error('scope must include at least one of {repo, business_slug}')
  }
  // Sort keys for deterministic JSON regardless of input ordering.
  const canonical = { business_slug, namespace, repo }
  const json = JSON.stringify(canonical)
  const hash = createHash('sha1').update(json).digest('hex').slice(0, 8)
  const id = `${hash}-${humanSuffix({ repo, business_slug })}`
  return { repo, business_slug, namespace, id }
}

/**
 * Parse the --scope CLI flag value. Accepts either JSON or shorthand
 * "repo:owner/name,business:slug,namespace:foo".
 */
export function parseScopeFlag(value: string | undefined): MemoryScope | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (trimmed.startsWith('{')) {
    return JSON.parse(trimmed) as MemoryScope
  }
  const out: MemoryScope = {}
  for (const part of trimmed.split(',')) {
    const idx = part.indexOf(':')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (!v) continue
    if (k === 'repo') out.repo = v
    else if (k === 'business' || k === 'business_slug') out.business_slug = v
    else if (k === 'namespace' || k === 'ns') out.namespace = v
  }
  return out
}

export function scopeIdFor(input: MemoryScope): string {
  return canonicalScope(input).id
}

/**
 * Storage path for a memory item. Used by both the github-backend and
 * Supabase mirror so paths/keys are identical across stores.
 */
export function pathFor(
  kind: 'atoms' | 'entities' | 'mocs' | 'sources' | 'synthesis' | 'log' | 'digest',
  scope: MemoryScope,
  slug: string,
): string {
  const scopeId = scopeIdFor(scope)
  return `${kind}/${scopeId}/${slug}.md`
}
