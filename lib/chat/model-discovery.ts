/**
 * Auto-discovery of newly-released Claude models for the chat dropdown.
 *
 * The operator asked for new models (e.g. Opus 4.8) to surface "automatically
 * on release" without a code edit. AVAILABLE_MODELS (lib/chat/models.ts) is the
 * always-present, curated baseline (and pins the DEFAULT); this module merges
 * any NEWER claude-* model the Anthropic models API reports on top of it.
 *
 * Degrades gracefully: no ANTHROPIC_API_KEY (the platform runs on OAuth, so the
 * key may be unset) or any fetch error → returns the static list unchanged. The
 * gateway accepts any claude id / alias via `--model`, so a discovered id is
 * directly usable. We only auto-add the Anthropic family (never a provider the
 * chat surface can't dispatch).
 *
 * The DEFAULT is NOT auto-changed to a discovered model — surfacing it in the
 * list is safe; silently defaulting to an unvetted release is not.
 */
import { AVAILABLE_MODELS, type ChatModel } from './models'

const DATE_SUFFIX = /-\d{8}$/

/** Strip a trailing `-YYYYMMDD` so a dated API id matches the canonical short id. */
export function normalizeClaudeId(id: string): string {
  return id.replace(DATE_SUFFIX, '')
}

/** 'claude-opus-4-8' → 'Opus 4.8'. Falls back to the raw id if unrecognised. */
export function labelForClaudeId(id: string): string {
  const v = parseClaudeVersion(id)
  if (!v) return id
  return `${v.family[0].toUpperCase()}${v.family.slice(1)} ${v.major}.${v.minor}`
}

export interface ClaudeVersion { family: 'opus' | 'sonnet' | 'haiku'; major: number; minor: number }

// Requires a full family-major-minor (anchored after date-strip). This is what
// rejects outdated/unusable ids the Anthropic /v1/models API returns for a key —
// e.g. `claude-sonnet-4` (no minor) and `claude-3-5-sonnet` (wrong shape) both
// fail to parse, so they can never reach the dropdown.
const VERSION_RE = /^claude-(opus|sonnet|haiku)-(\d+)-(\d+)$/

export function parseClaudeVersion(id: string): ClaudeVersion | null {
  const m = VERSION_RE.exec(normalizeClaudeId(id))
  if (!m) return null
  return { family: m[1] as ClaudeVersion['family'], major: Number(m[2]), minor: Number(m[3]) }
}

/** Highest (major, minor) per family present in the curated static list. */
function staticFamilyMax(staticModels: readonly ChatModel[]): Map<string, [number, number]> {
  const max = new Map<string, [number, number]>()
  for (const sm of staticModels) {
    const v = parseClaudeVersion(sm.id)
    if (!v) continue
    const cur = max.get(v.family)
    if (!cur || v.major > cur[0] || (v.major === cur[0] && v.minor > cur[1])) max.set(v.family, [v.major, v.minor])
  }
  return max
}

/** Strictly newer than the family's curated baseline. Unknown family → false
 *  (a brand-new family is curated into the static list, never auto-trusted). */
function isStrictlyNewer(v: ClaudeVersion, famMax: Map<string, [number, number]>): boolean {
  const cur = famMax.get(v.family)
  if (!cur) return false
  return v.major > cur[0] || (v.major === cur[0] && v.minor > cur[1])
}

/**
 * Merge discovered Claude model ids into the static whitelist. Static entries
 * keep their curated labels/hints + order (and the first entry stays the
 * default); genuinely-new claude-* ids are appended after the static Claude
 * block (before codex) with a derived label. Pure — unit-tested.
 */
export function mergeDiscoveredModels(staticModels: readonly ChatModel[], discoveredIds: string[]): ChatModel[] {
  const known  = new Set(staticModels.map(m => normalizeClaudeId(m.id)))
  const famMax = staticFamilyMax(staticModels)
  const additions: ChatModel[] = []
  for (const raw of discoveredIds) {
    const v = parseClaudeVersion(raw)
    if (!v) continue                          // no parseable family-major-minor (rejects claude-sonnet-4, claude-3-5-*)
    if (!isStrictlyNewer(v, famMax)) continue // ONLY surface models newer than the curated baseline — never outdated/unusable ones
    const id = normalizeClaudeId(raw)
    if (known.has(id)) continue
    known.add(id)
    const label = labelForClaudeId(id)
    additions.push({ id, label, hint: `Anthropic ${label} — newer than the bundled list; auto-discovered from the Anthropic models API.`, provider: 'claude' })
  }
  if (additions.length === 0) return [...staticModels]

  const result: ChatModel[] = []
  let inserted = false
  for (let i = 0; i < staticModels.length; i++) {
    result.push(staticModels[i])
    const next = staticModels[i + 1]
    if (!inserted && staticModels[i].provider === 'claude' && (!next || next.provider !== 'claude')) {
      result.push(...additions)
      inserted = true
    }
  }
  if (!inserted) result.push(...additions)
  return result
}

/** Fetch claude-* model ids from the Anthropic models API. Graceful: [] on no
 *  key / non-200 / network error / timeout. */
export async function fetchAnthropicClaudeModels(opts?: { apiKey?: string; signal?: AbortSignal }): Promise<string[]> {
  const apiKey = opts?.apiKey ?? process.env.ANTHROPIC_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal:  opts?.signal ?? AbortSignal.timeout(8_000),
    })
    if (!res.ok) return []
    const json = await res.json() as { data?: Array<{ id?: string }> }
    return (json.data ?? [])
      .map(d => d.id)
      .filter((x): x is string => typeof x === 'string' && x.startsWith('claude-'))
  } catch {
    return []
  }
}

// Module-level memo so the dropdown's per-mount fetch doesn't hit Anthropic on
// every request. 1h TTL — new models are rare; staleness is harmless.
let cache: { at: number; models: ChatModel[] } | null = null
const TTL_MS = 60 * 60_000

export async function getAvailableChatModels(now = Date.now()): Promise<ChatModel[]> {
  if (cache && now - cache.at < TTL_MS) return cache.models
  const discovered = await fetchAnthropicClaudeModels()
  const models = mergeDiscoveredModels(AVAILABLE_MODELS, discovered)
  cache = { at: now, models }
  return models
}
