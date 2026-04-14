/**
 * lib/library/seed.ts
 * Rich in-memory seed data for the Phase 15 library layer.
 * Used as fallback when Supabase is not configured.
 */

import type {
  CodeSnippet,
  AgentTemplate,
  PromptTemplate,
  SkillDefinition,
} from './types'

const NOW = new Date().toISOString()
const SYSTEM_USER = 'system'

// ── Code snippets ─────────────────────────────────────────────────────────────
export const SEED_CODE_SNIPPETS: CodeSnippet[] = [
  {
    id: 'cs-001',
    user_id: SYSTEM_USER,
    title: 'Supabase paginated query',
    description: 'Fetches rows from any Supabase table with cursor-based pagination and typed result.',
    language: 'typescript',
    purpose: 'database',
    code: `import { createClient } from '@supabase/supabase-js'

export async function paginatedQuery<T>(
  table: string,
  pageSize = 20,
  cursor?: string
): Promise<{ rows: T[]; nextCursor: string | null }> {
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  let q = sb.from(table).select('*').limit(pageSize).order('created_at', { ascending: false })
  if (cursor) q = q.lt('created_at', cursor)

  const { data, error } = await q
  if (error) throw error

  const rows = (data ?? []) as T[]
  const nextCursor = rows.length === pageSize
    ? (rows[rows.length - 1] as Record<string, string>).created_at
    : null

  return { rows, nextCursor }
}`,
    tags: ['supabase', 'pagination', 'database', 'typescript'],
    dependencies: ['@supabase/supabase-js'],
    usage_count: 14,
    avg_quality_score: 0.91,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'cs-002',
    user_id: SYSTEM_USER,
    title: 'Streaming Claude API route',
    description: 'Next.js App Router route handler that streams Claude Sonnet responses using Vercel AI SDK.',
    language: 'typescript',
    purpose: 'ai',
    code: `import { anthropic } from '@ai-sdk/anthropic'
import { convertToModelMessages, streamText } from 'ai'
import type { UIMessage } from 'ai'
import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const { messages, system } = (await req.json()) as {
    messages: UIMessage[]
    system?: string
  }

  const result = streamText({
    model: anthropic('claude-sonnet-4-6'),
    system: system ?? 'You are a helpful assistant.',
    messages: await convertToModelMessages(messages),
    maxTokens: 4096,
  })

  return result.toUIMessageStreamResponse()
}`,
    tags: ['ai', 'streaming', 'claude', 'next.js', 'api'],
    dependencies: ['ai', '@ai-sdk/anthropic'],
    usage_count: 31,
    avg_quality_score: 0.95,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'cs-003',
    user_id: SYSTEM_USER,
    title: 'Rate limiter (in-memory)',
    description: 'Sliding-window in-memory rate limiter keyed by IP. Safe for single-instance deployments.',
    language: 'typescript',
    purpose: 'security',
    code: `const store = new Map<string, { count: number; reset: number }>()

export function rateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now()
  const entry = store.get(key)

  if (!entry || now > entry.reset) {
    store.set(key, { count: 1, reset: now + windowMs })
    return true
  }

  if (entry.count >= max) return false

  entry.count++
  return true
}`,
    tags: ['security', 'rate-limit', 'api', 'typescript'],
    dependencies: [],
    usage_count: 8,
    avg_quality_score: 0.87,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'cs-004',
    user_id: SYSTEM_USER,
    title: 'DnD Kit Kanban move helper',
    description: 'Pure functions for moving cards within or between Kanban columns using @dnd-kit/sortable.',
    language: 'typescript',
    purpose: 'ui',
    code: `import { arrayMove } from '@dnd-kit/sortable'

type ColumnMap<T> = Record<string, T[]>

export function getId(item: { id: string }) { return item.id }

export function findColumn<T extends { id: string }>(
  itemId: string,
  columns: ColumnMap<T>,
): string | null {
  for (const [colId, items] of Object.entries(columns)) {
    if (items.some(i => i.id === itemId)) return colId
  }
  return null
}

export function moveWithinColumn<T extends { id: string }>(
  columns: ColumnMap<T>,
  colId: string,
  activeId: string,
  overId: string,
): ColumnMap<T> {
  const items = columns[colId]
  const from  = items.findIndex(i => i.id === activeId)
  const to    = items.findIndex(i => i.id === overId)
  return { ...columns, [colId]: arrayMove(items, from, to) }
}

export function moveBetweenColumns<T extends { id: string }>(
  columns: ColumnMap<T>,
  fromCol: string,
  toCol: string,
  activeId: string,
  overIndex: number,
): ColumnMap<T> {
  const item    = columns[fromCol].find(i => i.id === activeId)!
  const updated = { ...columns }
  updated[fromCol] = updated[fromCol].filter(i => i.id !== activeId)
  const dest = [...updated[toCol]]
  dest.splice(overIndex, 0, item)
  updated[toCol] = dest
  return updated
}`,
    tags: ['dnd', 'kanban', 'ui', 'typescript'],
    dependencies: ['@dnd-kit/sortable'],
    usage_count: 6,
    avg_quality_score: 0.88,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'cs-005',
    user_id: SYSTEM_USER,
    title: 'Clerk JWT user extraction',
    description: 'Extracts the Clerk user ID from the request in an API route; returns 401 if unauthenticated.',
    language: 'typescript',
    purpose: 'auth',
    code: `import { auth } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'

export async function requireUser(): Promise<
  { userId: string } | NextResponse
> {
  const { userId } = await auth()
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return { userId }
}`,
    tags: ['auth', 'clerk', 'security', 'typescript'],
    dependencies: ['@clerk/nextjs'],
    usage_count: 22,
    avg_quality_score: 0.93,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'cs-006',
    user_id: SYSTEM_USER,
    title: 'useLocalStorageState hook',
    description: 'React hook that syncs state to localStorage with SSR safety and JSON serialisation.',
    language: 'typescript',
    purpose: 'ui',
    code: `'use client'
import { useState, useEffect } from 'react'

export function useLocalStorageState<T>(
  key: string,
  initialValue: T,
): [T, (value: T) => void] {
  const [state, setState] = useState<T>(initialValue)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(key)
      if (stored !== null) setState(JSON.parse(stored) as T)
    } catch {}
  }, [key])

  function setValue(value: T) {
    setState(value)
    try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
  }

  return [state, setValue]
}`,
    tags: ['react', 'hooks', 'localStorage', 'typescript'],
    dependencies: [],
    usage_count: 11,
    avg_quality_score: 0.89,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
]

// ── Agent templates ───────────────────────────────────────────────────────────
export const SEED_AGENT_TEMPLATES: AgentTemplate[] = [
  {
    id: 'at-001',
    user_id: SYSTEM_USER,
    name: 'Market Research Analyst',
    role: 'Senior market research analyst with expertise in competitive intelligence and TAM sizing',
    system_prompt: `You are a senior market research analyst. When given a product or business idea:
1. Estimate TAM, SAM, SOM with sources
2. Identify top 5 competitors with positioning matrix
3. Spot 3 underserved customer segments
4. Output a structured markdown report with an executive summary

Always cite data sources. Flag assumptions clearly. Output milestones in <milestones>...</milestones> tags.`,
    constraints: [
      'Cite all data; mark estimates with (est.)',
      'No more than 1500 words total',
      'Use tables for comparisons',
      'Flag missing data rather than fabricate',
    ],
    output_format: 'markdown',
    example_output: '# Market Analysis: {Product}\n\n## Executive Summary\n...',
    model: 'claude-sonnet-4-6',
    tags: ['research', 'market', 'competitive', 'analysis'],
    version: 2,
    usage_count: 18,
    avg_quality_score: 0.92,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'at-002',
    user_id: SYSTEM_USER,
    name: 'Technical Spec Writer',
    role: 'Senior software architect writing detailed technical specifications',
    system_prompt: `You are a senior software architect. Given a feature description:
1. Write an RFC-style technical specification
2. Define data models, API contracts, and sequence diagrams (as text)
3. Identify risks and open questions
4. Estimate implementation complexity (S/M/L/XL)

Use ADR (Architecture Decision Record) format for major decisions. Be precise about edge cases.`,
    constraints: [
      'Prefer concrete types over vague descriptions',
      'All API endpoints must include request/response shapes',
      'Call out breaking changes explicitly',
      'Include a "Non-goals" section',
    ],
    output_format: 'markdown',
    example_output: '# Technical Spec: {Feature}\n\n## Overview\n...',
    model: 'claude-sonnet-4-6',
    tags: ['engineering', 'spec', 'architecture', 'documentation'],
    version: 1,
    usage_count: 12,
    avg_quality_score: 0.94,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'at-003',
    user_id: SYSTEM_USER,
    name: 'Growth Copywriter',
    role: 'Performance copywriter specialising in SaaS landing pages and email sequences',
    system_prompt: `You are a growth-focused copywriter. When given a product and target audience:
1. Write headline + sub-headline options (3 variants each)
2. Craft the hero section copy (problem → solution → proof)
3. Write 3 email subject lines for a cold outreach sequence
4. Generate a 5-email drip sequence outline

Use AIDA framework. Aim for Flesch reading score > 60. Avoid jargon.`,
    constraints: [
      'No more than 20 words per headline',
      'Use active voice',
      'Include at least one social-proof hook',
      'No buzzwords: revolutionary, game-changing, disruptive',
    ],
    output_format: 'markdown',
    example_output: '# Copy Pack: {Product}\n\n## Headlines\n...',
    model: 'claude-sonnet-4-6',
    tags: ['marketing', 'copy', 'email', 'landing-page'],
    version: 1,
    usage_count: 24,
    avg_quality_score: 0.90,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'at-004',
    user_id: SYSTEM_USER,
    name: 'Legal Risk Reviewer',
    role: 'In-house counsel reviewing contracts and business documents for risk',
    system_prompt: `You are an in-house counsel. Review the provided document and:
1. Identify the top 5 legal risks ranked by severity
2. Flag missing standard clauses (liability cap, IP assignment, termination)
3. Suggest plain-English rewrites for problematic clauses
4. Rate overall risk: LOW / MEDIUM / HIGH

Preface all output with: "This is not legal advice."
Be conservative — flag things that look off even if not definitively wrong.`,
    constraints: [
      'Always lead with the disclaimer',
      'Cite specific clause numbers',
      'Use RISK: prefix for each identified risk',
      'Suggest rewrites in blockquotes',
    ],
    output_format: 'markdown',
    example_output: '> This is not legal advice.\n\n# Contract Review\n...',
    model: 'claude-sonnet-4-6',
    tags: ['legal', 'contracts', 'risk', 'compliance'],
    version: 1,
    usage_count: 7,
    avg_quality_score: 0.88,
    auto_extracted: false,
    created_at: NOW,
    updated_at: NOW,
  },
]

// ── Prompt templates ──────────────────────────────────────────────────────────
export const SEED_PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'pt-001',
    user_id: SYSTEM_USER,
    name: 'Milestone extractor',
    description: 'Extracts structured project milestones from a free-text project description or plan.',
    template: `Analyse the following project description and extract actionable milestones.

PROJECT DESCRIPTION:
{{description}}

Return the milestones inside <milestones> XML tags as a JSON array:
<milestones>
[
  {
    "id": "m1",
    "title": "string",
    "description": "string",
    "targetDate": "YYYY-MM-DD or null",
    "status": "pending",
    "phase": 1
  }
]
</milestones>

Then write a 2-sentence plain-English summary of the overall project arc.`,
    variables: ['description'],
    format: 'structured',
    neuro_score: 82,
    tags: ['milestones', 'planning', 'extraction', 'json'],
    usage_count: 34,
    avg_quality_score: 0.91,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'pt-002',
    user_id: SYSTEM_USER,
    name: 'Competitor analysis — few-shot',
    description: 'Few-shot prompt that produces a structured competitor comparison table.',
    template: `Compare competitors for: {{product_name}} in the {{market}} market.

EXAMPLES:
---
Product: Notion
Market: Note-taking / productivity
Output:
| Competitor | Pricing | Strengths | Weaknesses |
|---|---|---|---|
| Evernote | $14.99/mo | Legacy brand | Outdated UX |
| Obsidian | Free + $8/mo | Powerful linking | Steep learning curve |
---

Now do the same for {{product_name}} in the {{market}} market.
Add a "Best for" column. List at most {{max_competitors}} competitors.`,
    variables: ['product_name', 'market', 'max_competitors'],
    format: 'few-shot',
    neuro_score: 76,
    tags: ['competitors', 'analysis', 'table', 'market'],
    usage_count: 19,
    avg_quality_score: 0.87,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'pt-003',
    user_id: SYSTEM_USER,
    name: 'Chain-of-thought debugger',
    description: 'Walks through a bug step-by-step using chain-of-thought reasoning before proposing a fix.',
    template: `You are debugging the following issue. Think step by step before proposing a fix.

LANGUAGE: {{language}}
ERROR MESSAGE:
{{error}}

RELEVANT CODE:
\`\`\`{{language}}
{{code}}
\`\`\`

CONTEXT: {{context}}

Chain-of-thought:
1. What is the error type and what does it mean?
2. Which line(s) is most likely responsible?
3. What are 2-3 possible root causes?
4. Which root cause is most likely and why?

PROPOSED FIX:
\`\`\`{{language}}
// Fixed code here
\`\`\`

EXPLANATION: (1-2 sentences on why this fixes it)`,
    variables: ['language', 'error', 'code', 'context'],
    format: 'chain-of-thought',
    neuro_score: 88,
    tags: ['debugging', 'code', 'chain-of-thought', 'engineering'],
    usage_count: 27,
    avg_quality_score: 0.93,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'pt-004',
    user_id: SYSTEM_USER,
    name: 'Launch announcement email',
    description: 'Generates a product launch announcement email optimised for open rates.',
    template: `Write a product launch announcement email for {{product_name}}.

Target audience: {{audience}}
Key benefit: {{key_benefit}}
Launch date: {{launch_date}}
Call to action: {{cta}}

Structure:
- Subject line (under 50 chars, curiosity-driven)
- Preview text (under 90 chars)
- Body: hook → problem → solution → social proof → CTA
- P.S. line

Tone: {{tone}}
Length: under 300 words`,
    variables: ['product_name', 'audience', 'key_benefit', 'launch_date', 'cta', 'tone'],
    format: 'instruction',
    neuro_score: 79,
    tags: ['email', 'marketing', 'launch', 'copywriting'],
    usage_count: 15,
    avg_quality_score: 0.85,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'pt-005',
    user_id: SYSTEM_USER,
    name: 'Code review checklist',
    description: 'Performs a structured code review against a predefined checklist.',
    template: `Review the following {{language}} code against this checklist:

CODE:
\`\`\`{{language}}
{{code}}
\`\`\`

CHECKLIST:
- [ ] Security: SQL injection, XSS, CSRF, secrets in code
- [ ] Error handling: all error paths handled, no silent failures
- [ ] Types: strong typing, no unsafe casts
- [ ] Performance: N+1 queries, unnecessary re-renders, memory leaks
- [ ] Readability: function names, magic numbers, comments where needed
- [ ] Tests: critical paths covered

For each failing item, quote the relevant line and suggest a fix.
Summarise with: APPROVED / NEEDS CHANGES / MAJOR ISSUES`,
    variables: ['language', 'code'],
    format: 'structured',
    neuro_score: 84,
    tags: ['code-review', 'security', 'quality', 'engineering'],
    usage_count: 21,
    avg_quality_score: 0.90,
    created_at: NOW,
    updated_at: NOW,
  },
]

// ── Skill definitions ─────────────────────────────────────────────────────────
export const SEED_SKILL_DEFINITIONS: SkillDefinition[] = [
  {
    id: 'sk-001',
    user_id: SYSTEM_USER,
    name: 'web_search',
    description: 'Search the web for current information using Tavily API. Returns top-k results with snippets.',
    mcp_tool_name: 'tavily_search',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', default: 5 },
        search_depth: { type: 'string', enum: ['basic', 'advanced'], default: 'basic' },
      },
      required: ['query'],
    },
    output_schema: {
      type: 'object',
      properties: {
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              url: { type: 'string' },
              content: { type: 'string' },
              score: { type: 'number' },
            },
          },
        },
      },
    },
    requires_openclaw: false,
    risk_level: 'low',
    tags: ['search', 'web', 'research', 'tavily'],
    usage_count: 45,
    avg_quality_score: 0.88,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'sk-002',
    user_id: SYSTEM_USER,
    name: 'notion_create_page',
    description: 'Create a new page in a Notion database with full markdown content support.',
    mcp_tool_name: 'notion_create_page',
    input_schema: {
      type: 'object',
      properties: {
        database_id: { type: 'string', description: 'Notion database ID' },
        title: { type: 'string' },
        content: { type: 'string', description: 'Markdown content' },
        properties: { type: 'object', description: 'Additional database properties' },
      },
      required: ['database_id', 'title'],
    },
    output_schema: {
      type: 'object',
      properties: {
        page_id: { type: 'string' },
        url: { type: 'string' },
        created_at: { type: 'string' },
      },
    },
    requires_openclaw: true,
    risk_level: 'low',
    tags: ['notion', 'knowledge-base', 'documentation', 'write'],
    usage_count: 29,
    avg_quality_score: 0.91,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'sk-003',
    user_id: SYSTEM_USER,
    name: 'github_create_issue',
    description: 'Create a GitHub issue with labels, assignees, and milestone from agent output.',
    mcp_tool_name: 'github_create_issue',
    input_schema: {
      type: 'object',
      properties: {
        owner: { type: 'string' },
        repo: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string', description: 'Markdown body' },
        labels: { type: 'array', items: { type: 'string' } },
        assignees: { type: 'array', items: { type: 'string' } },
        milestone: { type: 'number' },
      },
      required: ['owner', 'repo', 'title'],
    },
    output_schema: {
      type: 'object',
      properties: {
        issue_number: { type: 'number' },
        html_url: { type: 'string' },
        state: { type: 'string', enum: ['open', 'closed'] },
      },
    },
    requires_openclaw: true,
    risk_level: 'medium',
    tags: ['github', 'issues', 'project-management', 'devops'],
    usage_count: 17,
    avg_quality_score: 0.87,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'sk-004',
    user_id: SYSTEM_USER,
    name: 'send_email',
    description: 'Send a transactional or marketing email via Resend with HTML or markdown body.',
    mcp_tool_name: 'resend_send',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'array', items: { type: 'string' }, description: 'Recipient addresses' },
        subject: { type: 'string' },
        html: { type: 'string', description: 'HTML body (optional if markdown provided)' },
        markdown: { type: 'string', description: 'Markdown body (auto-converted to HTML)' },
        from: { type: 'string', description: 'Sender address (defaults to configured from)' },
        reply_to: { type: 'string' },
      },
      required: ['to', 'subject'],
    },
    output_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Resend message ID' },
        queued: { type: 'boolean' },
      },
    },
    requires_openclaw: false,
    risk_level: 'medium',
    tags: ['email', 'resend', 'communication', 'marketing'],
    usage_count: 11,
    avg_quality_score: 0.85,
    created_at: NOW,
    updated_at: NOW,
  },
  {
    id: 'sk-005',
    user_id: SYSTEM_USER,
    name: 'execute_bash',
    description: 'Execute a bash command in the OpenClaw sandbox. Returns stdout, stderr, and exit code.',
    mcp_tool_name: 'bash',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeout_ms: { type: 'number', default: 30000 },
        cwd: { type: 'string', description: 'Working directory' },
      },
      required: ['command'],
    },
    output_schema: {
      type: 'object',
      properties: {
        stdout: { type: 'string' },
        stderr: { type: 'string' },
        exit_code: { type: 'number' },
        duration_ms: { type: 'number' },
      },
    },
    requires_openclaw: true,
    risk_level: 'high',
    tags: ['bash', 'shell', 'automation', 'openclaw'],
    usage_count: 33,
    avg_quality_score: 0.82,
    created_at: NOW,
    updated_at: NOW,
  },
]
