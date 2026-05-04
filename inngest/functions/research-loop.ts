/**
 * inngest/functions/research-loop.ts
 * Phase 19b — Weekly research cron: searches for AI/dev updates, synthesises
 * suggestions with Claude, creates Board cards, runs stack health check.
 *
 * Schedule: every Sunday 09:00 UTC
 * Trigger manually: POST /api/build/research { action: 'trigger' }
 */

import { inngest } from '@/inngest/client'
import { callClaude } from '@/lib/claw/llm'
import { createServerClient } from '@/lib/supabase'
import { searchWebMulti } from '@/lib/tools/tavily'
import { insertTask } from '@/lib/board/insert-task'
import {
  RESEARCH_QUERIES,
  storeDigestInMemory,
  type ResearchSuggestion,
  type StackIssue,
  type ResearchDigest,
} from '@/lib/build/research'
import { exec as execCb } from 'child_process'
import { promisify } from 'util'

const exec = promisify(execCb)

// ── Claude synthesis prompt ───────────────────────────────────────────────────
const SYNTHESIS_SYSTEM = `You are a senior engineer reviewing weekly tech research for the Nexus platform.

Nexus stack: Next.js 16, React 19, TypeScript, Tailwind CSS 4, Clerk v7, Supabase (PostgreSQL), Vercel AI SDK 6, Anthropic Claude (Opus/Sonnet/Haiku), Inngest, Tavily, Cloudflare R2, Stripe, Resend, lucide-react.

Given search results, identify actionable suggestions. Output ONLY a JSON array — no prose, no markdown fences.

Each suggestion must have:
{
  "title": "Short action title (max 60 chars)",
  "description": "2-sentence description of what changed and why Nexus should care",
  "category": "security" | "performance" | "cost" | "dx" | "deprecation" | "new-tool",
  "impact": "high" | "medium" | "low",
  "estimatedWork": "S" | "M" | "L",
  "sourceUrl": "https://...",
  "sourceTitle": "Article or doc title"
}

Rules:
- Only include suggestions directly relevant to the Nexus stack
- Skip anything already implemented or clearly not applicable
- Max 8 suggestions per run
- Prefer high-impact items
- "security" category always high impact unless clearly minor
`

// ── Stack health check ────────────────────────────────────────────────────────
async function runStackHealthCheck(): Promise<StackIssue[]> {
  const issues: StackIssue[] = []

  // npm audit
  try {
    const { stdout } = await exec('npm audit --json', {
      cwd: process.cwd(),
      timeout: 30_000,
    })
    const audit = JSON.parse(stdout) as {
      vulnerabilities?: Record<string, {
        severity: string
        name: string
        via: Array<string | { title?: string }>
        fixAvailable: boolean | { name: string }
      }>
    }

    const vulns = audit.vulnerabilities ?? {}
    for (const [pkg, info] of Object.entries(vulns)) {
      if (info.severity === 'low') continue // skip low severity
      const via = Array.isArray(info.via)
        ? info.via.find(v => typeof v === 'object' && v !== null && 'title' in v)
        : null
      const desc = (typeof via === 'object' && via !== null && 'title' in via)
        ? String(via.title)
        : `Vulnerability in ${pkg}`

      issues.push({
        severity:     info.severity as StackIssue['severity'],
        package:      pkg,
        description:  desc,
        fixAvailable: typeof info.fixAvailable === 'boolean' ? info.fixAvailable : Boolean(info.fixAvailable),
      })
    }
  } catch {
    // npm audit not available in this environment — skip gracefully
  }

  return issues
}

// ── Main cron function ────────────────────────────────────────────────────────
export const weeklyResearchLoop = inngest.createFunction(
  {
    id:   'weekly-research-loop',
    name: 'Weekly Research Loop',
    // retries: 0 — every step in this function is wrapped in try/catch so
    // failures degrade to empty results, NOT thrown errors. Auto-retries
    // would just multiply Tavily quota burn (paid) and Anthropic tokens by
    // 3-4× without changing the outcome. See docs/RETRY_STORM_AUDIT.md
    // finding 2 (Inngest research-loop).
    retries: 0,
    triggers: [
      { cron: '0 9 * * 0' },           // Every Sunday 09:00 UTC
      { event: 'build/research-loop' }, // Manual trigger via POST /api/build/research
    ],
  },
  async ({ step }: { step: Record<string, (id: string, fn: () => Promise<unknown>) => Promise<unknown>> }) => {
    const startedAt = Date.now()

    // ── Step 1: Tavily searches ──────────────────────────────────────────────
    const searchResults = await step['run']('tavily-research', async () => {
      if (!process.env.TAVILY_API_KEY) return { results: [], count: 0 }

      // Sample 6 of the 10 queries to stay within API limits
      const queries = RESEARCH_QUERIES.slice(0, 6)
      try {
        const results = await searchWebMulti(queries, {
          maxResults:  3,
          searchDepth: 'basic',
          maxTokens:   6000,
        })
        return { results, count: results.length, queries }
      } catch {
        return { results: [], count: 0, queries }
      }
    }) as { results: Array<{ title: string; url: string; content: string; score: number }>; count: number; queries?: string[] }

    // ── Step 2: Stack health check ───────────────────────────────────────────
    const stackHealth = await step['run']('stack-health', async () => {
      const issues = await runStackHealthCheck()
      return { issues }
    }) as { issues: StackIssue[] }

    // ── Step 3: Claude synthesis ─────────────────────────────────────────────
    // Routed through `callClaude` (gateway → API → CLAUDE_MAX_ONLY guard).
    // The bot user owns this lane so the gateway's allowlist accepts the
    // dispatch even when no human session is active.
    const suggestions = await step['run']('synthesize-suggestions', async () => {
      if (searchResults.count === 0) return []
      const synthUserId = process.env.BOT_CLERK_USER_ID
        ?? process.env.OWNER_CLERK_USER_ID
        ?? ''
      if (!synthUserId) return [] // no identity → no dispatch

      const searchContext = searchResults.results
        .map(r => `### ${r.title}\nURL: ${r.url}\n${r.content.slice(0, 800)}`)
        .join('\n\n---\n\n')

      try {
        const result = await callClaude({
          userId:          synthUserId,
          system:          SYNTHESIS_SYSTEM,
          prompt:          `Research results from this week:\n\n${searchContext}\n\nOutput JSON array of suggestions.`,
          model:           'claude-haiku-4-5-20251001',
          sessionTag:      'research-loop',
          maxOutputTokens: 2000,
          temperature:     0.1,
        })
        if (result.error || !result.text) return []

        // Extract JSON from response
        const jsonMatch = result.text.match(/\[[\s\S]*\]/)
        if (!jsonMatch) return []
        return JSON.parse(jsonMatch[0]) as ResearchSuggestion[]
      } catch {
        return []
      }
    }) as ResearchSuggestion[]

    // ── Step 4: Create Board cards for high/medium impact suggestions ────────
    const boardResults = await step['run']('create-board-cards', async () => {
      const db = createServerClient()
      if (!db) return []

      const created: Array<{ suggestionId: string; cardId: string }> = []
      const toCreate = suggestions
        .filter(s => s.impact === 'high' || s.impact === 'medium')
        .slice(0, 5) // max 5 cards per run

      for (const s of toCreate) {
        // retry-storm-check: ignore — chained .insert().select('id').single()
        // because the caller needs the row id for boardCardId. insertTask
        // doesn't expose that. Function-level retries:0 caps amplification.
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

        if (card?.id) {
          created.push({ suggestionId: s.id ?? s.title, cardId: card.id })
          s.boardCardId = card.id
        }
      }

      // Also create high-priority cards for critical/high security issues
      for (const issue of stackHealth.issues.filter(i => i.severity === 'critical' || i.severity === 'high').slice(0, 3)) {
        await insertTask(db, {
          title:       `[Security] ${issue.package}: ${issue.severity} vulnerability`,
          description: `${issue.description}\n\nFix available: ${issue.fixAvailable ? 'Yes' : 'No'}\n\nRun: npm audit fix`,
          column_id:   'backlog',
          priority:    'high',
          assignee:    'Stack Health',
        })
      }

      return created
    }) as Array<{ suggestionId: string; cardId: string }>

    // ── Step 5: Save digest ──────────────────────────────────────────────────
    const digest: ResearchDigest = {
      id:             `digest-${Date.now()}`,
      runAt:          new Date().toISOString(),
      queriesRun:     (searchResults.queries ?? RESEARCH_QUERIES.slice(0, 6)),
      suggestions:    suggestions.map(s => ({
        id:            s.id ?? crypto.randomUUID(),
        title:         s.title,
        description:   s.description,
        category:      s.category,
        impact:        s.impact,
        estimatedWork: s.estimatedWork,
        sourceUrl:     s.sourceUrl,
        sourceTitle:   s.sourceTitle,
        boardCardId:   s.boardCardId ?? null,
      })),
      stackIssues:    stackHealth.issues,
      rawSearchCount: searchResults.count,
      durationMs:     Date.now() - startedAt,
    }

    await step['run']('save-digest', async () => {
      // Try Supabase first
      const db = createServerClient()
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
        } catch { /* non-fatal if table doesn't exist yet */ }
      }
      // Always save to memory as fallback
      storeDigestInMemory(digest)
      return { saved: true, suggestions: digest.suggestions.length }
    })

    return {
      suggestions: suggestions.length,
      stackIssues: stackHealth.issues.length,
      boardCards:  boardResults.length,
      durationMs:  Date.now() - startedAt,
    }
  },
)
