/**
 * Phase 0 "throwaway" — synchronous Codex chat dispatch for the operator
 * toggle that lets a chat turn opt in to subscription-billed Codex execution
 * instead of the default Claude path.
 *
 * Why throwaway: this path does NOT emit typed blocks (iteration-plan,
 * approval-request, edit-plan, etc.) reliably. GPT-5.5's natural output
 * doesn't match Claude's idioms, and the per-block regex parsers in
 * lib/chat/*.ts assume Claude-shaped output. Phase 0 accepts the regression
 * in exchange for cost savings. Task M3-M7 in
 * task_plan-model-agnostic-chat.md migrate to schema-first emission so
 * typed blocks survive a provider swap; M9 then replaces this whole helper
 * with the unified `dispatchTurn` interface from lib/ai/dispatch.ts.
 *
 * Constraints:
 *   - Cost cap + rate limit are checked by the calling route, not here.
 *   - Synchronous dispatch — fits inside the route's 45-60s budget on
 *     Vercel Pro. 30s timeout passed to streamCodexGateway leaves slack.
 *   - Persists to the chat session AND to gateway_turns so the operator's
 *     plan-window math and chat history both stay consistent.
 */

import { dispatchToCodexGateway, isCodexGatewayConfigured } from '@/lib/claw/codex-gateway'
import { appendMessage } from '@/lib/chat/sessions'
import { insertGatewayTurn } from '@/lib/claw/gateway-turns'

export interface CodexDirectChatOpts {
  userId:           string
  sessionId:        string
  /** Same slug the Claude path uses today — 'platform-copilot' or 'business-
   *  copilot'. The codex-gateway container needs the matching agent spec
   *  in its .claude/agents/ folder. If missing, dispatch will return an
   *  error string the route surfaces back to the operator. */
  agentSlug:        string
  /** Composite prompt — transcript + system context, same as the Claude path. */
  message:          string
  /** Routing tag for plan-window slicing. */
  sessionTag:       string
  /** Optional per-request env overrides forwarded to the spawned CLI. */
  contextEnv?:      Record<string, string>
}

export interface CodexDirectChatResult {
  ok:              boolean
  mode:            'codex-direct'
  /** The raw assistant text. NOT parsed for typed blocks — Phase 0 renders
   *  this as a plain assistant bubble. */
  text?:           string
  durationMs?:     number
  error?:          string
  /** When set, the operator should retry on Claude — the codex path is
   *  not currently functional (missing config, missing agent spec, etc.). */
  fallbackHint?:   string
}

export async function dispatchCodexChatTurn(
  opts: CodexDirectChatOpts,
): Promise<CodexDirectChatResult> {
  if (!isCodexGatewayConfigured()) {
    return {
      ok:           false,
      mode:         'codex-direct',
      error:        'codex-gateway not configured — set CODEX_GATEWAY_URL + CODEX_GATEWAY_BEARER_TOKEN',
      fallbackHint: 'switch to Claude in the chat header to continue',
    }
  }

  const t0 = Date.now()

  // Single retry on transient proxy-level 5xx (502/503/504). Coolify Traefik
  // returns these when the codex-gateway container is briefly unreachable —
  // most commonly a container restart during a deploy, OR a Cloudflare tunnel
  // hiccup. The 2026-05-22 chat-pill incident was exactly this: /health
  // returned 200 moments before, dispatch returned bare "gateway 502" with
  // no body. One retry with a 2s backoff catches that case without storming.
  // We do NOT retry on 4xx (auth / agent-spec missing — terminal), nor on
  // status=0 (timeout — second attempt will just time out again).
  const dispatchOnce = () => dispatchToCodexGateway({
    agentSlug:   opts.agentSlug,
    message:     opts.message,
    env:         opts.contextEnv ?? {},
    userId:      opts.userId,
    sessionTag:  opts.sessionTag,
    // 45s: real codex turns rarely finish in 30s. Both chat routes now allow
    // maxDuration=60, so 45s leaves ~15s for persist + respond. This is the
    // SYNC chat-pill path — it's still route-bounded, so genuinely long codex
    // work (2-5 min) belongs on the async delegate_to_codex path (see
    // services/mcp-codex-delegate + the 480s codex-gateway job timeout).
    timeoutMs:   45_000,
  })

  let result = await dispatchOnce()
  const isTransient5xx = (r: typeof result): boolean =>
    Boolean(r) && r!.ok === false && [502, 503, 504].includes(r!.status)

  if (isTransient5xx(result)) {
    console.warn(`[codex-direct-dispatch] transient ${result!.status} — retrying once after 2s. error=${result!.error}`)
    await new Promise(r => setTimeout(r, 2000))
    result = await dispatchOnce()
  }

  if (!result) {
    return {
      ok:           false,
      mode:         'codex-direct',
      error:        'codex-gateway dispatch returned null (unconfigured at runtime)',
      fallbackHint: 'switch to Claude in the chat header',
    }
  }
  if (!result.ok) {
    // Hint copy varies by failure mode so the operator sees something
    // actionable rather than a bare "gateway 502". Order matters — check
    // specific (404, trailing-characters auth corruption, transient 5xx after-
    // retry) before falling through to generic.
    let fallbackHint: string
    const errorText = (result.error ?? '').toLowerCase()
    // The 2026-05-27 incident: Doppler CODEX_AUTH_JSON had two concatenated
    // objects, and the codex CLI failed with exactly this message. Surface a
    // direct fix instead of "OOM during CLI spawn". Pattern match is robust
    // to whitespace + line/col numbers.
    const isAuthJsonCorrupt =
      errorText.includes('trailing characters') ||
      errorText.includes('codex cli exited with code 1') ||
      errorText.includes('codex_cli_failed') && errorText.includes('json')

    if (result.status === 404) {
      fallbackHint = 'codex-gateway is missing the agent spec — try Claude for now'
    } else if (isAuthJsonCorrupt) {
      fallbackHint = 'Codex auth.json is corrupt (JSON parse error). Fix: run `codex login` on a dev machine, then copy the contents of `~/.codex/auth.json` into Doppler as CODEX_AUTH_JSON (replace, do not append). Redeploy codex-gateway with CODEX_AUTH_JSON_FORCE=1.'
    } else if ([502, 503, 504].includes(result.status)) {
      fallbackHint = `Codex gateway returned ${result.status} on both attempts — likely OOM during CLI spawn or a tunnel issue. Check Coolify logs; switch to Claude to continue.`
    } else if (result.status === 0) {
      fallbackHint = 'Codex gateway timed out — switch to Claude to continue.'
    } else {
      fallbackHint = 'switch to Claude in the chat header to continue'
    }
    return {
      ok:    false,
      mode:  'codex-direct',
      error: result.error ?? `codex-gateway returned ${result.status}`,
      fallbackHint,
    }
  }

  const durationMs = Date.now() - t0
  const text = result.text ?? ''

  // Persist the assistant turn as a plain text message. Phase 0 does NOT
  // parse typed blocks — see file header. metadata.provider tags the row
  // so future analytics can slice by which provider answered each turn.
  await appendMessage({
    sessionId: opts.sessionId,
    role:      'assistant',
    content:   text,
    metadata:  { provider: 'codex', mode: 'codex-direct' },
  })

  // Plan-window accounting — Codex Pro plan. Token counts are not exposed
  // by the synchronous codex-gateway endpoint today; insertGatewayTurn
  // accepts nulls so the row lands but with empty token columns. When the
  // codex-gateway grows a /usage tail on its synchronous response (parity
  // with claude-gateway's stream-json `result` event), wire it here.
  void insertGatewayTurn({
    userId:          opts.userId,
    plan:            'codex-pro',
    model:           'gpt-5.5-codex',
    sessionTag:      opts.sessionTag,
    durationMs,
    toolCallsCount:  0,                        // codex sync path doesn't surface tool events
  })

  return {
    ok:         true,
    mode:       'codex-direct',
    text,
    durationMs,
  }
}
