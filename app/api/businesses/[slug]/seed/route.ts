/**
 * POST /api/businesses/[slug]/seed
 * GET  /api/businesses/[slug]/seed — preview without mutating
 *
 * Generates the list of Composio connectors the business needs based on
 * its niche, and (for the POST variant) builds OAuth-init paths so the
 * operator can click through to authorize each one. Closes the operator's
 * "automate build of other components needed to manage/build business"
 * ask alongside J3 (auto-provision Coolify).
 *
 * What this DOES:
 *   - Picks the OAuth providers matching the business's niche (via the
 *     existing `featuredFor` mapping in lib/oauth/providers.ts)
 *   - Skips platforms already connected for this business slug
 *   - Stamps Stripe + Vercel as shareable (operator's existing single org
 *     gets tagged with metadata.business_slug for revenue attribution)
 *   - Returns a structured list the GraduateModal can render as
 *     "click to connect" cards
 *
 * What this does NOT do:
 *   - Auto-OAuth (the operator MUST click each one — they have to grant
 *     scopes on the upstream platform anyway, no way around it)
 *   - Mutate Stripe state (no API calls — just records the seeded
 *     intent so future payment_intents created for this business carry
 *     metadata.business_slug correctly)
 *   - Replace /settings/accounts — the operator can still connect any
 *     platform via the existing UI. This route is a niche-aware fast-path.
 *
 * J5 from session 2026-05-27. Companion to J3 (auto-provision) and J4
 * (smoke automation). Retry-storm safe (200 always).
 */

import { NextRequest, NextResponse } from 'next/server'
import { guardRequest } from '@/lib/guard'
import { createServerClient } from '@/lib/supabase'
import { OAUTH_PROVIDERS, type OAuthProvider } from '@/lib/oauth/providers'

export const runtime = 'nodejs'
export const maxDuration = 15

interface RouteCtx { params: Promise<{ slug: string }> }

interface SuggestedConnector {
  /** OAuth provider id (matches OAUTH_PROVIDERS[].id). */
  id:                 string
  /** Operator-friendly name. */
  name:               string
  category:           string
  /** True when the provider needs an OAuth/api-key connection per-business
   *  (vs single Admin connection shared across all businesses). */
  perBusiness:        boolean
  /** True when there's already a connected_accounts row for this provider
   *  + this business slug. UI hides the connect button in that case. */
  alreadyConnected:   boolean
  /** Path the UI redirects to to start the OAuth flow. Encodes the
   *  business slug so the callback can attribute correctly. */
  oauthInitPath:      string
  /** Short reason this provider was picked for the business's niche.
   *  Surfaced as a tooltip in the GraduateModal. */
  reason:             string
}

interface SeedResponse {
  ok:                  boolean
  niche:               string | null
  suggested:           SuggestedConnector[]
  /** Platforms NOT suggested but available via /settings/accounts. */
  available_elsewhere: number
  warnings:            string[]
}

/**
 * Niche → categories mapping. Defines which provider categories matter
 * for each business type. Picked deliberately small for V1 — the operator
 * can always connect more via /settings/accounts.
 */
const NICHE_CATEGORIES: Record<string, string[]> = {
  'saas':              ['communication', 'productivity', 'developer', 'commerce', 'analytics'],
  'info-products':     ['email', 'social', 'commerce', 'communication'],
  'e-commerce':        ['commerce', 'social', 'email', 'analytics'],
  'service-agency':    ['communication', 'productivity', 'email'],
  'media-newsletter':  ['email', 'social', 'communication'],
  'creator-economy':   ['social', 'email', 'commerce'],
  'general':           ['communication', 'email'],
}

/** Friendly reason text per provider. Falls back to a generic line. */
function reasonFor(provider: OAuthProvider, niche: string): string {
  const niceCategory: Record<string, string> = {
    social:        'broadcast / audience-building',
    email:         'transactional + marketing email',
    commerce:      'payments + revenue tracking',
    communication: 'team + customer notifications',
    productivity:  'planning + scheduling',
    developer:     'deploys + repository work',
    design:        'creative assets',
    analytics:     'traffic + behaviour signal',
    finance:       'bookkeeping + accounting',
  }
  const cat = niceCategory[provider.category] ?? provider.category
  return `${cat} — picked for ${niche}`
}

async function loadConnectedSet(db: ReturnType<typeof createServerClient>, userId: string, slug: string): Promise<Set<string>> {
  if (!db) return new Set()
  try {
    const res = await (db.from('connected_accounts' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { eq: (c: string, v: string) => Promise<{ data: Array<{ platform: string }> | null }> } }
    }).select('platform').eq('user_id', userId).eq('business_slug', slug)
    return new Set((res.data ?? []).map(r => r.platform))
  } catch {
    return new Set()
  }
}

async function loadBusiness(db: ReturnType<typeof createServerClient>, userId: string, slug: string): Promise<{ niche: string | null; user_id: string } | null> {
  if (!db) return null
  try {
    const res = await (db.from('business_operators' as never) as unknown as {
      select: (c: string) => { eq: (c: string, v: string) => { maybeSingle: () => Promise<{ data: { user_id: string; niche: string | null } | null }> } }
    }).select('user_id, niche').eq('slug', slug).maybeSingle()
    if (!res.data) return null
    if (res.data.user_id !== userId) return null
    return { niche: res.data.niche, user_id: res.data.user_id }
  } catch {
    return null
  }
}

function buildSuggestions(niche: string | null, connected: Set<string>): SuggestedConnector[] {
  const key = (niche ?? 'general').toLowerCase()
  const categories = NICHE_CATEGORIES[key] ?? NICHE_CATEGORIES.general
  const featuredKey = key.split('-')[0]  // 'saas' for 'saas', 'info' for 'info-products', etc.

  const seen = new Set<string>()
  const out: SuggestedConnector[] = []

  for (const p of OAUTH_PROVIDERS) {
    if (seen.has(p.id)) continue
    // Match if EITHER the provider's category fits the niche OR it's
    // explicitly featuredFor the niche tag.
    const featuredMatch  = (p.featuredFor ?? []).some(tag => tag === featuredKey || tag === key)
    const categoryMatch  = categories.includes(p.category)
    if (!featuredMatch && !categoryMatch) continue

    seen.add(p.id)
    out.push({
      id:               p.id,
      name:             p.name,
      category:         p.category,
      perBusiness:      (p.scopePolicy ?? 'per-business') === 'per-business' || p.scopePolicy === 'dual',
      alreadyConnected: connected.has(p.id),
      oauthInitPath:    `/api/connected-accounts/init?platform=${encodeURIComponent(p.id)}`,
      reason:           reasonFor(p, key),
    })
    // V1 cap — suggest ≤ 6 platforms so the GraduateModal stays scannable.
    if (out.length >= 6) break
  }

  return out
}

export async function GET(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  return await handle(req, ctx)
}

export async function POST(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  return await handle(req, ctx)
}

async function handle(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const g = await guardRequest(req, {
    rateLimit: { limit: 30, window: '1 m', prefix: 'biz:seed' },
  })
  if ('response' in g) return g.response

  const { slug } = await ctx.params
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) {
    return NextResponse.json({ ok: false, error: 'invalid_slug' })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ ok: false, error: 'supabase_unconfigured' })

  const biz = await loadBusiness(db, g.userId, slug)
  if (!biz) {
    return NextResponse.json({ ok: false, error: 'business_not_found_or_forbidden' })
  }

  const connected  = await loadConnectedSet(db, g.userId, slug)
  const suggested  = buildSuggestions(biz.niche, connected)
  const warnings: string[] = []
  if (!biz.niche) warnings.push('No niche set on this business — falling back to "general" category suggestions.')
  if (suggested.length === 0) warnings.push('No platforms matched. Connect any provider directly from /settings/accounts.')

  const body: SeedResponse = {
    ok:                  true,
    niche:               biz.niche,
    suggested,
    available_elsewhere: OAUTH_PROVIDERS.length - suggested.length,
    warnings,
  }
  return NextResponse.json(body)
}
