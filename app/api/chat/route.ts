import { NextRequest } from 'next/server'
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  streamText,
  UIMessage,
} from 'ai'

export const maxDuration = 60
export const runtime = 'nodejs'

const SYSTEM_PROMPT = `You are a world-class business consulting agent operating inside the Nexus platform — an AI-powered business automation system.

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
- targetDate should be realistic based on today's date (2026-04-09)
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
const MSG_THRESHOLD = 20
const KEEP_RECENT = 10

function applyMessageWindow(messages: UIMessage[]): { system: string; messages: UIMessage[] } {
  if (messages.length <= MSG_THRESHOLD) {
    return { system: SYSTEM_PROMPT, messages }
  }

  const older = messages.slice(0, messages.length - KEEP_RECENT)
  const recent = messages.slice(-KEEP_RECENT)

  // Compact synopsis of the older messages (strip milestone JSON to save tokens)
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

  const systemWithContext =
    `${SYSTEM_PROMPT}\n\n---\n\n` +
    `**Prior conversation context** (${older.length} earlier messages, compressed for context efficiency):\n` +
    `${synopsis}\n\n---`

  return { system: systemWithContext, messages: recent }
}

// ── Config resolution: env vars > cookie ─────────────────────────────────────
function resolveClawConfig(req: NextRequest): { gatewayUrl: string; token: string } | null {
  const envUrl = process.env.OPENCLAW_GATEWAY_URL
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
function buildConversationPrompt(messages: UIMessage[], system: string): string {
  const lines: string[] = [`${system}\n\n---`]
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
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`,
      },
      body: JSON.stringify({ role: 'user', content: prompt }),
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

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  // Apply sliding window compression for long conversations
  const { system, messages: windowedMessages } = applyMessageWindow(messages)

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

  // ── SECONDARY: Anthropic API key ─────────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const { anthropic } = await import('@ai-sdk/anthropic')
      const modelMessages = await convertToModelMessages(windowedMessages)
      const sdkResult = streamText({
        model: anthropic('claude-sonnet-4-6'),
        system,
        messages: modelMessages,
        onError: ({ error }) => {
          console.error('[chat/anthropic] stream error:', error)
        },
      })
      return sdkResult.toUIMessageStreamResponse()
    } catch (err) {
      // Anthropic threw synchronously (bad key, network, etc.) — stream a friendly error
      const msg = err instanceof Error ? err.message : String(err)
      const isServerError = msg.includes('500') || msg.includes('Internal server error')
      const stream = createUIMessageStream({
        execute: writer => {
          writer.writer.write({
            type: 'text-delta',
            id: 'text-0',
            delta: isServerError
              ? 'The AI provider is temporarily unavailable (Anthropic 500). Please try again in a moment.'
              : `AI error: ${msg}`,
          })
        },
      })
      return createUIMessageStreamResponse({ stream })
    }
  }

  // ── NEITHER configured — stream a helpful setup message ──────────────────
  const stream = createUIMessageStream({
    execute: writer => {
      writer.writer.write({
        type: 'text-delta',
        id: 'text-0',
        delta:
          'No AI provider is configured yet.\n\n' +
          '**Option 1 (recommended):** Connect your OpenClaw / MyClaw instance at [/tools/claw](/tools/claw) to use your Claude Pro subscription — no API key needed.\n\n' +
          '**Option 2:** Add an `ANTHROPIC_API_KEY` environment variable in Doppler or your `.env.local` file.',
      })
    },
  })
  return createUIMessageStreamResponse({ stream })
}
