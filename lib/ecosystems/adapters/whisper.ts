/**
 * lib/ecosystems/adapters/whisper.ts — `speech` adapter (speech-to-text).
 *
 * Best-effort HTTP router targeting an OpenAI-compatible STT endpoint. The
 * default `speech` binding (lib/teams/default-bindings.ts). Accepts a JSON
 * contract { audio_url } POSTed to `${base}/v1/audio/transcriptions` — point
 * WHISPER_BASE_URL at a self-hosted whisper shim that accepts a URL, or at any
 * OpenAI-compatible STT gateway. Tighten the contract when wired.
 *
 * Env (either enables it):
 *   WHISPER_BASE_URL — self-hosted / compatible base (preferred)
 *   OPENAI_API_KEY   — bearer auth; base falls back to api.openai.com
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = ['transcribe_audio'] as const
type Verb = (typeof VERBS)[number]

const OPENAI_BASE = 'https://api.openai.com'

interface TranscribePayload {
  audio_url: string
  model?:    string
  language?: string
}

function envBase(): string { return process.env.WHISPER_BASE_URL || OPENAI_BASE }
function envKey():  string | undefined { return process.env.OPENAI_API_KEY }

export const whisperAdapter: EcosystemAdapter = {
  kind:         'speech',
  name:         'whisper',
  label:        'Whisper (speech-to-text)',
  capabilities: VERBS,
  available:    () => Boolean(process.env.WHISPER_BASE_URL || envKey()),
  invoke:       invokeWhisper,
}

async function invokeWhisper(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!whisperAdapter.available()) {
    return unavailable('whisper', verb, 'Set WHISPER_BASE_URL (preferred) or OPENAI_API_KEY to enable transcription.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('whisper', verb, VERBS)

  const p = (payload ?? {}) as TranscribePayload
  if (typeof p.audio_url !== 'string' || !p.audio_url.trim()) {
    return { ok: false, adapter: 'whisper', verb, error: 'upstream_error', message: 'transcribe_audio requires `audio_url`' }
  }

  try {
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    const key = envKey()
    if (key) headers.authorization = `Bearer ${key}`
    const t0 = Date.now()
    const res = await fetch(`${envBase()}/v1/audio/transcriptions`, {
      method:  'POST',
      headers,
      body:    JSON.stringify({ audio_url: p.audio_url, model: p.model ?? 'whisper-1', language: p.language }),
      signal:  AbortSignal.timeout(60_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok: false, adapter: 'whisper', verb,
        error: res.status === 429 ? 'rate_limited' : 'upstream_error',
        message: `whisper ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency },
      }
    }
    return { ok: true, adapter: 'whisper', verb, result: await res.json(), telemetry: { latency_ms: latency } }
  } catch (e) {
    return { ok: false, adapter: 'whisper', verb, error: 'upstream_error', message: e instanceof Error ? e.message : 'whisper call failed' }
  }
}
