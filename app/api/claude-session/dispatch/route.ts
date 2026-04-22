/**
 * POST /api/claude-session/dispatch
 *
 * Called by n8n workflow nodes to execute a workflow step with a Claude
 * managed agent. Does three things in order:
 *
 *   1. Ensures the agent spec at `.claude/agents/<slug>.md` exists. If it
 *      doesn't and `autoCreateAgent: true`, emit a minimal portable spec on
 *      disk using the generation-protocol template. Persist it to
 *      Supabase via the `/api/agents` pattern when available.
 *
 *   2. Builds the Claude Code session env. When `swarm: true`, inject
 *      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 so the lead agent can spawn
 *      a team (`claude-code` Agent Teams, experimental).
 *
 *   3. Dispatches the session. If OpenClaw (`OPENCLAW_GATEWAY_URL` +
 *      `OPENCLAW_BEARER_TOKEN`) is configured, POSTs a signed request to
 *      `/api/sessions/<sessionId>/messages` with the task brief. Otherwise
 *      returns 202 with `pending: true` so the n8n run keeps moving and
 *      the owner can complete the step manually.
 *
 * Body:
 *   {
 *     agentSlug:       string     // e.g. 'content-website-specialist'
 *     capabilityId:    string     // lib/agent-capabilities.ts id
 *     swarm?:          boolean    // default false
 *     autoCreateAgent?: boolean   // default true
 *     asset?:          'website'|'image'|'video'|'app'|'ad'|'landing'|'email'|'content'|'listing'|null
 *     inputs: {
 *       task:             string
 *       description?:     string
 *       howItMakesMoney?: string
 *       tools?:           string[]
 *       upstream?:        unknown    // arbitrary n8n upstream payload
 *       [extra: string]:  unknown
 *     }
 *   }
 *
 * Response 200 (dispatched):
 *   { ok: true, sessionId, agentSlug, swarm, envApplied, created }
 * Response 202 (queued / no OpenClaw):
 *   { ok: true, pending: true, agentSlug, swarm, envApplied, created }
 */

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { audit } from '@/lib/audit'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { getCapability } from '@/lib/agent-capabilities'
import { buildSessionEnv } from '@/lib/n8n/managed-agent-builder'

export const runtime    = 'nodejs'
export const maxDuration = 45

// ── Types ────────────────────────────────────────────────────────────────────

interface DispatchBody {
  agentSlug:        string
  capabilityId?:    string
  swarm?:           boolean
  autoCreateAgent?: boolean
  asset?: string | null
  inputs?: {
    task?:             string
    description?:      string
    howItMakesMoney?:  string
    tools?:            string[]
    upstream?:         unknown
    [extra: string]:   unknown
  }
}

// ── Agent spec helpers ───────────────────────────────────────────────────────

const AGENTS_DIR = path.join(process.cwd(), '.claude', 'agents')

function slugIsSafe(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,60}$/.test(slug)
}

async function specExists(slug: string): Promise<boolean> {
  try {
    await fs.access(path.join(AGENTS_DIR, `${slug}.md`))
    return true
  } catch {
    return false
  }
}

interface SpecTemplateArgs {
  slug:         string
  capabilityId: string
  swarm:        boolean
  asset:        string | null
  taskHint:     string
}

function renderSpec(args: SpecTemplateArgs): string {
  const { slug, capabilityId, swarm, asset, taskHint } = args
  const titleName = slug
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
  const envBlock = swarm
    ? 'env:\n  - CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS   # set to 1 to enable Agent Teams\n'
    : 'env: []\n'

  const swarmBody = swarm
    ? `\n## Swarm mode\n\nThis agent runs with \`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1\`. When the task is large enough, break it into ≥3 independent sub-tasks and spawn teammates with a shared task list. Coordinate them so their edits don't collide.\n`
    : ''

  const assetBody = asset
    ? `\n## Expected asset\n\nThis agent typically produces a **${asset}**. After the work completes, confirm the artefact URL is reachable and pass it downstream so the Review node can evaluate it.\n`
    : ''

  return `---
name: ${slug}
description: Auto-generated Claude managed agent for Nexus capability "${capabilityId}"${asset ? ` producing ${asset} assets` : ''}. Created by the n8n strategist when a workflow step was dispatched with autoCreateAgent=true.
tools: Read, Edit, Grep, Glob, Bash, WebFetch, WebSearch
model: sonnet
transferable: true
${envBlock}---

You are the ${titleName} agent. You own workflow steps where the capability \`${capabilityId}\` is the primary skill.

## Responsibilities

- Take the inbound brief from the n8n dispatch (\`inputs.task\`, \`inputs.description\`, \`inputs.tools\`).
- Produce a concrete output (${asset ?? 'document or data payload'}) that downstream nodes can consume.
- Emit a JSON summary with at least: \`{ ok, artifactUrl?, notes }\`.

${swarmBody}${assetBody}
## Inputs (from the dispatch body)

- \`inputs.task\` — one-sentence description of what to do (e.g. "${taskHint}")
- \`inputs.description\` — idea description for broader context
- \`inputs.howItMakesMoney\` — the money model, so trade-offs align with it
- \`inputs.tools\` — suggested tools for this step
- \`inputs.upstream\` — whatever the previous n8n node produced

## Handoffs

- \`/supermemory\` — call after every non-trivial run so the work is archived.
- \`/workflow-optimizer\` — if the Review node flagged quality issues downstream.

## Fallback runtime

All tools in the frontmatter map to generic primitives (file read / edit, shell, web fetch). A non-Claude runtime can consume the same spec.

## Non-goals

- Do NOT exceed the scope of the dispatched task.
- Do NOT call external paid APIs without the owner's approval (paid ads, domain purchase, etc.). Defer those to Manual nodes in the parent workflow.
`
}

async function ensureAgentSpec(args: SpecTemplateArgs): Promise<{ created: boolean; path: string }> {
  const file = path.join(AGENTS_DIR, `${args.slug}.md`)
  if (await specExists(args.slug)) return { created: false, path: file }

  await fs.mkdir(AGENTS_DIR, { recursive: true })
  await fs.writeFile(file, renderSpec(args), 'utf8')
  return { created: true, path: file }
}

async function persistAgentToLibrary(opts: {
  userId:       string
  slug:         string
  description:  string
  systemPrompt: string
  envVars:      string[]
  sourcePath:   string
}): Promise<void> {
  const db = createServerClient()
  if (!db) return
  const record = {
    user_id:       opts.userId,
    slug:          opts.slug,
    name:          opts.slug,
    description:   opts.description,
    tools:         ['Read', 'Edit', 'Grep', 'Glob', 'Bash', 'WebFetch', 'WebSearch'],
    model:         'claude-sonnet-4-6',
    transferable:  true,
    env_vars:      opts.envVars,
    system_prompt: opts.systemPrompt,
    source_path:   opts.sourcePath,
    updated_at:    new Date().toISOString(),
  }
  try {
    await (db.from('agent_library' as never) as unknown as {
      upsert: (rec: unknown, opts: { onConflict: string }) => Promise<{ error: { message: string } | null }>
    })
      .upsert(record, { onConflict: 'user_id,slug' })
  } catch (err) {
    console.error('[claude-session/dispatch] agent_library upsert failed:', err)
  }
}

// ── OpenClaw gateway bridge ──────────────────────────────────────────────────

async function signPayload(body: string, hookToken: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(hookToken),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))
  return 'sha256=' + Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

async function dispatchToOpenClaw(opts: {
  agentSlug: string
  message:   string
  env:       Record<string, string>
}): Promise<{ ok: boolean; sessionId: string; status: number; body: unknown } | null> {
  const baseUrl   = process.env.OPENCLAW_GATEWAY_URL
  const hookToken = process.env.OPENCLAW_BEARER_TOKEN
  if (!baseUrl || !hookToken) return null

  const base      = baseUrl.replace(/\/$/, '')
  const sessionId = `nexus-agent-${opts.agentSlug}-${Date.now()}`
  const url       = `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`
  const bodyStr   = JSON.stringify({
    role:    'user',
    content: opts.message,
    agent:   opts.agentSlug,
    env:     opts.env,
  })

  const sig = await signPayload(bodyStr, hookToken)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type':      'application/json',
        'Authorization':     `Bearer ${hookToken}`,
        'X-Nexus-Signature': sig,
        'X-Nexus-Timestamp': Date.now().toString(),
      },
      body:    bodyStr,
      signal:  controller.signal,
    })
    clearTimeout(timer)
    let body: unknown
    try { body = await res.json() } catch { body = null }
    return { ok: res.ok, sessionId, status: res.status, body }
  } catch (err) {
    clearTimeout(timer)
    console.error('[claude-session/dispatch] OpenClaw error:', err)
    return { ok: false, sessionId, status: 0, body: null }
  }
}

function buildAgentBrief(body: DispatchBody, env: Record<string, string>): string {
  const inputs = body.inputs ?? {}
  const parts: string[] = [
    `Nexus session — agent ${body.agentSlug}.`,
    '',
    `Task: ${inputs.task ?? '(no task provided)'}`,
  ]
  if (inputs.description)     parts.push(`\nIdea description: ${inputs.description}`)
  if (inputs.howItMakesMoney) parts.push(`\nMoney model: ${inputs.howItMakesMoney}`)
  if (inputs.tools?.length)   parts.push(`\nSuggested tools: ${inputs.tools.join(', ')}`)
  if (body.asset)             parts.push(`\nExpected asset type: ${body.asset}`)
  if (body.swarm) {
    parts.push(
      `\nSwarm mode is ON (CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1). Break the task into ≥3 independent sub-tasks and coordinate a team of sub-agents with a shared task list.`,
    )
  }
  if (Object.keys(env).length) {
    parts.push(`\nSession env overrides: ${Object.entries(env).map(([k, v]) => `${k}=${v}`).join(', ')}`)
  }
  parts.push(`\nWhen complete, POST the artefact URL + summary to the Nexus hook so the workflow's Review node can evaluate it.`)
  return parts.join('\n')
}

// ── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'claude-dispatch' })
  if (!rl.success) return rateLimitResponse(rl)

  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: DispatchBody
  try {
    body = (await req.json()) as DispatchBody
  } catch {
    return NextResponse.json({ error: 'invalid json body' }, { status: 400 })
  }

  if (!body.agentSlug || !slugIsSafe(body.agentSlug)) {
    return NextResponse.json({ error: 'agentSlug must be lowercase, hyphenated, ≤ 60 chars' }, { status: 400 })
  }
  const capabilityId = body.capabilityId ?? 'consultant'
  const capability   = getCapability(capabilityId)
  if (!capability) {
    return NextResponse.json({ error: `unknown capabilityId: ${capabilityId}` }, { status: 400 })
  }
  const swarm = Boolean(body.swarm)
  const autoCreate = body.autoCreateAgent !== false
  const asset = body.asset && typeof body.asset === 'string' ? body.asset : null

  // 1. Ensure agent spec
  let created = false
  let specPath = path.join(AGENTS_DIR, `${body.agentSlug}.md`)
  if (autoCreate) {
    const res = await ensureAgentSpec({
      slug:         body.agentSlug,
      capabilityId,
      swarm,
      asset,
      taskHint:     body.inputs?.task ?? capability.description.slice(0, 80),
    })
    created = res.created
    specPath = res.path

    if (created) {
      const systemPrompt = await fs.readFile(specPath, 'utf8')
      await persistAgentToLibrary({
        userId,
        slug:         body.agentSlug,
        description:  `Auto-created for capability ${capabilityId}${asset ? ` (${asset})` : ''}${swarm ? ' — swarm enabled' : ''}`,
        systemPrompt,
        envVars:      swarm ? ['CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'] : [],
        sourcePath:   `.claude/agents/${body.agentSlug}.md`,
      })
    }
  } else {
    const exists = await specExists(body.agentSlug)
    if (!exists) {
      return NextResponse.json(
        { error: `agent spec .claude/agents/${body.agentSlug}.md not found and autoCreateAgent=false` },
        { status: 404 },
      )
    }
  }

  // 2. Build env
  const env = buildSessionEnv({ swarm })

  // 3. Dispatch to OpenClaw (if configured)
  const message = buildAgentBrief(body, env)
  const dispatch = await dispatchToOpenClaw({
    agentSlug: body.agentSlug,
    message,
    env,
  })

  audit(req, {
    action:     'claude.session.dispatch',
    resource:   'agent',
    resourceId: body.agentSlug,
    metadata:   {
      capabilityId,
      swarm,
      asset,
      created,
      dispatched: Boolean(dispatch?.ok),
    },
  })

  if (!dispatch) {
    // OpenClaw not configured — return 202 so the n8n run is not blocked.
    return NextResponse.json(
      {
        ok:          true,
        pending:     true,
        agentSlug:   body.agentSlug,
        swarm,
        envApplied:  env,
        created,
        note:        'OPENCLAW_GATEWAY_URL not configured — session queued. Run the agent manually in a Claude Code session with the spec at ' + `.claude/agents/${body.agentSlug}.md`,
      },
      { status: 202 },
    )
  }

  if (!dispatch.ok) {
    return NextResponse.json(
      {
        ok:         false,
        agentSlug:  body.agentSlug,
        sessionId:  dispatch.sessionId,
        swarm,
        envApplied: env,
        created,
        error:      `OpenClaw returned ${dispatch.status}`,
      },
      { status: dispatch.status === 401 ? 401 : 502 },
    )
  }

  return NextResponse.json({
    ok:          true,
    sessionId:   dispatch.sessionId,
    agentSlug:   body.agentSlug,
    swarm,
    envApplied:  env,
    created,
  })
}
