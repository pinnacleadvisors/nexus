/**
 * lib/ecosystems/adapters/elevenlabs.ts — `voice` adapter for ElevenLabs TTS.
 *
 * ElevenLabs returns raw audio (audio/mpeg), not a URL, so this adapter reads
 * the response body and returns it base64-encoded (size-capped) plus the
 * content-type — the content edit-publisher uploads it to blob storage. This
 * is the best-effort contract; tighten when a key is wired.
 *
 * Default `voice` binding (lib/teams/default-bindings.ts). Verb matches the
 * content asset-builder spec (`synthesize_voice`).
 *
 * Env:
 *   ELEVENLABS_API_KEY — xi-api-key header (required to be "available")
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['synthesize_voice'] as const
type Verb = (typeof VERBS)[number]

const API_BASE = 'https://api.elevenlabs.io'
/** Default "Rachel" public voice; callers override per brand. */
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'
/** ~12MB ceiling on the base64 payload so a long narration doesn't blow memory. */
const MAX_AUDIO_BYTES = 9_000_000

interface SynthesizeVoicePayload {
  text:       string
  voice_id?:  string
  model_id?:  string
}

function envKey(): string | undefined { return process.env.ELEVENLABS_API_KEY }

export const elevenlabsAdapter: EcosystemAdapter = {
  kind:         'voice',
  name:         'elevenlabs',
  label:        'ElevenLabs (voiceover)',
  capabilities: VERBS,
  available:    () => Boolean(envKey()),
  invoke:       invokeElevenlabs,
}

async function invokeElevenlabs(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!elevenlabsAdapter.available()) {
    return unavailable('elevenlabs', verb, 'Set ELEVENLABS_API_KEY to enable voiceover.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('elevenlabs', verb, VERBS)

  const p = (payload ?? {}) as SynthesizeVoicePayload
  if (typeof p.text !== 'string' || !p.text.trim()) {
    return { ok: false, adapter: 'elevenlabs', verb, error: 'upstream_error', message: 'synthesize_voice requires non-empty `text`' }
  }

  try {
    const voiceId = p.voice_id ?? DEFAULT_VOICE
    const t0 = Date.now()
    const res = await fetch(`${API_BASE}/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json', 'xi-api-key': envKey()! },
      body:    JSON.stringify({ text: p.text, model_id: p.model_id ?? 'eleven_multilingual_v2' }),
      signal:  AbortSignal.timeout(60_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok: false, adapter: 'elevenlabs', verb,
        error: res.status === 429 ? 'rate_limited' : 'upstream_error',
        message: `elevenlabs ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.byteLength > MAX_AUDIO_BYTES) {
      return { ok: false, adapter: 'elevenlabs', verb, error: 'upstream_error', message: `audio ${buf.byteLength}B exceeds ${MAX_AUDIO_BYTES}B cap — split the narration`, telemetry: { latency_ms: latency } }
    }
    return {
      ok:        true,
      adapter:   'elevenlabs',
      verb,
      result:    { audio_base64: buf.toString('base64'), content_type: res.headers.get('content-type') ?? 'audio/mpeg', voice_id: voiceId },
      telemetry: { latency_ms: latency, bytes: buf.byteLength },
    }
  } catch (e) {
    return { ok: false, adapter: 'elevenlabs', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'elevenlabs call failed' }
  }
}
