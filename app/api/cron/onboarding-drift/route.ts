/**
 * GET/POST /api/cron/onboarding-drift
 *
 * Weekly cron. Compares env-var rows in `memory/platform/SECRETS.md` against
 * those documented in `docs/ONBOARDING.md`. When new vars are added to
 * SECRETS.md but not surfaced in the onboarding doc, files a workflow_feedback
 * row so the doc gets updated.
 *
 * Self-improvement loop 7.1 in task_plan-ux-security-onboarding.md.
 *
 * Auth: bearer CRON_SECRET (Vercel cron) OR Clerk owner.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServerClient } from '@/lib/supabase'
import { recordCronRun } from '@/lib/cron/record'

export const runtime = 'nodejs'
export const maxDuration = 30

function isCronAuthed(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return (req.headers.get('authorization') ?? '') === `Bearer ${expected}`
}

const ENV_VAR_RE = /^\s*\|\s*`?([A-Z][A-Z0-9_]+)`?\s*\|/gm

function extractEnvVars(md: string): Set<string> {
  const out = new Set<string>()
  let m: RegExpExecArray | null
  ENV_VAR_RE.lastIndex = 0
  while ((m = ENV_VAR_RE.exec(md))) {
    if (m[1].length >= 4) out.add(m[1])
  }
  // Also catch `VAR_NAME=value` style examples
  const codeRe = /`([A-Z][A-Z0-9_]{3,})`/g
  let m2: RegExpExecArray | null
  while ((m2 = codeRe.exec(md))) out.add(m2[1])
  return out
}

async function checkDrift(): Promise<{ missing: string[]; total: number }> {
  const root = process.cwd()
  const [secrets, onboarding] = await Promise.all([
    readFile(join(root, 'memory/platform/SECRETS.md'), 'utf8'),
    readFile(join(root, 'docs/ONBOARDING.md'), 'utf8'),
  ])
  const inSecrets    = extractEnvVars(secrets)
  const inOnboarding = extractEnvVars(onboarding)
  const missing: string[] = []
  for (const v of inSecrets) {
    if (!inOnboarding.has(v)) missing.push(v)
  }
  return { missing: missing.sort(), total: inSecrets.size }
}

async function fileFeedbackRow(missing: string[]): Promise<void> {
  if (missing.length === 0) return
  const sb = createServerClient()
  if (!sb) return
  const summary = `ONBOARDING.md missing ${missing.length} env var${missing.length === 1 ? '' : 's'} from SECRETS.md: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`
  await (sb as unknown as {
    from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: unknown }> }
  }).from('workflow_feedback').insert({
    agent_slug: 'onboarding-drift',
    feedback:   summary,
    status:     'open',
    metadata:   { missing },
  })
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isCronAuthed(req)) {
    const a = await auth()
    if (!a.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    const allowed = (process.env.ALLOWED_USER_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(a.userId)) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 })
    }
  }
  try {
    const result = await recordCronRun('onboarding-drift', async () => {
      const drift = await checkDrift()
      await fileFeedbackRow(drift.missing)
      return drift
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'unknown' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
