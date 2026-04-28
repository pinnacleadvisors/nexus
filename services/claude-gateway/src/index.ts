import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { z } from 'zod'

import { verifyHmac } from './auth.js'
import { WorkQueue, QueueFullError } from './queue.js'
import { runClaude } from './spawn.js'
import { isSafeSlug } from './agentSpec.js'

const PORT          = Number(process.env.CLAUDE_GATEWAY_PORT ?? 3000)
const BEARER        = process.env.CLAUDE_GATEWAY_BEARER ?? ''
const REPO_PATH     = process.env.NEXUS_REPO_PATH ?? '/repo'
const QUEUE_MAX     = Number(process.env.QUEUE_MAX_DEPTH ?? 8)
const REQUEST_MAX_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000)
const DEBUG_HMAC    = process.env.DEBUG_HMAC === '1'

if (!BEARER) {
  console.error('[gateway] CLAUDE_GATEWAY_BEARER is required — refusing to start')
  process.exit(1)
}

const queue = new WorkQueue(QUEUE_MAX)
const app   = new Hono()

const messageBodySchema = z.object({
  role:    z.literal('user'),
  content: z.string().min(1).max(200_000),
  agent:   z.string().optional().nullable(),
  env:     z.record(z.string()).optional().default({}),
})

app.get('/health', async c => {
  let loggedIn = false
  try {
    const stat = await fs.stat('/root/.claude')
    loggedIn = stat.isDirectory()
    if (loggedIn) {
      const entries = await fs.readdir('/root/.claude')
      loggedIn = entries.length > 0
    }
  } catch {
    loggedIn = false
  }
  return c.json({
    ok:         true,
    loggedIn,
    queueDepth: queue.depth,
    queueMax:   QUEUE_MAX,
    repoPath:   REPO_PATH,
  })
})

app.post('/api/sessions/:sessionId/messages', async c => {
  const sessionId = c.req.param('sessionId')
  if (!sessionId || sessionId.length > 200) {
    return c.json({ ok: false, error: 'invalid sessionId' }, 400)
  }

  const bodyText = await c.req.text()
  const auth     = c.req.header('authorization') ?? ''
  const bearer   = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null
  const sig      = c.req.header('x-nexus-signature') ?? null
  const tsHeader = c.req.header('x-nexus-timestamp')
  const ts       = tsHeader ? Number(tsHeader) : undefined

  const verdict = verifyHmac({
    bodyText,
    bearer,
    signature:    sig,
    sharedSecret: BEARER,
    timestampMs:  ts,
  })

  // Gated debug log so we can diagnose 401 bad-signature in transit (e.g.
  // Cloudflare Tunnel mutating the body). NEVER enable in normal operation —
  // the bearer hash + body bytes leak into Coolify logs. Set DEBUG_HMAC=1
  // only while diagnosing, then unset.
  if (DEBUG_HMAC) {
    const { createHash, createHmac } = await import('node:crypto')
    const expected = 'sha256=' + createHmac('sha256', BEARER).update(bodyText).digest('hex')
    const bytes = Buffer.from(bodyText, 'utf8')
    const hex   = bytes.toString('hex')
    const bearerHash = bearer ? createHash('sha256').update(bearer).digest('hex') : 'null'
    const expectedBearerHash = createHash('sha256').update(BEARER).digest('hex')
    console.log('[debug-hmac] verdict=' + (verdict.ok ? 'ok' : verdict.reason))
    console.log('[debug-hmac] bodyLen=' + bytes.length)
    console.log('[debug-hmac] bodyHex=' + hex)
    console.log('[debug-hmac] bodyAscii=' + JSON.stringify(bodyText))
    console.log('[debug-hmac] sigReceived=' + sig)
    console.log('[debug-hmac] sigExpected=' + expected)
    console.log('[debug-hmac] bearerHashSent=' + bearerHash.slice(0, 16) + '...')
    console.log('[debug-hmac] bearerHashEnv =' + expectedBearerHash.slice(0, 16) + '...')
    console.log('[debug-hmac] tsReceived=' + tsHeader + ' tsParsed=' + ts + ' now=' + Date.now())
  }

  if (!verdict.ok) {
    return c.json({ ok: false, error: 'unauthorized', reason: verdict.reason }, 401)
  }

  let body: z.infer<typeof messageBodySchema>
  try {
    const json = JSON.parse(bodyText) as unknown
    body = messageBodySchema.parse(json)
  } catch (err) {
    return c.json(
      { ok: false, error: 'invalid body', detail: (err as Error).message },
      400,
    )
  }

  const agentSlug = body.agent && isSafeSlug(body.agent) ? body.agent : null

  let result
  try {
    result = await queue.enqueue(() => runClaude({
      agentSlug,
      message:   body.content,
      env:       body.env,
      repoPath:  REPO_PATH,
      timeoutMs: REQUEST_MAX_MS,
    }))
  } catch (err) {
    if (err instanceof QueueFullError) {
      return c.json({ ok: false, error: 'queue_full', depth: err.depth, max: err.maxDepth }, 503)
    }
    return c.json({ ok: false, error: 'spawn_failed', detail: (err as Error).message }, 500)
  }

  if (!result.ok) {
    return c.json(
      {
        ok:        false,
        sessionId,
        agent:     agentSlug,
        content:   result.content,
        error:     result.error ?? 'claude_cli_failed',
        durationMs: result.durationMs,
      },
      502,
    )
  }

  return c.json({
    ok:         true,
    sessionId,
    agent:      agentSlug,
    content:    result.content,
    usage:      result.usage,
    model:      result.model,
    durationMs: result.durationMs,
    cliSessionId: result.sessionId,
  })
})

app.notFound(c => c.json({ ok: false, error: 'not_found' }, 404))

serve({ fetch: app.fetch, port: PORT })
console.log(`[gateway] listening on :${PORT} (queue max ${QUEUE_MAX}, repo ${REPO_PATH})`)
console.log(`[gateway] startup directory check: ${path.resolve(REPO_PATH)}`)
