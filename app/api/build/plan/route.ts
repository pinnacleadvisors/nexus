/**
 * POST /api/build/plan
 * Streams a Claude Opus development plan for the given request.
 *
 * Body: { type: 'feature' | 'bug' | 'error', description: string, fileTree?: string }
 *
 * Returns: streaming text — a JSON BuildPlan object wrapped in <plan>...</plan> tags,
 * preceded by a human-readable summary for display during streaming.
 */

import { auth } from '@clerk/nextjs/server'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import type { BuildRequestType } from '@/lib/build/types'

export const maxDuration = 60
export const runtime = 'nodejs'

// ── Coding conventions injected into every plan ───────────────────────────────
const NEXUS_CONVENTIONS = `
## Nexus Coding Conventions (must follow)
- Next.js 16 App Router — all pages under app/, no pages/ directory
- Middleware is in proxy.ts (NOT middleware.ts)
- 'use client' required on any component with hooks or event handlers
- Tailwind CSS 4 — tokens in app/globals.css @theme inline {}, no tailwind.config.js
- All shared types in lib/types.ts or lib/<domain>/types.ts
- Icons: use lucide-react; verify icon exists before use
- AI SDK: useChat from @ai-sdk/react; streamText/convertToModelMessages from ai
- Secrets: via Doppler env vars — never hardcode
- recharts ResponsiveContainer: always wrap in dynamic(..., { ssr: false })
- Branch naming: claude/<kebab-slug>
- Commit format: conventional commits (feat:, fix:, docs:, refactor:)
`.trim()

const SYSTEM_PROMPT = `You are a senior full-stack engineer tasked with planning development work on the Nexus platform.

Given a feature request, bug report, or error, you will:
1. Write a brief human-readable analysis (2-3 sentences)
2. Produce a structured JSON plan inside <plan>...</plan> tags

${NEXUS_CONVENTIONS}

The JSON plan must match this TypeScript type exactly:
\`\`\`typescript
interface BuildPlan {
  title: string              // short title (max 60 chars)
  summary: string            // 2-sentence summary of what will change
  type: 'feature' | 'bug' | 'error'
  complexity: 'S' | 'M' | 'L' | 'XL'  // S=<1hr, M=1-4hr, L=4-8hr, XL=8hr+
  risk: 'low' | 'medium' | 'high'
  affectedFiles: string[]    // relative paths from repo root
  steps: Array<{
    order: number
    action: string           // e.g. "Edit lib/tools/tavily.ts"
    description: string      // what specifically to change/add
    file?: string            // primary file for this step
  }>
  branchName: string         // format: claude/<kebab-slug-max-40-chars>
  commitMessage: string      // conventional commit format
  testInstructions: string   // how to verify the change worked
  estimatedMinutes: number   // realistic estimate
}
\`\`\`

Always output the human-readable analysis FIRST, then the <plan>...</plan> block.
The JSON inside the tags must be valid, minified, and complete.`

function buildUserPrompt(
  type: BuildRequestType,
  description: string,
  fileTree: string,
): string {
  const typeLabel = type === 'feature' ? 'Feature Request'
    : type === 'bug'  ? 'Bug Report'
    : 'Error / Stack Trace'

  return [
    `## ${typeLabel}\n\n${description}`,
    fileTree ? `\n\n## Current File Tree (top-level)\n\`\`\`\n${fileTree}\n\`\`\`` : '',
    '\n\nProduce the analysis and JSON plan now.',
  ].join('')
}

export async function POST(req: Request) {
  const { userId } = await auth()
  if (!userId) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })

  const rl = await rateLimit(req as Parameters<typeof rateLimit>[0], { limit: 10, window: '1 m', prefix: 'build-plan' })
  if (!rl.success) return rateLimitResponse(rl)

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const body = await req.json() as {
    type: BuildRequestType
    description: string
    fileTree?: string
  }

  if (!body.description?.trim()) {
    return new Response(JSON.stringify({ error: 'description is required' }), { status: 400 })
  }

  const result = streamText({
    model:           anthropic('claude-opus-4-6'),
    system:          SYSTEM_PROMPT,
    messages: [{
      role:    'user',
      content: buildUserPrompt(body.type ?? 'feature', body.description, body.fileTree ?? ''),
    }],
    maxOutputTokens: 4096,
    temperature:     0.2,
  })

  return result.toTextStreamResponse()
}
