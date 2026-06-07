/**
 * lib/ecosystems/adapters/code-codex.ts — `code` adapter for the Codex gateway
 * (real, env-gated).
 *
 * Exposes the sandboxed Codex CLI gateway (services/codex-gateway, ADR 002) as
 * a bindable `code` ecosystem so an operator can pick `code:code-codex` in
 * /teams for execution-heavy work (debug, container setup, deploy, current-UI
 * research) — the slice `shouldRouteToCodex()` already routes to for GPT/Codex
 * models. Before this adapter the codex-gateway was reachable only as a managed
 * agent via dispatch, never as a team binding.
 *
 * Rather than re-implement the HMAC dispatch protocol, this wraps the existing
 * `dispatchToCodexGateway()` helper (lib/claw/codex-gateway.ts) — the same
 * tested path the chat/agent surfaces use. Each ecosystem verb becomes one
 * codex-operator dispatch whose message encodes the verb + payload.
 */

import type { EcosystemAdapter, EcosystemResult } from '../types'
import { capabilityMissing, unavailable } from '../types'
import { isCodexGatewayConfigured, dispatchToCodexGateway } from '@/lib/claw/codex-gateway'

const VERBS = [
  'generate_module',
  'edit_file',
  'review_diff',
  'run_command',
  'health_check',
] as const
type Verb = (typeof VERBS)[number]

interface CodexPayload {
  prompt?:  string
  file?:    string
  patch?:   string
  command?: string
  cwd?:     string
  [k: string]: unknown
}

/** Turn an ecosystem (verb, payload) into a single instruction the
 *  codex-operator agent can act on. Kept terse — the gateway runs a real CLI. */
function buildMessage(verb: Verb, p: CodexPayload): string {
  switch (verb) {
    case 'generate_module': return `Generate code module.\n${p.prompt ?? ''}`
    case 'edit_file':       return `Edit file ${p.file ?? '(unspecified)'}.\n${p.prompt ?? p.patch ?? ''}`
    case 'review_diff':     return `Review this diff and report issues:\n${p.patch ?? p.prompt ?? ''}`
    case 'run_command':     return `Run command in ${p.cwd ?? 'repo root'}: ${p.command ?? p.prompt ?? ''}`
    case 'health_check':    return 'health_check'
  }
}

export const codeCodexAdapter: EcosystemAdapter = {
  kind:         'code',
  name:         'code-codex',
  label:        'Codex (gateway)',
  capabilities: VERBS,
  available:    () => isCodexGatewayConfigured(),
  invoke:       invokeCodeCodex,
}

async function invokeCodeCodex(verb: string, payload?: unknown): Promise<EcosystemResult> {
  if (!codeCodexAdapter.available()) {
    return unavailable('code-codex', verb,
      'Set CODEX_GATEWAY_URL + CODEX_GATEWAY_BEARER_TOKEN to bind code:code-codex.')
  }
  if (!VERBS.includes(verb as Verb)) return capabilityMissing('code-codex', verb, VERBS)

  const p = (payload ?? {}) as CodexPayload
  try {
    const t0 = Date.now()
    const res = await dispatchToCodexGateway({
      agentSlug: 'codex-operator',
      message:   buildMessage(verb as Verb, p),
      env:       {},
      timeoutMs: verb === 'run_command' ? 60_000 : 30_000,
    })
    const latency = Date.now() - t0
    // null = gateway unconfigured (defensive — available() already guarded).
    if (!res) return unavailable('code-codex', verb, 'Codex gateway returned no result (unconfigured).')
    if (!res.ok) {
      return {
        ok:        false,
        adapter:   'code-codex',
        verb,
        error:     res.status === 429 ? 'rate_limited' : 'upstream_error',
        message:   res.error ?? `code-codex ${verb} → ${res.status}`,
        telemetry: { http_status: res.status, latency_ms: latency, via: 'codex-gateway' },
      }
    }
    return {
      ok:        true,
      adapter:   'code-codex',
      verb,
      result:    { text: res.text, sessionId: res.sessionId },
      telemetry: { latency_ms: latency, via: 'codex-gateway' },
    }
  } catch (e) {
    return {
      ok:      false,
      adapter: 'code-codex',
      verb,
      error:   'upstream_error',
      message: e instanceof Error ? e.message : 'code-codex call failed',
    }
  }
}
