import { NextRequest, NextResponse } from 'next/server'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  UIMessage,
  type SystemModelMessage,
  type LanguageModelUsage,
} from 'ai'
import { auth } from '@clerk/nextjs/server'
import { searchPages as searchMemory, isMemoryConfigured } from '@/lib/memory/github'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'

export const maxDuration = 60
export const runtime = 'nodejs'

// ── Model cost table (USD per 1M tokens) ─────────────────────────────────────
// Cache read = ~10% of input price; cache write = ~25% of input price
const MODEL_COSTS: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  'claude-opus-4-6':          { input: 15,   output: 75,  cacheRead: 1.5,  cacheWrite: 3.75 },
  'claude-sonnet-4-6':        { input: 3,    output: 15,  cacheRead: 0.3,  cacheWrite: 0.75 },
  'claude-haiku-4-5-20251001':{ input: 0.8,  output: 4,   cacheRead: 0.08, cacheWrite: 0.2  },
}

function estimateCost(model: string, usage: LanguageModelUsage): number {
  const costs = MODEL_COSTS[model] ?? MODEL_COSTS['claude-sonnet-4-6']
  const noCacheIn  = usage.inputTokenDetails?.noCacheTokens  ?? usage.inputTokens  ?? 0
  const cacheRead  = usage.inputTokenDetails?.cacheReadTokens  ?? 0
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0
  const out        = usage.outputTokens ?? 0
  return (
    (noCacheIn  / 1_000_000) * costs.input      +
    (cacheRead  / 1_000_000) * costs.cacheRead   +
    (cacheWrite / 1_000_000) * costs.cacheWrite  +
    (out        / 1_000_000) * costs.output
  )
}

// ── System prompt ─────────────────────────────────────────────────────────────
// Kept as a const so the same bytes are always at the start of every request →
// Anthropic's prompt cache will hit on repeated calls.
const SYSTEM_PROMPT_TEXT = `You are a world-class business consulting agent operating inside the Nexus platform — an AI-powered business automation system.

Your role is to help the user refine and validate their business idea through thoughtful conversation. You act as a senior startup advisor with deep knowledge of lean startup methodology, market dynamics, product development, and growth strategy.

## Opening the conversation
If you do not yet know the user's budget, team size, or target market, ask about all three naturally within your opening reply — not as a numbered form, but woven into your response. Specifically gather:
- **Budget**: Roughly what budget do they have? (bootstrapped / under $10k / $10k–$50k / $50k–$250k / $250k+ / VC-funded)
- **Team**: What does their team look like? (solo / 1–2 co-founders / small team of 3–10 / larger org)
- **Market**: Who is the primary target customer? (B2B / B2C / prosumer / specific industry niche)

Once these are established, do not ask again — use them to inform all subsequent advice.

## Consulting approach
- Be direct and honest — challenge weak assumptions respectfully
- Help quantify opportunity size, competitive landscape, and realistic timelines
- Suggest the minimum viable product scope and prioritise ruthlessly
- Estimate rough costs and revenue potential with realistic ranges

## Milestone extraction
After each substantive response where you identify clear action items or project phases, append a structured block at the END of your message using this exact format:

<milestones>
[
  {
    "id": "m1",
    "title": "Market Validation",
    "description": "Interview 20 target customers to validate the core problem hypothesis.",
    "targetDate": "2026-05-01",
    "status": "pending",
    "phase": 1
  }
]
</milestones>

Rules for milestones:
- Only emit this block when you have enough context to define meaningful milestones
- Each milestone must have a unique id (m1, m2, m3... incrementing globally)
- Phase 1 = Foundation, Phase 2 = Build, Phase 3 = Launch, Phase 4 = Growth
- targetDate should be realistic based on today's date (2026-04-10)
- Maximum 6 milestones per message; accumulate across the conversation
- Only emit NEW milestones not already discussed

Keep your main response clear and conversational. The milestone JSON block is parsed separately — users will not see it directly.`

// ── Message text helper ───────────────────────────────────────────────────────
function getMessageText(msg: UIMessage): string {
  return msg.parts
    .filter(p => p.type === 'text')
    .map(p => (p as { type: 'text'; text: string }).text)
    .join('')
}

// ── Token efficiency: sliding window ─────────────────────────────────────────
// If conversation exceeds MSG_THRESHOLD, keep the most recent KEEP_RECENT
// messages and compress the older ones into a synopsis injected into the
// system prompt. This preserves context while drastically reducing token use.
const MSG_THRESHOLD = 20
const KEEP_RECENT   = 10

function applyMessageWindow(
  messages: UIMessage[],
  baseSystem: string,
): { system: SystemModelMessage; messages: UIMessage[] } {
  let systemContent = baseSystem

  if (messages.length > MSG_THRESHOLD) {
    const older  = messages.slice(0, messages.length - KEEP_RECENT)
    const recent = messages.slice(-KEEP_RECENT)

    const synopsis = older
      .map(m => {
        const txt = getMessageText(m)
          .replace(/<milestones>[\s\S]*?<\/milestones>/g, '')
          .trim()
          .slice(0, 300)
        return `[${m.role}]: ${txt}`
      })
      .join('\n')
      .slice(0, 3000)

    systemContent =
      `${baseSystem}\n\n---\n\n` +
      `**Prior conversation context** (${older.length} earlier messages, compressed for token efficiency):\n` +
      `${synopsis}\n\n---`

    messages = recent
  }

  // Mark system prompt for Anthropic prompt caching — this text is identical
  // across every request, so Anthropic will cache it after the first call.
  const system: SystemModelMessage = {
    role: 'system',
    content: systemContent,
    providerOptions: {
      anthropic: { cacheControl: { type: 'ephemeral' } },
    },
  }

  return { system, messages }
}

// ── Config resolution: env vars > cookie ─────────────────────────────────────
function resolveClawConfig(req: NextRequest): { gatewayUrl: string; token: string } | null {
  const envUrl   = process.env.OPENCLAW_GATEWAY_URL
  const envToken = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envToken) return { gatewayUrl: envUrl, token: envToken }

  const cookie = req.cookies.get('nexus_claw_cfg')
  if (!cookie) return null
  try {
    const { gatewayUrl, hookToken } = JSON.parse(cookie.value) as Record<string, string>
    if (gatewayUrl && hookToken) return { gatewayUrl, token: hookToken }
  } catch {
    return null
  }
  return null
}

// ── Build a flat text prompt for the OpenClaw path ───────────────────────────
function buildConversationPrompt(messages: UIMessage[], system: SystemModelMessage): string {
  const lines: string[] = [`${system.content}\n\n---`]
  for (const msg of messages) {
    const role = msg.role === 'user' ? 'User' : 'Assistant'
    const text = getMessageText(msg)
      .replace(/<milestones>[\s\S]*?<\/milestones>/g, '')
      .trim()
    lines.push(`${role}: ${text}`)
  }
  lines.push('Assistant:')
  return lines.join('\n\n')
}

// ── PRIMARY: OpenClaw (Claude Code CLI via MyClaw) ────────────────────────────
async function callOpenClaw(
  cfg: { gatewayUrl: string; token: string },
  prompt: string,
): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const url = `${cfg.gatewayUrl.replace(/\/$/, '')}/api/sessions/forge/messages`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 55_000)
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:  `Bearer ${cfg.token}`,
      },
      body:   JSON.stringify({ role: 'user', content: prompt }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Gateway ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}` }
    }

    const data = (await res.json()) as { content?: string; text?: string; response?: string }
    const text = data.content ?? data.text ?? data.response ?? JSON.stringify(data)
    return { ok: true, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { ok: false, error: msg.includes('abort') ? 'OpenClaw request timed out' : msg }
  }
}

// ── Memory RAG context injection ──────────────────────────────────────────────
// Search nexus-memory for context relevant to the latest user message and inject
// matching excerpts into the system prompt to avoid repeating prior research.
async function buildMemoryContext(messages: UIMessage[]): Promise<string> {
  if (!isMemoryConfigured()) return ''

  // Build a search query from the last user message
  const lastUser = [...messages].reverse().find(m => m.role === 'user')
  if (!lastUser) return ''
  const queryText = getMessageText(lastUser)
  if (queryText.trim().length < 5) return ''

  try {
    const results = await searchMemory(queryText.slice(0, 200), 3)
    if (results.length === 0) return ''
    const excerpts = results
      .filter(r => r.excerpt)
      .map(r => `**${r.path}**: ${r.excerpt}`)
      .join('\n\n')
    if (!excerpts) return ''
    return (
      `\n\n---\n\n## Project Knowledge Base\n` +
      `The following snippets from prior agent runs may be relevant. ` +
      `Use them to avoid repeating research and build on prior work:\n\n` +
      excerpts +
      `\n\n---`
    )
  } catch { return '' }
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // B1 — auth + per-user rate limit (20/min + 500/day) + audit
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rlMin = await rateLimit(req, { limit: 20,  window: '1 m', prefix: 'chat:min', identifier: userId })
  if (!rlMin.success) return rateLimitResponse(rlMin)
  const rlDay = await rateLimit(req, { limit: 500, window: '1 d', prefix: 'chat:day', identifier: userId })
  if (!rlDay.success) return rateLimitResponse(rlDay)

  const body = await req.json() as {
    messages:       UIMessage[]
    advisorModel?:  string
    executorModel?: string
  }

  const messages      = body.messages
  const advisorModel  = body.advisorModel  ?? 'claude-opus-4-6'
  const executorModel = body.executorModel ?? 'claude-sonnet-4-6'

  audit(req, {
    action: 'chat.stream',
    resource: 'chat',
    userId,
    metadata: { advisorModel, executorModel, messageCount: messages?.length ?? 0 },
  })

  // RAG: search nexus-memory for context relevant to this conversation
  const memoryContext = await buildMemoryContext(messages)
  const systemText    = memoryContext ? SYSTEM_PROMPT_TEXT + memoryContext : SYSTEM_PROMPT_TEXT

  // Apply sliding window + build cached system message
  const { system, messages: windowedMessages } = applyMessageWindow(messages, systemText)

  // ── PRIMARY: OpenClaw (Claude Code CLI) ──────────────────────────────────
  const clawCfg = resolveClawConfig(req)
  if (clawCfg) {
    const prompt = buildConversationPrompt(windowedMessages, system)
    const result = await callOpenClaw(clawCfg, prompt)

    if (result.ok) {
      const stream = createUIMessageStream({
        execute: writer => {
          writer.writer.write({ type: 'text-delta', id: 'text-0', delta: result.text })
        },
      })
      return createUIMessageStreamResponse({ stream })
    }

    console.warn('[chat] OpenClaw failed, falling back to API key:', result.error)
  }

  // ── SECONDARY: Anthropic API key (with model routing + caching) ──────────
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { anthropic } = await import('@ai-sdk/anthropic')
      const modelMessages = await convertToModelMessages(windowedMessages)

      // Use the advisor model (e.g. Opus) for strategic consulting.
      // The executor model is stored client-side and passed to agent dispatch calls.
      const sdkResult = streamText({
        model: anthropic(advisorModel),
        system,
        messages: modelMessages,
        onError: ({ error }) => {
          console.error('[chat/anthropic] stream error:', error)
        },
        onFinish: async ({ usage }) => {
          // ── Usage logging ─────────────────────────────────────────────────
          const cost = estimateCost(advisorModel, usage)
          const cached = usage.inputTokenDetails?.cacheReadTokens ?? 0
          const written = usage.inputTokenDetails?.cacheWriteTokens ?? 0

          console.log(
            `[chat] model=${advisorModel} exec=${executorModel} ` +
            `in=${usage.inputTokens} out=${usage.outputTokens} ` +
            `cache_read=${cached} cache_write=${written} ` +
            `cost=$${cost.toFixed(4)}`,
          )

          // ── Log to token-events table (fire-and-forget) ──────────────────
          // Imports are dynamic to avoid blocking the response
          Promise.resolve().then(async () => {
            try {
              const { createServerClient } = await import('@/lib/supabase')
              const db = createServerClient()
              if (!db) return

              await db.from('token_events').insert({
                model:         advisorModel,
                input_tokens:  usage.inputTokens  ?? 0,
                output_tokens: usage.outputTokens ?? 0,
                cost_usd:      cost,
              })
            } catch (err) {
              console.warn('[chat] token-events insert failed:', err)
            }
          })

          // ── Per-run cost alert ────────────────────────────────────────────
          const costThreshold = parseFloat(process.env.COST_ALERT_PER_RUN_USD ?? '0.50')
          if (cost > costThreshold) {
            console.warn(`[chat] cost alert: $${cost.toFixed(4)} exceeds per-run threshold of $${costThreshold}`)
            Promise.resolve().then(async () => {
              try {
                const { createServerClient } = await import('@/lib/supabase')
                const { sendSlackOrEmail } = await import('@/lib/alert-dispatch')
                const db = createServerClient()
                if (!db) return

                const { data: thresholds } = await db
                  .from('alert_thresholds')
                  .select('*')
                  .eq('enabled', true)
                  .eq('metric', 'daily_cost')

                for (const t of thresholds ?? []) {
                  await sendSlackOrEmail(
                    t,
                    `Single chat run cost $${cost.toFixed(4)} using ${advisorModel}, ` +
                    `exceeding the per-run alert threshold of $${costThreshold}.`,
                  )
                }
              } catch {
                // Alert dispatch failure is non-fatal
              }
            })
          }
        },
      })

      return sdkResult.toUIMessageStreamResponse()
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isServerError = msg.includes('500') || msg.includes('Internal server error')
      const stream = createUIMessageStream({
        execute: writer => {
          writer.writer.write({
            type: 'text-delta',
            id:   'text-0',
            delta: isServerError
              ? 'The AI provider is temporarily unavailable (Anthropic 500). Please try again in a moment.'
              : `AI error: ${msg}`,
          })
        },
      })
      return createUIMessageStreamResponse({ stream })
    }
  }

  // ── NEITHER configured ───────────────────────────────────────────────────
  const stream = createUIMessageStream({
    execute: writer => {
      writer.writer.write({
        type: 'text-delta',
        id:   'text-0',
        delta:
          'No AI provider is configured yet.\n\n' +
          '**Option 1 (recommended):** Connect your OpenClaw / MyClaw instance at [/tools/claw](/tools/claw) to use your Claude Pro subscription — no API key needed.\n\n' +
          '**Option 2:** Add an `ANTHROPIC_API_KEY` environment variable in Doppler or your `.env.local` file.',
      })
    },
  })
  return createUIMessageStreamResponse({ stream })
}
