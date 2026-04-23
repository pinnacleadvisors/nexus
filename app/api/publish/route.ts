/**
 * POST /api/publish — A10 entrypoint.
 *
 * Body:
 *   {
 *     provider: 'youtube-shorts' | 'tiktok' | 'instagram-reels'
 *     asset: { videoUrl, title, description?, tags?, visibility?, thumbnailUrl? }
 *     runId?: string          // if set, writes externalId onto runs.metrics.externalIds
 *   }
 *
 * Returns { provider, externalId, postedAt, publicUrl } on success, 4xx/5xx
 * with { error, code } when the provider rejects. Credentials are loaded from
 * user_secrets (kind = provider.requires.userSecretKind).
 *
 * GET /api/publish — list providers + their "configured?" state for UI hints.
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { audit } from '@/lib/audit'
import { getSecrets } from '@/lib/user-secrets'
import { getProvider, listProviders, publish, PublishFailure, type PublishProviderId } from '@/lib/publish'
import { appendEvent, getRun, recordMetrics } from '@/lib/runs/controller'

export const runtime    = 'nodejs'
export const maxDuration = 120      // Shorts upload can take ~60s end-to-end

const REQUIRED_KEYS_BY_KIND: Record<string, string[]> = {
  youtube:   ['clientId', 'clientSecret', 'refreshToken'],
  tiktok:    ['accessToken'],
  instagram: ['accessToken', 'igUserId'],
}

export async function GET(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'publish:list' },
  })
  if ('response' in g) return g.response

  const providers = await Promise.all(listProviders().map(async p => {
    const kind = p.requires.userSecretKind
    let configured = false
    if (kind) {
      const secrets = await getSecrets(g.userId, kind)
      const required = REQUIRED_KEYS_BY_KIND[kind] ?? []
      configured = required.length > 0 && required.every(k => secrets[k])
    }
    return { id: p.id, label: p.label, configured, requires: p.requires }
  }))

  return NextResponse.json({ providers })
}

export async function POST(req: NextRequest) {
  const g = await guardRequest(req, {
    rateLimit: { limit: 20, window: '1 m', prefix: 'publish:post' },
  })
  if ('response' in g) return g.response

  const body = await req.json().catch(() => ({})) as {
    provider?: PublishProviderId
    asset?: {
      videoUrl?:     string
      title?:        string
      description?:  string
      tags?:         string[]
      visibility?:   'public' | 'unlisted' | 'private'
      thumbnailUrl?: string
    }
    runId?: string
  }

  if (!body.provider)          return NextResponse.json({ error: 'provider required' }, { status: 400 })
  if (!body.asset?.videoUrl)   return NextResponse.json({ error: 'asset.videoUrl required' }, { status: 400 })
  if (!body.asset?.title)      return NextResponse.json({ error: 'asset.title required' }, { status: 400 })

  const provider = getProvider(body.provider)
  if (!provider) return NextResponse.json({ error: `unknown provider ${body.provider}` }, { status: 400 })

  // Load credentials from user_secrets (kind = provider-specific)
  const kind = provider.requires.userSecretKind
  if (!kind) {
    return NextResponse.json({ error: `provider ${body.provider} has no userSecretKind` }, { status: 500 })
  }
  const credentials = await getSecrets(g.userId, kind)

  // Validate Run ownership (defensive; RLS already scopes writes)
  if (body.runId) {
    const run = await getRun(body.runId)
    if (!run || run.userId !== g.userId) {
      return NextResponse.json({ error: 'runId not found' }, { status: 404 })
    }
  }

  try {
    const result = await provider.publish(
      {
        videoUrl:     body.asset.videoUrl,
        title:        body.asset.title,
        description:  body.asset.description,
        tags:         body.asset.tags,
        visibility:   body.asset.visibility,
        thumbnailUrl: body.asset.thumbnailUrl,
        runId:        body.runId,
      },
      credentials,
    )

    audit(req, {
      action:     'publish.posted',
      resource:   'publish',
      resourceId: `${result.provider}/${result.externalId}`,
      userId:     g.userId,
      metadata:   { provider: result.provider, publicUrl: result.publicUrl, runId: body.runId },
    })

    // A11 — write back onto the run so the measure phase can poll for metrics
    if (body.runId) {
      await recordMetrics(body.runId, {
        externalIds: { [result.provider]: result.externalId },
      })
      await appendEvent(body.runId, 'publish.posted', {
        provider:   result.provider,
        externalId: result.externalId,
        publicUrl:  result.publicUrl,
      })
    }

    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    const failure = err instanceof PublishFailure ? err : null
    const code    = failure?.code ?? 'unknown'
    const status  = code === 'not-configured' ? 412
                  : code === 'not-implemented' ? 501
                  : code === 'auth-failed' ? 401
                  : code === 'quota-exceeded' ? 429
                  : 502
    const message = err instanceof Error ? err.message : 'publish failed'

    if (body.runId) {
      await appendEvent(body.runId, 'phase.fail', { reason: `publish:${code}`, provider: body.provider, message })
    }

    return NextResponse.json({ error: message, code, provider: body.provider }, { status })
  }
}
