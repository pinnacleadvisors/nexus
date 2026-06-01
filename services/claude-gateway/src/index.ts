import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { z } from 'zod'

import { verifyHmac } from './auth.js'
import { WorkQueue, QueueFullError } from './queue.js'
import { runClaude, type RunArgs, type RunResult } from './spawn.js'
import { runClaudePty } from './spawnPty.js'
import { isSafeSlug } from './agentSpec.js'
import { JobStore } from './jobStore.js'
import { probeAllMcpTools, invalidateMcpToolCache } from './mcpProbe.js'

const PORT          = Number(process.env.CLAUDE_GATEWAY_PORT ?? 3000)
const BEARER        = process.env.CLAUDE_GATEWAY_BEARER ?? ''
const REPO_PATH     = process.env.NEXUS_REPO_PATH ?? '/repo'
const QUEUE_MAX     = Number(process.env.QUEUE_MAX_DEPTH ?? 8)
const REQUEST_MAX_MS = Number(process.env.REQUEST_TIMEOUT_MS ?? 600_000)
const DEBUG_HMAC    = process.env.DEBUG_HMAC === '1'
// Gateway-wide default execution mode. 'print' = `claude -p` (API-rate billed
// — see spawnPty.ts header). 'pty' = interactive pseudo-terminal (Max/Pro
// subscription billed). Per-request body.execMode overrides this. Default stays
// 'print' so behaviour is unchanged until the operator opts in.
const DEFAULT_EXEC_MODE: 'print' | 'pty' = process.env.CLAUDE_DEFAULT_EXEC_MODE === 'pty' ? 'pty' : 'print'

/** Choose the spawn path. Both runClaude (print) + runClaudePty (interactive)
 *  share the RunArgs/RunResult contract so this is a clean swap. */
function pickRunner(execMode: 'print' | 'pty' | undefined): (a: RunArgs) => Promise<RunResult> {
  const mode = execMode ?? DEFAULT_EXEC_MODE
  return mode === 'pty' ? runClaudePty : runClaude
}

// Defence-in-depth allowlist. When set, every signed POST must carry an
// X-Nexus-User-Id header matching one of these Clerk user IDs. Bearer + HMAC
// alone are not enough — if the bearer ever leaks, this stops it from being
// used to drain your Max plan from anywhere except a session belonging to you.
// Leave unset to allow any caller with a valid bearer (legacy behaviour).
const ALLOWED_USER_IDS = new Set(
  (process.env.ALLOWED_USER_IDS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean),
)
const USER_ID_GATE_ACTIVE = ALLOWED_USER_IDS.size > 0

if (!BEARER) {
  console.error('[gateway] CLAUDE_GATEWAY_BEARER is required — refusing to start')
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
  /**
   * Per-turn timeout override in milliseconds. Optional. When set, the spawned
   * Claude CLI is killed after min(requestTimeoutMs, REQUEST_MAX_MS) — never
   * above the env-cap. When omitted, the full env-cap REQUEST_MAX_MS applies.
   *
   * Wired in by `task_plan-mobile-copilot.md` Phase 1 so the chat composer can
   * narrow the per-turn budget for short turns (e.g. 5 min for a typo fix)
   * without losing access to the full window for long ones (delegate codex
   * smoke tests, end-to-end Playwright runs, etc.). The CAP itself moves only
   * via the Doppler env var.
   */
  requestTimeoutMs: z.number().int().positive().optional(),
  /**
   * Per-turn model override (Phase 1 of task_plan-collaborative-chat.md).
   * When set, the gateway passes `--model <id>` to the claude CLI so this
   * turn runs on the chosen model instead of the gateway's default
   * (whatever the bound OAuth token's default is — typically Opus 4.7).
   *
   * The Nexus side maintains a whitelist (`lib/chat/models.ts`); the
   * gateway accepts any string the CLI will accept. If the model id is
   * invalid the CLI exits with a clear error which surfaces as the turn's
   * error message — no special handling here.
   */
  modelOverride: z.string().min(1).max(100).optional(),
  /**
   * Per-turn permission mode (Phase 1 of task_plan-collaborative-chat.md).
   * Forwarded to the spawned agent as NEXUS_CHAT_MODE so the agent's spec
   * can branch on it. The actual semantics live in the agent (platform-
   * copilot.md, business-copilot.md) — the gateway is just a transport.
   */
  mode: z.enum(['ask', 'plan', 'auto']).optional(),
  /**
   * Per-turn execution mode (subscription-billing control).
   *   'print' → `claude -p` (fast, but billed at API per-token rate)
   *   'pty'   → interactive pseudo-terminal (billed against the Max/Pro
   *             subscription — see spawnPty.ts). Forwarded from the operator's
   *             `execution_mode` provider preference. Omitted → DEFAULT_EXEC_MODE.
   */
  execMode: z.enum(['print', 'pty']).optional(),
})

/** Clamp a per-turn timeout override to the env cap. Floor at 60s to avoid
 *  pathological clients picking sub-second timeouts that kill turns before
 *  the CLI even spawns. */
function effectiveTimeoutMs(override: number | undefined): number {
  if (override === undefined) return REQUEST_MAX_MS
  return Math.min(Math.max(override, 60_000), REQUEST_MAX_MS)
}

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
    ok:           true,
    loggedIn,
    queueDepth:   queue.depth,
    queueMax:     QUEUE_MAX,
    repoPath:     REPO_PATH,
    jobsTracked:  jobs.size(),
  })
})

/**
 * GET /admin/mcp-tools — live tool counts per configured MCP server.
 *
 * Powers V2 of the chat MCP awareness strip (audit 2026-05-16 §6.6).
 * V1 (PR #202) ships the static manifest. V2 confirms each MCP actually
 * starts inside this container and reports its tool count via
 * `tools/list`.
 *
 * Bearer-auth + ALLOWED_USER_IDS gated. Cheaper than the HMAC-signed
 * routes since it's read-only and the result is cached for 5 minutes;
 * but still gated so the bearer alone can't enumerate config secrets.
 *
 * Query:
 *   ?refresh=1 — bypass cache + re-probe every MCP
 *
 * Response:
 *   { ok: true, reports: McpToolReport[] }
 */
app.get('/admin/mcp-tools', async c => {
  const auth   = c.req.header('authorization') ?? ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7) : null
  if (!bearer || bearer !== BEARER) {
    return c.json({ ok: false, error: 'unauthorized' }, 401)
  }
  if (USER_ID_GATE_ACTIVE) {
    const userId = c.req.header('x-nexus-user-id') ?? ''
    if (!userId || !ALLOWED_USER_IDS.has(userId)) {
      return c.json({ ok: false, error: 'user not allowed' }, 403)
    }
  }
  const refresh = c.req.query('refresh') === '1'
  if (refresh) invalidateMcpToolCache()
  try {
    const reports = await probeAllMcpTools()
    return c.json({ ok: true, reports })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'probe failed'
    return c.json({ ok: false, error: message }, 500)
  }
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

  const turnTimeoutMs = effectiveTimeoutMs(body.requestTimeoutMs)
  // Mode is forwarded to the spawned agent via env so the agent's
  // system prompt can branch (ask/plan/auto). The gateway doesn't
  // interpret the value beyond forwarding it.
  const modeEnv: Record<string, string> = body.mode ? { NEXUS_CHAT_MODE: body.mode } : {}
  const runSync = pickRunner(body.execMode)
  let result
  try {
    result = await queue.enqueue(() => runSync({
      agentSlug,
      message:   body.content,
      env:       { ...body.env, ...modeEnv },
      repoPath:  REPO_PATH,
      timeoutMs: turnTimeoutMs,
      model:     body.modelOverride,
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
  const modeEnvAsync: Record<string, string> = body.mode ? { NEXUS_CHAT_MODE: body.mode } : {}
  const runAsync = pickRunner(body.execMode)
  void queue.enqueue(async () => {
    jobs.markRunning(jobId)
    const result = await runAsync({
      agentSlug,
      message:   body.content,
      env:       { ...body.env, ...modeEnvAsync },
      repoPath:  REPO_PATH,
      timeoutMs: effectiveTimeoutMs(body.requestTimeoutMs),
      model:     body.modelOverride,
      // Phase 2a (poll-with-deltas) — pipe text deltas into the job-store
      // so the GET /api/jobs/:id endpoint can return partial text while
      // the job is still running. Lets the chat UI render progressive
      // output without needing SSE.
      onDelta:     delta  => jobs.appendPartialText(jobId, delta),
      // Phase 3 — pipe tool-use / tool-result events into the job store
      // the same way. SSE bridges (app/api/platform-chat/stream and
      // app/api/businesses/[slug]/chat/stream) diff this snapshot per
      // tick and emit a `tool_event` for each new or just-finished
      // call, so the chat UI's ToolCallCard renders progressively.
      onToolEvent: record => jobs.upsertPartialToolCall(jobId, record),
      // PR #189 — surface the gateway jobId to the permission-broker MCP
      // so it can correlate pending tool-permission requests with the
      // running chat turn.
      jobId,
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
    // Phase 2a — partial text accumulated while the job is still running.
    // Clients use this to render progressive output between polls.
    partialText:      job.partialText,
    // Phase 3 — tool calls observed so far. Stored as a Map internally
    // for in-place updates; serialised as an array on the wire so the
    // shape matches the final `result.toolCalls` array. SSE bridges
    // diff against this snapshot per tick to emit `tool_event` deltas.
    partialToolCalls: job.partialToolCalls ? [...job.partialToolCalls.values()] : undefined,
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
  // serialise — only one Claude CLI runs at a time, matching the JSON path.
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: string, data: unknown) {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      }
      send('open', { sessionId })

      try {
        const runStream = pickRunner(body.execMode)
        const result = await queue.enqueue(() => runStream({
          agentSlug,
          message:   body.content,
          env:       body.env,
          repoPath:  REPO_PATH,
          timeoutMs: REQUEST_MAX_MS,
          onDelta:   (delta) => send('delta', { text: delta }),
        }))
        if (!result.ok) {
          send('error', { error: result.error ?? 'claude_cli_failed', durationMs: result.durationMs })
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
