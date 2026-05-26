/**
 * @nexus/mcp-codex-delegate — Phase 2c of task_plan-chat.md.
 *
 * Exposes a single MCP tool — `delegate_to_codex` — that runs inside any
 * Claude Code session loaded on the claude-gateway. The platform-copilot
 * agent calls it to hand off execution-heavy work to the codex-gateway
 * running on KVM2 (GPT-5.5 sandboxed per ADR 002):
 *
 *   - container/docker debugging
 *   - sysadmin (apt-install / systemd / Coolify health)
 *   - fresh-state SaaS research (current UIs change weekly, training data is stale)
 *   - deploy-script scaffolding
 *
 * Why a dedicated MCP tool (vs. a free-text "delegate to codex" instruction)
 * ─────────────────────────────────────────────────────────────────────────
 * Before this tool, "delegating to codex" was a soft-instruction in the
 * agent spec — the agent would describe the task to the operator and ask
 * them to manually copy it into the codex chat tab. Two problems:
 *   1. Slow + lossy: the operator becomes the message bus.
 *   2. No tool-call card: chat UI couldn't render codex transcripts inline.
 *
 * This tool is callable directly. The result lands as a tool_result event
 * that the gateway captures (services/claude-gateway/src/spawn.ts Phase 2b)
 * and the platform-chat UI renders as a `ToolCallCard` showing the codex
 * transcript inline — operator sees what was delegated, what codex did,
 * and the final answer without leaving the platform-copilot conversation.
 *
 * Protocol
 * ────────
 * Enqueue:  POST   ${CODEX_GATEWAY_URL}/api/jobs
 *           Authorization:      Bearer ${CODEX_GATEWAY_BEARER_TOKEN}
 *           X-Nexus-Signature:  sha256=<hmac of body, bearer>
 *           X-Nexus-Timestamp:  <ms epoch>
 *           Content-Type:       application/json
 *           Body: { role:'user', content:<task>, agent:<slug?>, env:{...} }
 *
 * Poll:     GET ${CODEX_GATEWAY_URL}/api/jobs/:jobId
 *           Authorization: Bearer ${CODEX_GATEWAY_BEARER_TOKEN}
 *
 * Returns the full final assistant message + usage metadata so the caller
 * (and the UI) can render the entire codex thought chain.
 *
 * Required env
 * ────────────
 *   CODEX_GATEWAY_URL            — base URL of the codex-gateway (e.g.
 *                                   https://codex-gateway.example.com)
 *   CODEX_GATEWAY_BEARER_TOKEN   — shared bearer; gateway also enforces
 *                                   the HMAC + replay-window check
 *
 * Optional env
 * ────────────
 *   CODEX_DELEGATE_TIMEOUT_MS    — total poll budget per call (default
 *                                   5min). Long codex tasks (research,
 *                                   debugging) routinely take 1-3 min.
 *   CODEX_DELEGATE_POLL_MS       — interval between poll ticks (default 3s)
 *   NEXUS_OPERATOR_USER_ID       — forwarded as X-Nexus-User-Id so the
 *                                   codex-gateway's ALLOWED_USER_IDS check
 *                                   passes (single-user-mode convenience)
 */
import { createHmac } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

const GATEWAY_URL    = (process.env.CODEX_GATEWAY_URL ?? '').replace(/\/$/, '')
const BEARER         = process.env.CODEX_GATEWAY_BEARER_TOKEN ?? ''
const OPERATOR_USER  = process.env.NEXUS_OPERATOR_USER_ID
  ?? (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)[0]
  ?? ''
const TIMEOUT_MS     = Number(process.env.CODEX_DELEGATE_TIMEOUT_MS ?? 5 * 60_000)
const POLL_MS        = Number(process.env.CODEX_DELEGATE_POLL_MS    ?? 3_000)

// Audit sink — `/api/audit/tool-call` on the parent Nexus app. Wired by the
// E3-partial follow-up (task_plan-platform-expansion.md) so every MCP tool
// invocation lands in the unified `tool_call_audit` table the operator sees
// at /audit. Soft-fail: when AUDIT_BASE / AUDIT_TOKEN are unset, recordAudit
// drops the row with a single console.warn rather than throwing.
const AUDIT_BASE     = (process.env.NEXUS_AUDIT_BASE_URL ?? '').replace(/\/$/, '')
const AUDIT_TOKEN    = process.env.NEXUS_AUDIT_TOKEN ?? ''
const AGENT_SLUG     = process.env.NEXUS_AGENT_SLUG ?? 'platform-copilot'

function fatal(msg: string): never {
  console.error('[codex-delegate] ' + msg)
  process.exit(2)
}

if (!GATEWAY_URL) fatal('CODEX_GATEWAY_URL is required')
if (!BEARER)      fatal('CODEX_GATEWAY_BEARER_TOKEN is required')

async function recordAudit(payload: Record<string, unknown>): Promise<void> {
  if (!AUDIT_BASE) return
  try {
    await fetch(`${AUDIT_BASE}/api/audit/tool-call`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(AUDIT_TOKEN ? { 'X-Audit-Token': AUDIT_TOKEN } : {}),
      },
      body:    JSON.stringify({ mcp_server: 'codex-delegate', agent_slug: AGENT_SLUG, scope: 'admin', ...payload }),
      signal:  AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[codex-delegate] audit POST failed:', err instanceof Error ? err.message : err)
  }
}

function sign(bodyText: string, secret: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(bodyText).digest('hex')
}

interface EnqueueResponse {
  ok?:     boolean
  jobId?:  string
  status?: string
  error?:  string
}

interface JobStatusResponse {
  ok?:         boolean
  status?:     'pending' | 'running' | 'done' | 'error'
  agent?:      string | null
  sessionTag?: string | null
  createdAt?:  number
  startedAt?:  number
  finishedAt?: number
  result?:     { ok?: boolean; content?: string; usage?: unknown; durationMs?: number; error?: string }
  error?:      string
}

async function enqueueJob(content: string, agentSlug: string | null, sessionTag: string): Promise<{ jobId: string }> {
  const body = JSON.stringify({
    role:    'user',
    content,
    agent:   agentSlug,
    env:     {},
  })
  const headers: Record<string, string> = {
    'Content-Type':      'application/json',
    'Authorization':     `Bearer ${BEARER}`,
    'X-Nexus-Signature': sign(body, BEARER),
    'X-Nexus-Timestamp': Date.now().toString(),
    'X-Nexus-Session-Tag': sessionTag,
  }
  if (OPERATOR_USER) headers['X-Nexus-User-Id'] = OPERATOR_USER

  const res = await fetch(`${GATEWAY_URL}/api/jobs`, {
    method:  'POST',
    headers,
    body,
    signal:  AbortSignal.timeout(10_000),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`codex enqueue failed: ${res.status} ${text.slice(0, 500)}`)
  }
  let parsed: EnqueueResponse
  try { parsed = JSON.parse(text) as EnqueueResponse }
  catch { throw new Error(`codex enqueue returned non-JSON: ${text.slice(0, 200)}`) }
  if (!parsed.jobId) throw new Error(`codex enqueue: no jobId in response: ${text.slice(0, 200)}`)
  return { jobId: parsed.jobId }
}

async function pollJob(jobId: string): Promise<JobStatusResponse> {
  const headers: Record<string, string> = { 'Authorization': `Bearer ${BEARER}` }
  if (OPERATOR_USER) headers['X-Nexus-User-Id'] = OPERATOR_USER
  const res = await fetch(`${GATEWAY_URL}/api/jobs/${encodeURIComponent(jobId)}`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  })
  const text = await res.text().catch(() => '')
  if (!res.ok) {
    throw new Error(`codex poll failed: ${res.status} ${text.slice(0, 500)}`)
  }
  try { return JSON.parse(text) as JobStatusResponse }
  catch { throw new Error(`codex poll returned non-JSON: ${text.slice(0, 200)}`) }
}

async function delegateToCodex(task: string, agentSlug: string | null): Promise<{ content: string; durationMs: number; jobId: string; usage?: unknown; agent: string | null }> {
  const sessionTag = `mcp-delegate-${Date.now().toString(36).slice(-6)}`
  const { jobId } = await enqueueJob(task, agentSlug, sessionTag)
  const start = Date.now()
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise(r => setTimeout(r, POLL_MS))
    const job = await pollJob(jobId)
    if (job.status === 'done') {
      const content = job.result?.content ?? ''
      if (job.result?.ok === false) {
        throw new Error(`codex job errored: ${job.result.error ?? 'unspecified'}`)
      }
      return {
        content,
        durationMs: job.result?.durationMs ?? (Date.now() - start),
        jobId,
        usage:      job.result?.usage,
        agent:      job.agent ?? agentSlug,
      }
    }
    if (job.status === 'error') {
      throw new Error(`codex job errored: ${job.result?.error ?? job.error ?? 'unspecified'}`)
    }
    // status === 'pending' | 'running' — keep polling
  }
  throw new Error(`codex delegation timed out after ${Math.round(TIMEOUT_MS / 1000)}s (jobId=${jobId}). The job may still be running on the gateway — check Coolify logs for codex-gateway.`)
}

// ── MCP server ───────────────────────────────────────────────────────────────

/** Redact env-sourced strings so they don't land in logs verbatim. */
function redact(value: string | undefined | null): string {
  if (!value) return '(unset)'
  return value.length > 8 ? `${value.slice(0, 6)}…(redacted)` : '(set)'
}

async function main() {
  // Redact env-derived values to satisfy CodeQL js/clear-text-logging — the
  // prefix is enough for "did it start up with the right gateway?" debugging
  // without dumping the full URL / operator id to log aggregators.
  console.error(
    '[codex-delegate] startup ' +
    `gateway=${redact(GATEWAY_URL)} ` +
    `timeout=${TIMEOUT_MS}ms ` +
    `poll=${POLL_MS}ms ` +
    `operator=${redact(OPERATOR_USER)}`,
  )

  const server = new Server(
    { name: 'codex-delegate', version: '0.1.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'delegate_to_codex',
        description: [
          'Delegate an execution-heavy task to the codex-operator agent running on the codex-gateway (KVM2 sandbox, GPT-5.5 per ADR 002). Use when the task is execution-heavy rather than design-heavy:',
          '  • container/docker debugging ("why does the claude-gateway container OOM on boot?")',
          '  • sysadmin ("install postgres 16 on KVM4 and report the connection string")',
          '  • fresh-state SaaS research ("current Cloudflare Zero Trust UI for setting up a service token")',
          '  • deploy-script scaffolding',
          '  • full-stack smoke tests via Playwright (once Phase 7 lands)',
          '',
          'Do NOT use for design decisions, architectural reviews, or anything that mutates platform state — those stay on the platform-copilot side with explicit approval cards. Codex is a contractor, not an architect.',
          '',
          'Returns the codex transcript including its final answer. The UI renders this as a ToolCallCard so the operator sees the entire delegation inline.',
        ].join('\n'),
        inputSchema: {
          type: 'object',
          properties: {
            task: {
              type: 'string',
              description: 'Self-contained task brief for codex. Include all context — codex has no memory of the platform-copilot conversation. State what to do, what files/services to touch, and what successful output looks like.',
            },
            agent: {
              type: 'string',
              description: 'Optional codex agent slug (e.g. "codex-operator", "codex-maintainer"). Defaults to "codex-operator" — the general-purpose execution agent. Use "codex-maintainer" only for sysadmin/health-check style work where its narrower budget matters.',
            },
          },
          required: ['task'],
          additionalProperties: false,
        },
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params
    const args = (rawArgs ?? {}) as Record<string, unknown>
    const start = Date.now()

    if (name === 'delegate_to_codex') {
      const task = String(args.task ?? '').trim()
      if (!task) {
        await recordAudit({ tool_name: name, args, result_status: 'error', result: { error: 'task is required' }, latency_ms: Date.now() - start })
        throw new Error('task is required')
      }
      const agent = typeof args.agent === 'string' && args.agent.trim()
        ? args.agent.trim()
        : 'codex-operator'
      try {
        const out = await delegateToCodex(task, agent)
        const summary = [
          `# Codex delegation result`,
          ``,
          `**Agent:** ${out.agent ?? agent}`,
          `**Duration:** ${(out.durationMs / 1000).toFixed(1)}s`,
          `**Job:** ${out.jobId}`,
          ``,
          `---`,
          ``,
          out.content || '(codex returned an empty final message — usually means it finished without writing a synthesis)',
        ].join('\n')
        await recordAudit({
          tool_name:     name,
          args:          { task: task.slice(0, 500), agent },
          result_status: 'ok',
          result:        { jobId: out.jobId, durationMs: out.durationMs, contentLength: (out.content ?? '').length },
          latency_ms:    Date.now() - start,
        })
        return {
          content: [{ type: 'text', text: summary }],
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        await recordAudit({
          tool_name:     name,
          args:          { task: task.slice(0, 500), agent },
          result_status: 'error',
          result:        { error: msg },
          latency_ms:    Date.now() - start,
        })
        return {
          content: [{ type: 'text', text: `Codex delegation failed: ${msg}` }],
          isError: true,
        }
      }
    }

    await recordAudit({ tool_name: name, args, result_status: 'error', result: { error: 'unknown tool' }, latency_ms: Date.now() - start })
    throw new Error(`unknown tool: ${name}`)
  })

  await server.connect(new StdioServerTransport())
  console.error('[codex-delegate] MCP server ready (stdio transport)')
}

main().catch(err => { console.error('[codex-delegate] fatal:', err); process.exit(1) })
