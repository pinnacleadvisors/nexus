/**
 * GET  /api/build/research   — Return recent research digests
 * POST /api/build/research   — Trigger research loop manually
 *
 * GET returns last 10 digests from Supabase or in-memory fallback.
 * POST sends 'build/research-loop' event to Inngest or runs directly if
 * Inngest isn't configured.
 */

import { auth } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { createServerClient } from '@/lib/supabase'
import { inngest } from '@/inngest/client'
import {
  getDigestsFromMemory,
  storeDigestInMemory,
  RESEARCH_QUERIES,
  type ResearchDigest,
  type ResearchSuggestion,
  type StackIssue,
} from '@/lib/build/research'
import { searchWebMulti } from '@/lib/tools/tavily'
import { anthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { tryGateway } from '@/lib/claw/llm'
import { exec as execCb } from 'child_process'
import { promisify } from 'util'

export const runtime = 'nodejs'
export const maxDuration = 60

const exec = promisify(execCb)

// ── Stack health (best effort) ────────────────────────────────────────────────
async function runAudit(): Promise<StackIssue[]> {
  try {
    const { stdout } = await exec('npm audit --json', {
      cwd: process.cwd(),
      timeout: 25_000,
    })
    const audit = JSON.parse(stdout) as {
      vulnerabilities?: Record<string, {
        severity: string
        via: Array<string | { title?: string }>
        fixAvailable: boolean | { name: string }
      }>
    }
    const vulns = audit.vulnerabilities ?? {}
    return Object.entries(vulns)
      .filter(([, v]) => v.severity !== 'low')
      .map(([pkg, v]) => {
        const via = v.via.find(x => typeof x === 'object' && x !== null)
        return {
          severity:     v.severity as StackIssue['severity'],
          package:      pkg,
          description:  (typeof via === 'object' && via !== null && 'title' in via)
            ? String(via.title) : `Vulnerability in ${pkg}`,
          fixAvailable: typeof v.fixAvailable === 'boolean' ? v.fixAvailable : Boolean(v.fixAvailable),
        }
      })
  } catch {
    return []
  }
}

// ── Claude synthesis ──────────────────────────────────────────────────────────
const SYNTHESIS_SYSTEM = `You are a senior engineer reviewing weekly tech research for the Nexus platform.
Nexus stack: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Clerk v7, Supabase, Vercel AI SDK 6, Anthropic Claude, Inngest, Tavily, Cloudflare R2, Stripe, Resend, lucide-react.

Given search results, output ONLY a valid JSON array — no prose, no markdown fences.
Each element: { "title": string (≤60 chars), "description": string (2 sentences), "category": "security"|"performance"|"cost"|"dx"|"deprecation"|"new-tool", "impact": "high"|"medium"|"low", "estimatedWork": "S"|"M"|"L", "sourceUrl": string, "sourceTitle": string }
Max 8 items. Only include items directly relevant to this stack.`

async function synthesise(
  results: Array<{ title: string; url: string; content: string }>,
  userId?: string,
): Promise<ResearchSuggestion[]> {
  if (results.length === 0) return []
  const context = results
    .map(r => `### ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 700)}`)
    .join('\n\n---\n\n')
  const userPrompt = `Research results:\n\n${context}\n\nOutput JSON array.`

  try {
    let text = ''
    if (userId) {
      const gw = await tryGateway({
        userId, system: SYNTHESIS_SYSTEM, prompt: userPrompt, sessionTag: 'build-research',
      })
      if (gw.ok) text = gw.text
    }
    if (!text) {
      if (!process.env.ANTHROPIC_API_KEY) return []
      const result = await generateText({
        model:           anthropic('claude-haiku-4-5-20251001'),
        system:          SYNTHESIS_SYSTEM,
        prompt:          userPrompt,
        maxOutputTokens: 2000,
        temperature:     0.1,
      })
      text = result.text
    }
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    const raw = JSON.parse(match[0]) as Array<Partial<ResearchSuggestion>>
    return raw.map(s => ({
      id:            crypto.randomUUID(),
      title:         s.title         ?? 'Untitled',
      description:   s.description   ?? '',
      category:      s.category      ?? 'dx',
      impact:        s.impact        ?? 'medium',
      estimatedWork: s.estimatedWork ?? 'M',
      sourceUrl:     s.sourceUrl     ?? '',
      sourceTitle:   s.sourceTitle   ?? '',
    }))
  } catch {
    return []
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '5')

  // Try Supabase first
  const db = createServerClient()
  if (db) {
    try {
      const { data } = await db
        .from('build_research')
        .select('*')
        .order('run_at', { ascending: false })
        .limit(limit)

      if (data && data.length > 0) {
        const digests: ResearchDigest[] = data.map(row => ({
          id:             String(row.id),
          runAt:          String(row.run_at),
          queriesRun:     (row.queries_run as string[]) ?? [],
          suggestions:    (row.suggestions as ResearchSuggestion[]) ?? [],
          stackIssues:    (row.stack_issues as StackIssue[]) ?? [],
          rawSearchCount: Number(row.raw_search_count) || 0,
          durationMs:     Number(row.duration_ms) || 0,
        }))
        return NextResponse.json({ digests, source: 'supabase' })
      }
    } catch { /* table may not exist yet — fall through to memory */ }
  }

  // Fallback to memory
  const digests = getDigestsFromMemory().slice(0, limit)
  return NextResponse.json({ digests, source: 'memory' })
}

// ── POST — trigger research run ───────────────────────────────────────────────
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 3, window: '10 m', prefix: 'build-research' })
  if (!rl.success) return rateLimitResponse(rl)

  // If Inngest is configured, dispatch the event (async, runs in background)
  if (process.env.INNGEST_EVENT_KEY) {
    try {
      await inngest.send({ name: 'build/research-loop', data: { triggeredBy: userId } })
      return NextResponse.json({ ok: true, mode: 'inngest', note: 'Research loop queued — check back in ~1 minute' })
    } catch {
      // Fall through to synchronous run
    }
  }

  // Synchronous run (no Inngest — runs inline, returns when done)
  const startedAt = Date.now()

  // Step 1: Tavily searches
  let searchResults: Array<{ title: string; url: string; content: string; score: number }> = []
  if (process.env.TAVILY_API_KEY) {
    try {
      searchResults = await searchWebMulti(RESEARCH_QUERIES.slice(0, 6), {
        maxResults:  3,
        searchDepth: 'basic',
        maxTokens:   6000,
      })
    } catch { /* non-fatal */ }
  }

  // Step 2: Stack health
  const stackIssues = await runAudit()

  // Step 3: Claude synthesis (gateway-billed when userId allowed)
  const suggestions = await synthesise(searchResults, userId)

  // Step 4: Create Board cards
  const db = createServerClient()
  if (db) {
    const toCreate = suggestions
      .filter(s => s.impact === 'high' || s.impact === 'medium')
      .slice(0, 5)

    for (const s of toCreate) {
      const { data: card } = await db
        .from('tasks')
        .insert({
          title:       `[Research] ${s.title}`,
          description: `${s.description}\n\nCategory: ${s.category} | Impact: ${s.impact} | Work: ${s.estimatedWork}\n\nSource: ${s.sourceUrl}`,
          column_id:   'backlog',
          priority:    s.impact === 'high' ? 'high' : 'medium',
          assignee:    'Research Loop',
          asset_url:   s.sourceUrl,
        })
        .select('id')
        .single()
      s.boardCardId = card?.id ?? null
    }

    for (const issue of stackIssues.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 3)) {
      await db.from('tasks').insert({
        title:       `[Security] ${issue.package}: ${issue.severity}`,
        description: `${issue.description}\n\nFix available: ${issue.fixAvailable ? 'Yes' : 'No'}\nRun: npm audit fix`,
        column_id:   'backlog',
        priority:    'high',
        assignee:    'Stack Health',
      })
    }
  }

  // Step 5: Save digest
  const digest: ResearchDigest = {
    id:             `digest-${Date.now()}`,
    runAt:          new Date().toISOString(),
    queriesRun:     RESEARCH_QUERIES.slice(0, 6),
    suggestions,
    stackIssues,
    rawSearchCount: searchResults.length,
    durationMs:     Date.now() - startedAt,
  }

  if (db) {
    try {
      await db.from('build_research').insert({
        run_at:           digest.runAt,
        queries_run:      digest.queriesRun,
        suggestions:      digest.suggestions as unknown,
        stack_issues:     digest.stackIssues as unknown,
        raw_search_count: digest.rawSearchCount,
        duration_ms:      digest.durationMs,
      })
    } catch { /* non-fatal */ }
  }
  storeDigestInMemory(digest)

  return NextResponse.json({
    ok:      true,
    mode:    'sync',
    digest,
  })
}
