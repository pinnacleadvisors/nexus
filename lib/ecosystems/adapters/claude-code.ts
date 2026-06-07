/**
 * lib/ecosystems/adapters/claude-code.ts — `code` adapter for the self-hosted
 * Claude Code gateway (real, env-gated).
 *
 * Why this exists separately from `open-code.ts`: the open-code adapter
 * SILENTLY falls back to the claude-gateway when OPEN_CODE_BASE_URL is unset,
 * so callers see "open-code" even when Claude Code is what actually ran (only
 * `telemetry.via` revealed it — the §4 "honesty gap" in
 * docs/research/THIRD_PARTY_TOOL_MATRIX.md). This adapter is the EXPLICIT
 * binding: choosing `code:claude-code` means "run on the Claude Code gateway",
 * full stop. No native-Open-Code path, no ambiguity.
 *
 * Speaks the claude-gateway `/dispatch` protocol (verb + payload envelope,
 * Bearer auth) — the same path open-code.ts uses for its fallback branch.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'

const VERBS = [
  'generate_module',
  'edit_file',
  'review_diff',
  'run_command',
  'health_check',
] as const
type Verb = (typeof VERBS)[number]

function gatewayBase(): string | undefined { return process.env.CLAUDE_CODE_GATEWAY_URL }
function gatewayKey():  string | undefined { return process.env.CLAUDE_CODE_BEARER_TOKEN }

export const claudeCodeAdapter: EcosystemAdapter = {
  kind:         'code',
  name:         'claude-code',
  label:        'Claude Code (gateway)',
  capabilities: VERBS,
  available:    () => Boolean(gatewayBase() && gatewayKey()),
  invoke:       invokeClaudeCode,
}

async function invokeClaudeCode(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!claudeCodeAdapter.available()) {
    return unavailable('claude-code', verb,
      'Set CLAUDE_CODE_GATEWAY_URL + CLAUDE_CODE_BEARER_TOKEN to bind code:claude-code.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('claude-code', verb, VERBS)

  const base = gatewayBase()!
  const key  = gatewayKey()!
  const path = '/dispatch'

  try {
    const t0 = Date.now()
    const res = await fetch(`${base}${path}`, {
      method:  verb === 'health_check' ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body:    verb === 'health_check' ? undefined : JSON.stringify({ verb, payload: payload ?? {} }),
      signal:  AbortSignal.timeout(verb === 'run_command' ? 60_000 : 30_000),
    })
    const latency = Date.now() - t0
    if (!res.ok) {
      return {
        ok:        false,
        adapter:   'claude-code',
        verb,
        error:     res.status === 429 ? 'rate_limited' : 'upstream_error',
        message:   `claude-code ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency, via: 'claude-gateway' },
      }
    }
    const data = verb === 'health_check' ? { status: res.status } : await res.json()
    return {
      ok:        true,
      adapter:   'claude-code',
      verb,
      result:    data,
      telemetry: { latency_ms: latency, via: 'claude-gateway' },
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'claude-code',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'claude-code call failed',
    }
  }
}
