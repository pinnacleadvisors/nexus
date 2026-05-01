import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { z } from 'zod'

import { verifyHmac } from './auth.js'
import { WorkQueue, QueueFullError } from './queue.js'
import { runCodex } from './spawn.js'
import { isSafeSlug } from './agentSpec.js'
import { JobStore } from './jobStore.js'

const PORT          = Number(process.env.CODEX_GATEWAY_PORT ?? 3000)
const BEARER        = process.env.CODEX_GATEWAY_BEARER ?? ''
const REPO_PATH     = process.env.NEXUS_REPO_PATH ?? '/repo'
const QUEUE_MAX     = Number(process.env.QUEUE_MAX_DEPTH ?? 8)
const REQUEST_MAX_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 120_000)
const DEBUG_HMAC    = process.env.DEBUG_HMAC === '1'

// Defence-in-depth allowlist. When set, every signed POST must carry an
// X-Nexus-User-Id header matching one of these Clerk user IDs. Bearer + HMAC
// alone are not enough — if the bearer ever leaks, this stops it from being
// used to drain your ChatGPT Pro plan from anywhere except a session belonging to you.
// Leave unset to allow any caller with a valid bearer (legacy behaviour).
const ALLOWED_USER_IDS = new Set(
  (process.env.ALLOWED_USER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
)
const USER_ID_GATE_ACTIVE = ALLOWED_USER_IDS.size > 0

if (!BEARER) {
  console.error('[gateway] CODEX_GATEWAY_BEARER is required — refusing to start')
  process.exit(1)
}

if (USER_ID_GATE_ACTIVE) {
  console.log(`[gateway] ALLOWED_USER_IDS gate active (${ALLOWED_USER_IDS.size} ids)`)
}

const queue = new WorkQueue(QUEUE_MAX)
const jobs  = new JobStore()
const app   = new Hono()

// One-line request log so the operator can confirm calls actually hit the
// container. /health is noisy (Coolify probe + status pill poll), so it's
// logged at a quieter level — every other path logs every request with
// status + duration. Keep this tight: STDOUT lines are what `docker logs`
// shows, so verbose traffic dilutes signal.
app.use('*', async (c, next) => {
  const started = Date.now()
  await next()
  const ms = Date.now() - started
  const path = c.req.path
  const status = c.res.status
  const userId = c.req.header('x-nexus-user-id')?.slice(0, 12)
  if (path === '/health') {
    // Only log unhealthy / unusual statuses for /health to keep logs readable.
    if (status >= 400) console.log(`[gw] GET /health ${status} ${ms}ms`)
    return
  }
  const userTag = userId ? ` user=${userId}…` : ''
  console.log(`[gw] ${c.req.method} ${path} ${status} ${ms}ms${userTag}`)
})

const messageBodySchema = z.object({
  role:    z.literal('user'),
  content: z.string().min(1).max(200_000),
  agent:   z.string().optional().nullable(),
  env:     z.record(z.string()).optional().default({}),
})

app.get('/health', async c => {
  let loggedIn = false
  try {
    const stat = await fs.stat('/root/.codex')
    loggedIn = stat.isDirectory()
    if (loggedIn) {
      const entries = await fs.readdir('/root/.codex')
      loggedIn = entries.length > 0
    }
  } catch {
    loggedIn = false
  }
  return c.json({
    ok:           true,
    loggedIn,
    queueDepth:   queue.depth,
    queueMax:     QUEUE_MAX,
    repoPath:     REPO_PATH,
    jobsTracked:  jobs.size(),
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

  // Allowlist gate (defence-in-depth). Even with a valid bearer + signature,
  // refuse the request unless it identifies a known user. The Vercel app
  // injects the Clerk userId via callGateway → X-Nexus-User-Id; out-of-band
  // callers (cron, smoke tests) can be allowlisted via ALLOWED_USER_IDS too.
  if (USER_ID_GATE_ACTIVE) {
    const userId = c.req.header('x-nexus-user-id')?.trim() ?? ''
    if (!userId || !ALLOWED_USER_IDS.has(userId)) {
      return c.json(
        { ok: false, error: 'unauthorized', reason: 'user-not-allowed' },
        403,
      )
    }
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
    result = await queue.enqueue(() => runCodex({
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
        error:     result.error ?? 'codex_cli_failed',
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

// ── Async job variant ──────────────────────────────────────────────────────
// `POST /api/jobs` enqueues the same shape as `/messages` but returns a jobId
// immediately instead of blocking on the spawned CLI. Use this when the
// caller (Vercel function, n8n node) has its own short timeout that the CLI
// can't fit inside. Poll `GET /api/jobs/:jobId` until status is `done` or
// `error` and pick up the result.
//
// Auth shape mirrors `/messages`: bearer + HMAC over the body + ALLOWED_USER_IDS.
// The GET counterpart needs only the bearer (no body to sign).
app.post('/api/jobs', async c => {
  const bodyText = await c.req.text()
  const auth     = c.req.header('authorization') ?? ''
  const bearer   = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null
  const sig      = c.req.header('x-nexus-signature') ?? null
  const tsHeader = c.req.header('x-nexus-timestamp')
  const ts       = tsHeader ? Number(tsHeader) : undefined

  const verdict = verifyHmac({
    bodyText, bearer, signature: sig, sharedSecret: BEARER, timestampMs: ts,
  })
  if (!verdict.ok) {
    return c.json({ ok: false, error: 'unauthorized', reason: verdict.reason }, 401)
  }
  if (USER_ID_GATE_ACTIVE) {
    const uid = c.req.header('x-nexus-user-id')?.trim() ?? ''
    if (!uid || !ALLOWED_USER_IDS.has(uid)) {
      return c.json({ ok: false, error: 'unauthorized', reason: 'user-not-allowed' }, 403)
    }
  }

  let body: z.infer<typeof messageBodySchema>
  try {
    body = messageBodySchema.parse(JSON.parse(bodyText))
  } catch (err) {
    return c.json({ ok: false, error: 'invalid body', detail: (err as Error).message }, 400)
  }

  const agentSlug  = body.agent && isSafeSlug(body.agent) ? body.agent : null
  const sessionTag = c.req.header('x-nexus-session-tag') ?? null
  const jobId      = jobs.create({ agentSlug, sessionTag })

  // Fire-and-forget — but enforce queue admission UP FRONT so the caller
  // gets a 503 instead of a phantom jobId that will never advance.
  if (queue.depth >= QUEUE_MAX) {
    jobs.markFailed(jobId, 'queue_full')
    return c.json({ ok: false, error: 'queue_full', depth: queue.depth, max: QUEUE_MAX }, 503)
  }

  // Detached promise: we deliberately don't await. The job advances inside the
  // queue's existing FIFO drain loop and writes its result back into the store.
  void queue.enqueue(async () => {
    jobs.markRunning(jobId)
    const result = await runCodex({
      agentSlug,
      message:   body.content,
      env:       body.env,
      repoPath:  REPO_PATH,
      timeoutMs: REQUEST_MAX_MS,
    })
    jobs.markDone(jobId, result)
    return result
  }).catch(err => {
    if (err instanceof QueueFullError) {
      jobs.markFailed(jobId, 'queue_full')
    } else {
      jobs.markFailed(jobId, (err as Error).message ?? 'spawn_failed')
    }
  })

  return c.json({ ok: true, jobId, status: 'pending' })
})

app.get('/api/jobs/:jobId', async c => {
  const auth   = c.req.header('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null
  // GETs aren't HMAC-signed (no body), but we still require the bearer match.
  if (!bearer || bearer !== BEARER) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (USER_ID_GATE_ACTIVE) {
    const uid = c.req.header('x-nexus-user-id')?.trim() ?? ''
    if (!uid || !ALLOWED_USER_IDS.has(uid)) {
      return c.json({ ok: false, error: 'unauthorized', reason: 'user-not-allowed' }, 403)
    }
  }

  const jobId = c.req.param('jobId')
  const job   = jobs.get(jobId)
  if (!job) return c.json({ ok: false, error: 'not_found' }, 404)

  return c.json({
    ok:         true,
    jobId:      job.jobId,
    status:     job.status,
    agent:      job.agentSlug,
    sessionTag: job.sessionTag,
    createdAt:  job.createdAt,
    startedAt:  job.startedAt,
    finishedAt: job.finishedAt,
    result:     job.result,
  })
})

// ── Streaming variant ──────────────────────────────────────────────────────
// Same auth + body shape as /messages, but writes the response as
// `text/event-stream`. Each assistant delta is sent as `event: delta` with
// the raw text chunk in `data:`; the final `result` event carries usage and
// duration. Callers that don't need progressive UX should keep using the
// JSON endpoint above — this one only exists for chat / agent / build/plan
// surfaces where token-by-token output materially improves the experience.
app.post('/api/sessions/:sessionId/stream', async c => {
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
    bodyText, bearer, signature: sig, sharedSecret: BEARER, timestampMs: ts,
  })
  if (!verdict.ok) {
    return c.json({ ok: false, error: 'unauthorized', reason: verdict.reason }, 401)
  }
  if (USER_ID_GATE_ACTIVE) {
    const uid = c.req.header('x-nexus-user-id')?.trim() ?? ''
    if (!uid || !ALLOWED_USER_IDS.has(uid)) {
      return c.json({ ok: false, error: 'unauthorized', reason: 'user-not-allowed' }, 403)
    }
  }

  let body: z.infer<typeof messageBodySchema>
  try {
    body = messageBodySchema.parse(JSON.parse(bodyText))
  } catch (err) {
    return c.json({ ok: false, error: 'invalid body', detail: (err as Error).message }, 400)
  }

  const agentSlug = body.agent && isSafeSlug(body.agent) ? body.agent : null

  // Build an SSE stream. The CLI is spawned inside a queued task so we still
  // serialise — only one Codex CLI runs at a time, matching the JSON path.
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      send('open', { sessionId })

      try {
        const result = await queue.enqueue(() => runCodex({
          agentSlug,
          message:   body.content,
          env:       body.env,
          repoPath:  REPO_PATH,
          timeoutMs: REQUEST_MAX_MS,
          onDelta:   (delta) => send('delta', { text: delta }),
        }))
        if (!result.ok) {
          send('error', { error: result.error ?? 'codex_cli_failed', durationMs: result.durationMs })
        } else {
          send('result', {
            ok:           true,
            content:      result.content,
            usage:        result.usage,
            model:        result.model,
            durationMs:   result.durationMs,
            cliSessionId: result.sessionId,
          })
        }
      } catch (err) {
        if (err instanceof QueueFullError) {
          send('error', { error: 'queue_full', depth: err.depth, max: err.maxDepth })
        } else {
          send('error', { error: 'spawn_failed', detail: (err as Error).message })
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type':       'text/event-stream',
      'Cache-Control':      'no-cache, no-transform',
      'Connection':         'keep-alive',
      'X-Accel-Buffering':  'no',
    },
  })
})

app.notFound(c => c.json({ ok: false, error: 'not_found' }, 404))

serve({ fetch: app.fetch, port: PORT })
console.log(`[gateway] listening on :${PORT} (queue max ${QUEUE_MAX}, repo ${REPO_PATH})`)
console.log(`[gateway] startup directory check: ${path.resolve(REPO_PATH)}`)
