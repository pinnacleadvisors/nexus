/**
 * lib/library/promoter.ts — C4
 *
 * Promotes outputs from a successful Run into the reusable building-block
 * library. Runs qualify when they hit `phase=done` with `metrics.ctr >=
 * CTR_THRESHOLD` OR `metrics.reviewRejects == 0`. Everything we promote is
 * tagged with `run:<id>` so the next similar goal lookup can find it and so
 * we can retroactively demote entries whose source run underperformed later.
 *
 * Fire-and-forget. A failed promotion must never block a run completion — the
 * loop can always re-promote from the event log on the next cron pass.
 */

import { createEntry, extractCodeBlocksFromOutput } from './client'
import type { Run } from '@/lib/types'
import type { CreateCodeSnippet, CreatePromptTemplate } from './types'

const CTR_THRESHOLD = 0.03   // 3% CTR — the industry-standard "good-enough" bar.
const MAX_SNIPPETS_PER_RUN = 5

/** Promotion decision — exported so tests and the UI can reuse the gate. */
export function shouldPromote(run: Run): boolean {
  if (run.phase !== 'done') return false
  if (run.status !== 'done') return false
  const m = run.metrics ?? {}
  if (typeof m.ctr === 'number' && m.ctr >= CTR_THRESHOLD) return true
  if (typeof m.reviewRejects === 'number' && m.reviewRejects === 0) return true
  return false
}

// ── Lazy imports to keep this module tree-shakeable ─────────────────────────
async function loadRunEvents(runId: string) {
  const { listEvents } = await import('@/lib/runs/controller')
  return listEvents(runId, 500)
}

/** Pull the final synthesis text out of a run's events. */
function findFinalOutput(events: Awaited<ReturnType<typeof loadRunEvents>>): string | null {
  // dispatch.completed payloads with an `output` field carry the agent text.
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i]
    if (ev.kind !== 'dispatch.completed') continue
    const out = (ev.payload as Record<string, unknown>).output
    if (typeof out === 'string' && out.length > 50) return out
  }
  return null
}

/** Pull the strategic prompt the run used (if any) from its events. */
function findPromptTemplate(events: Awaited<ReturnType<typeof loadRunEvents>>): string | null {
  for (const ev of events) {
    if (ev.kind !== 'dispatch.started') continue
    const prompt = (ev.payload as Record<string, unknown>).prompt
    if (typeof prompt === 'string' && prompt.length > 100) return prompt
  }
  return null
}

export interface PromotionResult {
  promoted: boolean
  reason:   string
  codeSnippets:    string[]
  promptTemplates: string[]
}

/**
 * Promote a run's outputs into the library. Returns a summary of what was
 * created so the caller can log it. Safe to call multiple times — each call
 * produces new rows tagged with the run id; dedupe happens on read via tags.
 */
export async function promoteRunToLibrary(run: Run): Promise<PromotionResult> {
  if (!shouldPromote(run)) {
    return { promoted: false, reason: 'thresholds not met', codeSnippets: [], promptTemplates: [] }
  }

  const events = await loadRunEvents(run.id).catch(() => [])
  const output = findFinalOutput(events)
  const prompt = findPromptTemplate(events)

  const runTag = `run:${run.id}`
  const metricTag = (run.metrics.ctr && run.metrics.ctr >= CTR_THRESHOLD)
    ? `ctr-hit`
    : `zero-rejects`

  const codeSnippetIds:    string[] = []
  const promptTemplateIds: string[] = []

  // 1. Code snippets — extracted from the final output
  if (output) {
    const blocks = extractCodeBlocksFromOutput(output).slice(0, MAX_SNIPPETS_PER_RUN)
    for (const b of blocks) {
      const payload: CreateCodeSnippet = {
        title:        `Promoted: ${b.language} snippet from run ${run.id.slice(0, 8)}`,
        description:  `Auto-promoted from a successful run (phase=${run.phase}, ${metricTag}).`,
        language:     normaliseLanguage(b.language),
        purpose:      'auto-promotion',
        code:         b.code,
        tags:         ['auto-promoted', runTag, metricTag],
        dependencies: [],
        source_agent_run: run.id,
      }
      try {
        const entry = await createEntry('code', run.userId, payload)
        codeSnippetIds.push(entry.id)
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[promoter] code snippet create failed:', err)
        }
      }
    }
  }

  // 2. Prompt template — the strategic prompt that led to a successful run
  if (prompt) {
    const payload: CreatePromptTemplate = {
      name:        `Promoted prompt — run ${run.id.slice(0, 8)}`,
      description: `Prompt from a run that hit its outcome thresholds (${metricTag}).`,
      template:    prompt,
      variables:   extractTemplateVariables(prompt),
      format:      'instruction',
      neuro_score: Math.round((run.metrics.ctr ?? 0) * 100),
      tags:        ['auto-promoted', runTag, metricTag],
    }
    try {
      const entry = await createEntry('prompt', run.userId, payload)
      promptTemplateIds.push(entry.id)
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[promoter] prompt template create failed:', err)
      }
    }
  }

  return {
    promoted:        codeSnippetIds.length + promptTemplateIds.length > 0,
    reason:          codeSnippetIds.length + promptTemplateIds.length > 0
      ? `promoted ${codeSnippetIds.length} code, ${promptTemplateIds.length} prompt`
      : 'no extractable artifacts',
    codeSnippets:    codeSnippetIds,
    promptTemplates: promptTemplateIds,
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────
type LibraryCodeLanguage = CreateCodeSnippet['language']
function normaliseLanguage(raw: string): LibraryCodeLanguage {
  const known: ReadonlyArray<LibraryCodeLanguage> = ['typescript','javascript','python','sql','bash','json','yaml']
  const l = raw.toLowerCase()
  const alias: Record<string, LibraryCodeLanguage> = {
    ts: 'typescript', js: 'javascript', py: 'python', sh: 'bash', shell: 'bash',
  }
  if (alias[l]) return alias[l]
  if ((known as readonly string[]).includes(l)) return l as LibraryCodeLanguage
  return 'typescript'
}

function extractTemplateVariables(template: string): string[] {
  const seen = new Set<string>()
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(template)) !== null) seen.add(m[1])
  return [...seen]
}
