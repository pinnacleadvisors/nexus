/**
 * /api/build/diff — A12 Phase-19 closeout
 *
 * GET  /api/build/diff?url=<github-branch-or-pr-url>
 *   → { ref, diff, status }  (status = GitHub Commits Status API result)
 *
 * POST /api/build/diff
 *   body: { url, action: 'approve' | 'reject', commitMessage?, runId? }
 *   approve → merge into default branch (or the PR base)
 *   reject  → delete the branch (PRs: returns { closed: false, hint: 'close the PR directly' })
 *
 * Auth: requires Clerk session via guardRequest. Looks for the caller's PAT
 * in user_secrets (kind='github', name='pat'); falls back to GITHUB_TOKEN env.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { audit } from '@/lib/audit'
import { getSecret } from '@/lib/user-secrets'
import {
  parseBranchUrl, fetchBranchDiff, fetchCommitStatus, mergeBranch, deleteBranch,
  type BranchRef,
} from '@/lib/git/diff'
import { appendEvent, getRun } from '@/lib/runs/controller'

export const runtime    = 'nodejs'
export const maxDuration = 45

async function resolveGithubToken(userId: string): Promise<string | null> {
  const fromSecrets = await getSecret(userId, 'github', 'pat')
  if (fromSecrets) return fromSecrets
  return process.env.GITHUB_TOKEN ?? null
}

async function verifyRunOwnership(runId: string, userId: string): Promise<boolean> {
  const run = await getRun(runId)
  return Boolean(run && run.userId === userId)
}

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'build:diff:get' },
  })
  if ('response' in g) return g.response

  const url = req.nextUrl.searchParams.get('url')
  if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

  const ref = parseBranchUrl(url)
  if (!ref) return NextResponse.json({ error: 'not a GitHub branch / PR url' }, { status: 400 })

  const token = await resolveGithubToken(g.userId)
  if (!token) return NextResponse.json({ error: 'GitHub token missing — add kind=github,name=pat to user_secrets or set GITHUB_TOKEN' }, { status: 412 })

  try {
    const diff   = await fetchBranchDiff(ref, { token })
    const status = await fetchCommitStatus(ref.owner, ref.repo, diff.headSha, { token })
    return NextResponse.json({ ref, diff, status })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'fetch failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 20, window: '1 m', prefix: 'build:diff:post' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as {
    url?:           string
    action?:        'approve' | 'reject'
    commitMessage?: string
    runId?:         string
  }

  if (!body.url)    return NextResponse.json({ error: 'url required' }, { status: 400 })
  if (!body.action) return NextResponse.json({ error: 'action required' }, { status: 400 })

  const ref: BranchRef | null = parseBranchUrl(body.url)
  if (!ref) return NextResponse.json({ error: 'not a GitHub branch / PR url' }, { status: 400 })

  const token = await resolveGithubToken(g.userId)
  if (!token) return NextResponse.json({ error: 'GitHub token missing' }, { status: 412 })

  if (body.runId && !(await verifyRunOwnership(body.runId, g.userId))) {
    return NextResponse.json({ error: 'runId not found' }, { status: 404 })
  }

  try {
    if (body.action === 'approve') {
      const result = await mergeBranch(ref, { token }, body.commitMessage)
      audit(req, {
        action:     'build.diff.merge',
        resource:   'repo',
        resourceId: `${ref.owner}/${ref.repo}@${ref.ref}`,
        userId:     g.userId,
        metadata:   { merged: result.merged, sha: result.sha },
      })
      if (body.runId) {
        await appendEvent(body.runId, 'review.approved', {
          reason: 'diff.merged',
          repo:   `${ref.owner}/${ref.repo}`,
          ref:    ref.ref,
          sha:    result.sha,
        })
      }
      return NextResponse.json({ ok: true, action: 'approve', ...result })
    }

    if (body.action === 'reject') {
      const closed = await deleteBranch(ref, { token })
      audit(req, {
        action:     'build.diff.reject',
        resource:   'repo',
        resourceId: `${ref.owner}/${ref.repo}@${ref.ref}`,
        userId:     g.userId,
        metadata:   { closed, kind: ref.kind },
      })
      if (body.runId) {
        await appendEvent(body.runId, 'review.rejected', {
          reason: 'diff.rejected',
          repo:   `${ref.owner}/${ref.repo}`,
          ref:    ref.ref,
          closed,
        })
      }
      const hint = ref.kind === 'pull'
        ? 'Close the PR manually on GitHub. Deleting the PR branch is not done automatically.'
        : undefined
      return NextResponse.json({ ok: true, action: 'reject', closed, hint })
    }

    return NextResponse.json({ error: `unknown action ${body.action}` }, { status: 400 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'action failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }
}
