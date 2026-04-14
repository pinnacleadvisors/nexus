/**
 * POST /api/build/dispatch
 * Dispatches an approved BuildPlan to OpenClaw (Claude Code) and creates a Board card.
 *
 * Body: { plan: BuildPlan, taskId?: string }
 * Returns: { ok, sessionId, boardCardId, branchUrl, dispatched, note? }
 */

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import type { BuildPlan } from '@/lib/build/types'

export const runtime = 'nodejs'

const CONFIG_COOKIE = 'nexus_claw_cfg'
const TIMEOUT_MS    = 25_000

// ── Config resolution (mirrors /api/claw/route.ts) ───────────────────────────
function resolveConfig(req: NextRequest): { gatewayUrl: string; token: string } | null {
  const envUrl   = process.env.OPENCLAW_GATEWAY_URL
  const envToken = process.env.OPENCLAW_BEARER_TOKEN
  if (envUrl && envToken) return { gatewayUrl: envUrl, token: envToken }

  const cookie = req.cookies.get(CONFIG_COOKIE)
  if (!cookie) return null
  try {
    const { gatewayUrl, hookToken } = JSON.parse(cookie.value) as Record<string, string>
    if (gatewayUrl && hookToken) return { gatewayUrl, token: hookToken }
  } catch { /* fall through */ }
  return null
}

// ── Build the Claude Code task message ───────────────────────────────────────
function buildClawMessage(plan: BuildPlan): string {
  const steps = [...plan.steps]
    .sort((a, b) => a.order - b.order)
    .map(s => `  ${s.order}. [${s.action}]${s.file ? ` (${s.file})` : ''}\n     ${s.description}`)
    .join('\n')

  return [
    `# Nexus Dev Task: ${plan.title}`,
    ``,
    `## Summary`,
    plan.summary,
    ``,
    `## Task Info`,
    `- Type: ${plan.type} | Complexity: ${plan.complexity} | Risk: ${plan.risk}`,
    `- Estimated: ${plan.estimatedMinutes} minutes`,
    ``,
    `## Steps to Execute`,
    steps,
    ``,
    `## Affected Files`,
    plan.affectedFiles.map(f => `  - ${f}`).join('\n'),
    ``,
    `## Git Instructions`,
    `- Create branch: \`${plan.branchName}\``,
    `- Commit message: \`${plan.commitMessage}\``,
    ``,
    `## Verification`,
    plan.testInstructions,
    ``,
    `## Coding Conventions (must follow)`,
    `- Next.js 16 App Router — all pages under app/, no pages/ directory`,
    `- Middleware is in proxy.ts (NOT middleware.ts)`,
    `- 'use client' required on any component with hooks or event handlers`,
    `- Tailwind CSS 4 — tokens in app/globals.css @theme inline {}, no tailwind.config.js`,
    `- All shared types in lib/types.ts or lib/<domain>/types.ts`,
    `- Icons: use lucide-react; verify icon exists before use`,
    `- AI SDK: useChat from @ai-sdk/react; streamText/convertToModelMessages from ai`,
    `- Secrets: via Doppler env vars — never hardcode`,
    `- recharts ResponsiveContainer: always wrap in dynamic(..., { ssr: false })`,
    `- Branch naming: claude/<kebab-slug>`,
    `- Commit format: conventional commits (feat:, fix:, docs:, refactor:)`,
    ``,
    `Please execute this task now:`,
    `1. Create branch \`${plan.branchName}\``,
    `2. Implement all steps above`,
    `3. Run \`npx tsc --noEmit\` — fix any type errors before committing`,
    `4. Commit with: \`${plan.commitMessage}\``,
    `5. Push the branch`,
  ].join('\n')
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 5, window: '1 m', prefix: 'build-dispatch' })
  if (!rl.success) return rateLimitResponse(rl)

  const body = await req.json() as { plan?: BuildPlan; taskId?: string }
  if (!body.plan?.title) {
    return NextResponse.json({ error: 'plan is required' }, { status: 400 })
  }

  const { plan } = body
  const sessionId = `nexus-build-${plan.branchName.replace('claude/', '')}-${Date.now()}`
  const branchUrl = `https://github.com/pinnacleadvisors/nexus/tree/${encodeURIComponent(plan.branchName)}`

  // ── Create Board card ──────────────────────────────────────────────────────
  let boardCardId: string | null = null
  const db = createServerClient()
  if (db) {
    const { data: card } = await db
      .from('tasks')
      .insert({
        title:       `[Build] ${plan.title}`,
        description: `${plan.summary}\n\nBranch: \`${plan.branchName}\`\nSession: ${sessionId}`,
        column_id:   'in-progress',
        priority:    plan.risk === 'high' ? 'high' : plan.risk === 'medium' ? 'medium' : 'low',
        assignee:    'Claude Code',
        asset_url:   branchUrl,
      })
      .select('id')
      .single()
    boardCardId = card?.id ?? null
  }

  // ── Dispatch to OpenClaw ───────────────────────────────────────────────────
  const cfg = resolveConfig(req)
  if (!cfg) {
    return NextResponse.json({
      ok:         true,
      sessionId,
      boardCardId,
      branchUrl,
      dispatched: false,
      note:       'OpenClaw not configured — board card created. Set OPENCLAW_GATEWAY_URL + OPENCLAW_BEARER_TOKEN to enable auto-dispatch.',
    })
  }

  const base    = cfg.gatewayUrl.replace(/\/$/, '')
  const url     = `${base}/api/sessions/${encodeURIComponent(sessionId)}/messages`
  const message = buildClawMessage(plan)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.token}`,
      },
      body:   JSON.stringify({ role: 'user', content: message }),
      signal: controller.signal,
    })
    clearTimeout(timer)

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return NextResponse.json({
        ok:         false,
        boardCardId,
        branchUrl,
        error:      `OpenClaw returned ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
      }, { status: 502 })
    }

    return NextResponse.json({ ok: true, sessionId, boardCardId, branchUrl, dispatched: true })
  } catch (err) {
    clearTimeout(timer)
    const msg = err instanceof Error ? err.message : 'Network error'
    const isTimeout = msg.includes('abort') || msg.includes('timeout')
    return NextResponse.json({
      ok:         false,
      boardCardId,
      branchUrl,
      error:      isTimeout ? 'Request timed out — is OpenClaw reachable?' : msg,
    }, { status: 502 })
  }
}
