/**
 * lib/signals/council.ts
 *
 * The LLM council that triages a signal. Five sequential roles:
 *
 *   1. scout     — Firecrawl scrape (skipped when no URL or Firecrawl unset)
 *   2. memory    — checks roadmap + molecular index for overlap
 *   3. architect — synergy + integration sketch against AGENTS.md / STACK.md
 *   4. tester    — surface area + regression risk
 *   5. judge     — synthesises 1–4 into a verdict {accepted|rejected|deferred}
 *
 * Each role calls `callClaude` (the gateway → API fallback chokepoint) with a
 * focused system prompt. The judge's verdict is parsed and mirrored onto
 * `signals.status` + `signals.decided_reason`. Every role's reasoning is
 * persisted to `signal_evaluations` so the trail is auditable later.
 *
 * Sequential, not parallel: the self-hosted gateway is single-worker FIFO, so
 * fan-out provides no speed-up — it just risks 504s on long Sonnet calls.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'

import { callClaude } from '@/lib/claw/llm'
import {
  createEvaluation,
  getSignalWithEvaluations,
  updateSignal,
} from './client'
import { scrapeForCouncil, isFirecrawlConfigured } from './firecrawl'
import type { CouncilRole, Signal, SignalStatus } from './types'

const COUNCIL_MODEL = 'claude-sonnet-4-6'
const MEMORY_FILES  = [
  'memory/roadmap/SUMMARY.md',
  'memory/roadmap/PENDING.md',
  'memory/molecular/INDEX.md',
]
const MAX_MEMORY_CHARS = 6_000   // per file, keeps prompt under gateway limit

// ── Memory loader ────────────────────────────────────────────────────────────
async function loadMemorySnapshot(): Promise<string> {
  const cwd = process.cwd()
  const parts: string[] = []
  for (const rel of MEMORY_FILES) {
    try {
      const full = await fs.readFile(path.join(cwd, rel), 'utf8')
      const slice = full.length > MAX_MEMORY_CHARS ? full.slice(0, MAX_MEMORY_CHARS) + '\n…[truncated]' : full
      parts.push(`# ${rel}\n${slice}`)
    } catch {
      parts.push(`# ${rel}\n[not present in deployment]`)
    }
  }
  return parts.join('\n\n---\n\n')
}

function signalAsContext(signal: Signal, scoutMd?: string | null): string {
  const lines = [
    `Kind:   ${signal.kind}`,
    `Title:  ${signal.title}`,
  ]
  if (signal.url)  lines.push(`URL:    ${signal.url}`)
  if (signal.body) lines.push(`Body:\n${signal.body}`)
  if (scoutMd)     lines.push(`\nScraped page (truncated):\n${scoutMd}`)
  return lines.join('\n')
}

// ── Verdict parser ───────────────────────────────────────────────────────────
export interface JudgeVerdict {
  status: SignalStatus     // 'accepted' | 'rejected' | 'deferred'
  reason: string
}

const VALID_JUDGE_STATUSES: SignalStatus[] = ['accepted', 'rejected', 'deferred']

export function parseJudgeVerdict(text: string): JudgeVerdict | null {
  // Try a fenced JSON block first, then any JSON object in the text.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [
    fence?.[1],
    text.match(/\{[\s\S]*"status"[\s\S]*\}/)?.[0],
  ].filter(Boolean) as string[]

  for (const raw of candidates) {
    try {
      const parsed = JSON.parse(raw.trim()) as { status?: string; reason?: string }
      if (parsed.status && (VALID_JUDGE_STATUSES as string[]).includes(parsed.status)) {
        return {
          status: parsed.status as SignalStatus,
          reason: (parsed.reason ?? '').trim() || 'no reason provided',
        }
      }
    } catch { /* try next */ }
  }
  return null
}

// ── Single-role caller ───────────────────────────────────────────────────────
interface RoleSpec {
  role:    CouncilRole
  system:  string
  prompt:  string
}

interface RoleResult {
  role:      CouncilRole
  reasoning: string
  verdict?:  string
  via:       'gateway' | 'api' | 'error'
}

async function runRole(userId: string, signalId: string, spec: RoleSpec): Promise<RoleResult> {
  const result = await callClaude({
    userId,
    system:           spec.system,
    prompt:           spec.prompt,
    model:            COUNCIL_MODEL,
    sessionTag:       `signals:${spec.role}`,
    temperature:      0.3,
    maxOutputTokens:  1_200,
    timeoutMs:        50_000,
  })
  const reasoning = result.error
    ? `[${spec.role} call failed: ${result.error}]`
    : (result.text || '[empty response]')

  await createEvaluation(userId, {
    signalId,
    role:      spec.role,
    reasoning,
    model:     COUNCIL_MODEL,
  })
  return { role: spec.role, reasoning, via: result.error ? 'error' : result.via }
}

// ── Public entry point ───────────────────────────────────────────────────────
export interface ProcessSignalResult {
  signalId:    string
  status:      SignalStatus
  reason?:     string
  rolesRun:    CouncilRole[]
  scrapeUsed:  boolean
  error?:      string
}

export async function processSignal(signal: Signal): Promise<ProcessSignalResult> {
  // Mark in flight so concurrent crons don't double-process.
  await updateSignal(signal.id, { status: 'triaging' })

  try {
    return await runCouncil(signal)
  } catch (err) {
    // Hard failure (timeout, transport error). Revert to 'new' so the next
    // cron pass picks it up automatically — without this the row would be
    // stuck in 'triaging' since listNewSignals only returns 'new'.
    await updateSignal(signal.id, { status: 'new' }).catch(() => undefined)
    throw err
  }
}

async function runCouncil(signal: Signal): Promise<ProcessSignalResult> {
  const rolesRun: CouncilRole[] = []
  let scrapeUsed = false
  let scoutMd: string | null = null

  // 1. Scout — only when URL + Firecrawl both present
  if (signal.url && isFirecrawlConfigured()) {
    const scrape = await scrapeForCouncil(signal.url)
    if (scrape) {
      scoutMd = `${scrape.title ? `**${scrape.title}**\n\n` : ''}${scrape.markdown}`
      scrapeUsed = true
      await createEvaluation(signal.userId, {
        signalId:  signal.id,
        role:      'scout',
        reasoning: `Scraped ${scrape.url}${scrape.truncated ? ' (truncated)' : ''}\n\n${scoutMd.slice(0, 1_500)}`,
      })
      rolesRun.push('scout')
    }
  }

  const memorySnapshot = await loadMemorySnapshot()
  const ctx = signalAsContext(signal, scoutMd)

  // 2. Memory
  const memory = await runRole(signal.userId, signal.id, {
    role: 'memory',
    system:
      'You are the Nexus Memory reviewer. Given a candidate platform-improvement signal and the current platform memory ' +
      '(roadmap summary, pending items, molecular knowledge graph index), determine whether this signal is ALREADY ' +
      'covered by an existing roadmap item, ADR, or shipped feature. Be specific — cite the exact file path and line(s) ' +
      'when you find overlap. Output 4-8 sentences. Do NOT decide acceptance — only assess overlap and freshness.',
    prompt:
      `# Signal\n${ctx}\n\n---\n\n# Platform memory snapshot\n${memorySnapshot}\n\n---\n\n` +
      'Is this signal already covered? If yes, point to the file. If partially, name the gap.',
  })
  rolesRun.push('memory')

  // 3. Architect
  const architect = await runRole(signal.userId, signal.id, {
    role: 'architect',
    system:
      'You are the Nexus Architect. The platform is Next.js 16 (App Router) + Tailwind 4 + Clerk + Supabase + Vercel AI SDK 6, ' +
      'with a Claude Code gateway on Coolify. The North Star is autonomous business management with minimal owner oversight. ' +
      'Given a candidate signal, write a synergy + integration sketch: which existing files/routes/agents it should hook into, ' +
      'whether it duplicates anything, what new module path you would create, and any breaking changes it would require. ' +
      'Output 5-10 sentences and a short bullet list of "Files to touch". Stay grounded — only suggest patterns the codebase already uses.',
    prompt:
      `# Signal\n${ctx}\n\n---\n\n# Memory reviewer notes\n${memory.reasoning}\n\n---\n\n` +
      'Sketch the integration. Where does this fit with minimal disruption?',
  })
  rolesRun.push('architect')

  // 4. Tester
  const tester = await runRole(signal.userId, signal.id, {
    role: 'tester',
    system:
      'You are the Nexus Tester. Assess regression risk and surface area for a candidate platform change. List the ' +
      'specific user-visible flows that could break, the test coverage gaps, and the rollout risk. Be concrete: ' +
      'name the components, the API routes, the migrations. Output 4-8 sentences and a short risk grade ("low" | "medium" | "high").',
    prompt:
      `# Signal\n${ctx}\n\n---\n\n# Architect sketch\n${architect.reasoning}\n\n---\n\n` +
      'What is the regression risk and which flows must be re-tested?',
  })
  rolesRun.push('tester')

  // 5. Judge
  const judge = await runRole(signal.userId, signal.id, {
    role: 'judge',
    system:
      'You are the Nexus Judge. Synthesise the Memory, Architect, and Tester reviews into a single verdict. ' +
      'Decision options:\n' +
      '  - "accepted"  — clearly worth building soon; promote to roadmap PENDING\n' +
      '  - "rejected"  — already covered, off-strategy, or net-negative\n' +
      '  - "deferred"  — good but blocked, premature, or low ROI right now\n\n' +
      'Bias: favour "deferred" over "accepted" when value is real but the moment is wrong. ' +
      'Bias: favour "rejected" only when overlap is concrete or the change conflicts with the North Star ' +
      '(autonomous business management with minimal owner oversight).\n\n' +
      'Output a SINGLE fenced JSON block with EXACTLY this schema:\n' +
      '```json\n{ "status": "accepted" | "rejected" | "deferred", "reason": "<2-3 sentence justification citing the prior roles>" }\n```\n' +
      'No prose outside the fenced block.',
    prompt:
      `# Signal\n${ctx}\n\n---\n\n# Memory reviewer\n${memory.reasoning}\n\n` +
      `# Architect\n${architect.reasoning}\n\n# Tester\n${tester.reasoning}\n\n---\n\n` +
      'Render the verdict JSON now.',
  })
  rolesRun.push('judge')

  const parsed = parseJudgeVerdict(judge.reasoning)
  if (!parsed) {
    // Couldn't parse — leave as triaging so the operator can review manually.
    return {
      signalId:   signal.id,
      status:     'triaging',
      rolesRun,
      scrapeUsed,
      error:      'judge verdict unparseable',
    }
  }

  await updateSignal(signal.id, {
    status:        parsed.status,
    decidedReason: parsed.reason,
    decidedAt:     new Date().toISOString(),
  })

  // Re-write the judge evaluation with the parsed verdict so the UI can colour
  // it. (We could PATCH the row, but a fresh row keeps the audit trail simple.)
  await createEvaluation(signal.userId, {
    signalId:  signal.id,
    role:      'judge',
    verdict:   parsed.status,
    reasoning: parsed.reason,
    model:     `${COUNCIL_MODEL}:parsed`,
  })

  return {
    signalId:   signal.id,
    status:     parsed.status,
    reason:     parsed.reason,
    rolesRun,
    scrapeUsed,
  }
}

/** Re-export for callers (e.g. cron) that want the council scaffolding. */
export async function getProcessedSignal(signalId: string) {
  return getSignalWithEvaluations(signalId)
}
