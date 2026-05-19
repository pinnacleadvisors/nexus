/**
 * POST /api/agents/survey-oss-framework
 *
 * One-click "absorb a new OSS agent framework into the open-orchestration
 * survey." Takes a GitHub repo URL + the framework's display name, kicks
 * off a two-stage workflow:
 *
 *   1. firecrawl_local scrapes the README + key docs into a single markdown
 *      file at /tmp/<slug>-survey.md
 *   2. supermemory agent extracts pattern / anti-pattern atoms, creates an
 *      entity for the framework, links them under
 *      mocs/agent-framework-survey
 *
 * This route returns immediately with a `dispatch_id` — the heavy lifting
 * is offloaded to the existing `/api/claude-session/dispatch` agent pipeline.
 * Poll `GET /api/claude-session/dispatch?id=<dispatch_id>` for status.
 *
 * Auth: Clerk session + owner gate OR Bearer NEXUS_OPS_TOKEN.
 */

import { NextRequest, NextResponse } from 'next/server'
import { authenticateOps } from '@/lib/auth/ops-auth'
import { assertUnderCostCap } from '@/lib/cost-guard'
import { audit } from '@/lib/audit'

export const runtime = 'nodejs'
export const maxDuration = 30

interface SurveyBody {
  repo_url:        string
  framework_name:  string
  /** Optional — override the default MOC link. */
  moc?:            string
  /** Optional — set the entity kind. Defaults to 'concept'. */
  entity_kind?:    'concept' | 'company' | 'project'
  /** Bearer-mode only. */
  userId?:         string
}

// Regex-free for CodeQL — the user-supplied input is pre-bounded to 256
// chars and the char-by-char loop is unambiguously O(n) with a known
// constant ceiling. CodeQL's regex analyzer can't see runtime bounds, so
// avoiding regex on user input is the cleanest way to keep CI clean.
function slugify(s: string): string {
  const bounded = String(s).slice(0, 256).toLowerCase()
  let out = ''
  for (let i = 0; i < bounded.length; i++) {
    const ch = bounded[i]
    const isAlphanum = (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
    if (isAlphanum) out += ch
    else if (out.length > 0 && out[out.length - 1] !== '-') out += '-'
  }
  if (out.endsWith('-')) out = out.slice(0, -1)
  return out.slice(0, 64)
}

function isGithubRepoUrl(s: string): boolean {
  try {
    if (typeof s !== 'string' || s.length > 2000) return false
    const u = new URL(s)
    if (u.hostname !== 'github.com') return false
    // URL parser already canonicalised the path — split is regex-free.
    const parts = u.pathname.split('/').filter(Boolean)
    return parts.length >= 2
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  let body: SurveyBody
  try { body = await req.json() as SurveyBody } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 })
  }

  if (!body.repo_url || !isGithubRepoUrl(body.repo_url)) {
    return NextResponse.json({ ok: false, error: 'repo_url must be a github.com URL' }, { status: 400 })
  }
  if (!body.framework_name || typeof body.framework_name !== 'string') {
    return NextResponse.json({ ok: false, error: 'framework_name required' }, { status: 400 })
  }

  const a = await authenticateOps(req, { bodyUserId: body.userId })
  if ('response' in a) return a.response

  const cap = await assertUnderCostCap(a.userId)
  if (!cap.ok) {
    return NextResponse.json(
      { ok: false, error: 'daily cost cap exceeded', spentUsd: cap.spentUsd, capUsd: cap.capUsd },
      { status: 200 },
    )
  }

  const slug      = slugify(body.framework_name)
  const moc       = body.moc ?? 'agent-framework-survey'
  const entKind   = body.entity_kind ?? 'concept'

  // The brief is read by `firecrawl` + `supermemory` agents via the dispatch
  // route. They run sequentially: scrape → extract → memory write.
  const brief = `# Survey OSS agent framework: ${body.framework_name}

Repository: ${body.repo_url}

## Workflow
1. **Scrape**: firecrawl_local scrape ${body.repo_url} (README, docs/ folder, any AGENTS.md or SKILL.md files). Output to /tmp/${slug}-survey.md.
2. **Extract**: supermemory reads the scrape, identifies:
   - Patterns worth absorbing (kind: pattern, status: absorbed) — what does this framework do well?
   - Anti-patterns to reject (kind: anti-pattern, status: rejected) — what does this framework do badly that we should avoid?
   - Key entity: ${body.framework_name} (entity_kind: ${entKind})
3. **Memory write**: each atom links to [[mocs/${moc}]] AND [[entities/${slug}]]. Entity links to its repo URL via locators[].

## Constraints
- Aim for 3-7 atoms per framework (mix of patterns + anti-patterns)
- Each atom: one sentence in title, 2-4 sentences in body explaining the design choice + our verdict
- Verdict must be one of: absorbed (we want this), rejected (we don't), or trial (worth testing)
- Be opinionated — "interesting" is not a verdict, "absorbed: routes via deterministic state machine instead of LLM dispatch" is
- Use the canonical Nexus scope: { repo: 'pinnacleadvisors/nexus' }

## Background context
This is part of the open-orchestration survey — Nexus continuously evaluates the OSS agent ecosystem and absorbs best patterns. See mocs/agent-framework-survey for prior absorbed frameworks.
`

  // Dispatch via the existing claude-session pipeline. We pass swarm: false
  // because the work is sequential (scrape → extract → write) — splitting
  // into parallel sub-tasks doesn't help.
  //
  // Base URL is read from a fixed env var (never from the incoming request's
  // Host header) so the fetch target can't be redirected by header injection.
  let dispatchId: string | null = null
  try {
    const baseUrl = (process.env.NEXUS_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '')
    const opsToken = process.env.NEXUS_OPS_TOKEN
    const dispatchRes = await fetch(`${baseUrl}/api/claude-session/dispatch`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        ...(opsToken ? { Authorization: `Bearer ${opsToken}` } : {}),
      },
      body: JSON.stringify({
        agent: 'firecrawl',
        brief,
        inputs: {
          tools:           ['firecrawl', 'supermemory', 'WebFetch'],
          repo_url:        body.repo_url,
          framework_name:  body.framework_name,
          framework_slug:  slug,
          moc,
          entity_kind:     entKind,
        },
        swarm:            false,
        autoCreateAgent:  false,
      }),
      signal: AbortSignal.timeout(20_000),
    })

    if (dispatchRes.ok) {
      const dispatchJson = await dispatchRes.json().catch(() => ({}))
      dispatchId = typeof dispatchJson.dispatch_id === 'string' ? dispatchJson.dispatch_id : null
    }
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: `dispatch failed: ${err instanceof Error ? err.message : 'unknown'}` },
      { status: 200 },
    )
  }

  audit(req, {
    action:     'agents.survey_oss_framework',
    resource:   'framework_survey',
    resourceId: slug,
    userId:     a.userId,
    metadata:   { authMode: a.mode, repo_url: body.repo_url, framework_name: body.framework_name, dispatch_id: dispatchId },
  })

  return NextResponse.json({
    ok:            true,
    framework_slug: slug,
    moc,
    dispatch_id:   dispatchId,
    hint:          dispatchId
      ? `Poll GET /api/claude-session/dispatch?id=${dispatchId} for status.`
      : 'Dispatch route returned no id — see audit log.',
  })
}
