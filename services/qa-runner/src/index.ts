/**
 * Autonomous QA runner — HTTP entrypoint + orchestration loop.
 *
 * Flow on a `POST /run` webhook (signed with QA_RUNNER_HMAC_SECRET):
 *   1. Mint a Clerk sign-in ticket via the Nexus deployment.
 *   2. Spawn `playwright test` with the ticket URL + base URL injected.
 *   3. On failure: fetch a 30 s slice of Vercel logs, dispatch a fix-attempt
 *      to the self-hosted Claude Code gateway, and file a workflow-feedback
 *      row so the existing optimiser loop can pick up the result.
 *   4. Always respond 202 to the webhook caller — processing is async; the
 *      Vercel cron must not block on a 60 s smoke run.
 *
 * Plan-token cost: 0 on a clean deploy. ~1 dispatch on failure. The gateway
 * decides admission via its own queue depth so we don't need a lane priority
 * here yet.
 */

import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import path from 'node:path'

import { verifySignature } from './auth.js'
import { runSpec } from './runSpec.js'
import {
  issueBotSessionTicket,
  dispatchFixAttempt,
  fetchVercelLogSlice,
  fileWorkflowFeedback,
  type DispatchEnv,
} from './dispatch.js'

const PORT = Number(process.env.QA_RUNNER_PORT ?? 3001)

function readEnv(): DispatchEnv {
  const required = {
    NEXUS_BASE_URL:        process.env.NEXUS_BASE_URL ?? '',
    BOT_ISSUER_SECRET:     process.env.BOT_ISSUER_SECRET ?? '',
    BOT_CLERK_USER_ID:     process.env.BOT_CLERK_USER_ID ?? '',
    BOT_API_TOKEN:         process.env.BOT_API_TOKEN ?? '',
    CLAUDE_GATEWAY_URL:    process.env.CLAUDE_GATEWAY_URL ?? '',
    CLAUDE_GATEWAY_BEARER: process.env.CLAUDE_GATEWAY_BEARER ?? '',
  }
  const missing = Object.entries(required).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length > 0) {
    throw new Error(`qa-runner missing env: ${missing.join(', ')}`)
  }
  return {
    nexusBaseUrl:    required.NEXUS_BASE_URL,
    botIssuerSecret: required.BOT_ISSUER_SECRET,
    botClerkUserId:  required.BOT_CLERK_USER_ID,
    botApiToken:     required.BOT_API_TOKEN,
    gatewayUrl:      required.CLAUDE_GATEWAY_URL,
    gatewayBearer:   required.CLAUDE_GATEWAY_BEARER,
  }
}

const app = new Hono()

app.get('/health', c => c.json({
  ok:     true,
  port:   PORT,
  uptime: process.uptime(),
}))

app.post('/run', async c => {
  const secret = process.env.QA_RUNNER_HMAC_SECRET ?? ''
  if (!secret) {
    return c.json({ ok: false, error: 'qa_runner_not_configured' }, 503)
  }
  const bodyText = await c.req.text()
  const verdict = verifySignature({
    bodyText,
    signature: c.req.header('x-nexus-signature') ?? null,
    timestamp: c.req.header('x-nexus-timestamp') ?? null,
    secret,
  })
  if (!verdict.ok) return c.json({ ok: false, error: verdict.reason }, 401)

  let payload: { baseUrl?: string; deploymentId?: string } = {}
  try { payload = JSON.parse(bodyText || '{}') } catch { /* tolerate empty */ }

  // Fire-and-forget. We respond 202 immediately so Vercel cron isn't blocked.
  void runSmokeAndDispatch({
    baseUrl:      payload.baseUrl ?? process.env.BASE_URL ?? '',
    deploymentId: payload.deploymentId,
  }).catch(err => {
    console.error('[qa-runner] run failed:', err instanceof Error ? err.message : err)
  })

  return c.json({ ok: true, accepted: true }, 202)
})

interface OrchestrationOpts {
  baseUrl:       string
  deploymentId?: string
}

async function runSmokeAndDispatch(opts: OrchestrationOpts): Promise<void> {
  const env = readEnv()
  if (!opts.baseUrl) {
    console.warn('[qa-runner] no baseUrl supplied — refusing to run blind')
    return
  }

  console.log(`[qa-runner] starting smoke against ${opts.baseUrl}`)
  let ticketUrl: string
  try {
    ticketUrl = await issueBotSessionTicket(env)
  } catch (err) {
    console.error('[qa-runner] ticket issuance failed:', err instanceof Error ? err.message : err)
    return
  }

  const cwd = path.resolve(process.cwd())
  const spec = await runSpec({ baseUrl: opts.baseUrl, ticketUrl, cwd })

  if (spec.ok) {
    console.log(`[qa-runner] smoke passed (${spec.passed} tests, ${spec.durationMs}ms) — no dispatch`)
    return
  }

  console.log(`[qa-runner] smoke failed: ${spec.failed} test(s). Composing dispatch.`)

  // Pull the last 30 s of Vercel logs anchored to now. The Nexus side serves
  // this through `/api/logs/slice` which uses `attachLogsToBrief` under the
  // hood. Best-effort — we still dispatch with whatever we have.
  const logSlice = await fetchVercelLogSlice(env, { windowSeconds: 30, deploymentId: opts.deploymentId })

  const briefSections: string[] = []
  briefSections.push(`Smoke specs failed against ${opts.baseUrl} (${spec.failed} of ${spec.failed + spec.passed}).`)
  briefSections.push('')
  briefSections.push('## Failures')
  for (const f of spec.failures) {
    briefSections.push(`### ${f.title}`)
    briefSections.push(`File: \`${f.file}\``)
    briefSections.push('')
    briefSections.push('```')
    briefSections.push(f.errorMessage || '<no error message>')
    briefSections.push('```')
    if (f.attachments.length > 0) {
      briefSections.push('Attachments:')
      for (const a of f.attachments) briefSections.push(`- \`${a}\``)
    }
    briefSections.push('')
  }
  if (logSlice) briefSections.push(logSlice)

  briefSections.push('## Stdout tail')
  briefSections.push('```')
  briefSections.push(spec.stdoutTail)
  briefSections.push('```')

  const dispatch = await dispatchFixAttempt(env, {
    title:       `Post-deploy smoke failed (${spec.failed} test${spec.failed === 1 ? '' : 's'})`,
    brief:       briefSections.join('\n'),
    agentSlug:   'nexus-tester',
    sessionTag:  'qa-runner-smoke',
  })

  if (!dispatch.ok) {
    console.error('[qa-runner] dispatch failed:', dispatch.error)
  } else {
    console.log(`[qa-runner] dispatched fix-attempt: jobId=${dispatch.jobId}`)
  }

  await fileWorkflowFeedback(env, {
    agentSlug: 'nexus-tester',
    summary:   `qa-runner: ${spec.failed} smoke failure(s)`,
    details:   briefSections.join('\n'),
  })
}

console.log(`[qa-runner] listening on :${PORT}`)
serve({ fetch: app.fetch, port: PORT })
