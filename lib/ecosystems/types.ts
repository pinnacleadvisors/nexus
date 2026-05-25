/**
 * lib/ecosystems/types.ts — adapter contract for ecosystem-agnostic teams.
 *
 * Every "team" plan in the repo (content, design, engineering, …) is built
 * on top of this abstraction. A department's role specs declare verbs
 * (`render_clip`, `generate_module`, `query_memory`) — the registry resolves
 * `(team.id, ecosystem.kind) → adapter` at dispatch time. Swapping a
 * business's Content video provider from Higgsfield to Veo becomes one DB
 * write — no agent spec edits.
 *
 * See task_plan-departments-and-ecosystems.md for the full architectural
 * overlay and the v1 scope this file ships into.
 */

/** The set of capability classes any team can bind to. Each kind has at
 *  least one concrete adapter (or a stub) in lib/ecosystems/adapters/. */
export type EcosystemKind =
  | 'llm'          // text generation
  | 'code'         // code authoring / execution
  | 'design'       // UI/UX / brand generation
  | 'video'        // video generation
  | 'image'        // image generation
  | 'voice'        // text-to-speech
  | 'music'        // music generation
  | 'avatar'       // talking-head / UGC
  | 'speech'       // speech-to-text
  | 'memory'       // long-term memory store
  | 'search'       // web search
  | 'browser'      // headless browser / computer use
  | 'workflow'     // visual workflow runner (n8n et al)
  | 'voice-agent'  // live phone / WebRTC agent
  | 'doc-parse'    // PDF / OCR / structured extraction

/**
 * Generic envelope every adapter returns. Concrete adapters narrow `result`
 * via the verb-specific payload tables defined alongside each adapter.
 *
 * `error` codes are stable strings so the routing layer can react without
 * regex-matching error messages:
 *   - 'unavailable'         — adapter env vars unset; caller should fall back.
 *   - 'capability_missing'  — verb not implemented by this adapter; caller should file a manual-task suggesting a rebind.
 *   - 'rate_limited'        — upstream returned 429; caller should back off.
 *   - 'upstream_error'      — generic upstream failure with details.
 *   - 'budget_exceeded'     — cost-guard tripped; caller should stop.
 */
export interface EcosystemResult<T = unknown> {
  ok:        boolean
  adapter:   string
  verb:      string
  result?:   T
  error?:    'unavailable' | 'capability_missing' | 'rate_limited' | 'upstream_error' | 'budget_exceeded'
  message?:  string
  /** Free-form telemetry (token counts, latency, …) for the caller's logs. */
  telemetry?: Record<string, number | string>
}

export interface EcosystemAdapter {
  kind:         EcosystemKind
  /** URL-safe slug used as the binding value. Lower-snake-case. */
  name:         string
  /** Human label for /teams UI + memory atoms. */
  label:        string
  /** Returns false when required env vars aren't set. The platform must
   *  stay bootable even when an optional adapter is unwired. */
  available:    () => boolean
  /** Free-form list of supported verbs. Drives capability checks in
   *  templates and surfaces in the spawn UI so the operator sees which
   *  ecosystem can do what. */
  capabilities: readonly string[]
  /** Single entry point. Routes the verb to the right internal handler;
   *  unknown verbs return `{ ok: false, error: 'capability_missing' }`. */
  invoke:       (verb: string, payload?: unknown) => Promise<EcosystemResult>
}

/** Helper for adapters: build a typed `unavailable` result. */
export function unavailable(adapter: string, verb: string, hint?: string): EcosystemResult {
  return {
    ok:      false,
    adapter,
    verb,
    error:   'unavailable',
    message: hint ?? `${adapter}: required env vars are not set; bind a different adapter or configure this one.`,
  }
}

/** Helper for adapters: build a typed `capability_missing` result. */
export function capabilityMissing(adapter: string, verb: string, supported: readonly string[]): EcosystemResult {
  return {
    ok:      false,
    adapter,
    verb,
    error:   'capability_missing',
    message: `${adapter} does not implement "${verb}". Supported: ${supported.join(', ')}.`,
  }
}
