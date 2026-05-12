/**
 * POST   /api/connected-accounts/api-key
 * DELETE /api/connected-accounts/api-key
 *
 * Save / revoke an API key for a non-Composio platform (apiKeySetup providers
 * — see lib/oauth/providers.ts). The key is encrypted with ENCRYPTION_KEY via
 * lib/crypto.ts and stored on `connected_accounts.encrypted_api_key`. The
 * Composio handle column (`composio_account_id`) is NULL for these rows; the
 * mutual-exclusion check constraint is enforced by migration 035.
 *
 * POST body:    { platform: string, businessSlug?: string|null, apiKey: string }
 * DELETE body:  { platform: string, businessSlug?: string|null }
 *
 * Returns:      { ok: true, id: string }
 *
 * Auth: Clerk session (same pattern as /init and /callback).
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'
import { encrypt } from '@/lib/crypto'
import { createServerClient } from '@/lib/supabase'
import { getProvider } from '@/lib/oauth/providers'
import { isValidScope } from '@/lib/claw/business-client'

export const runtime = 'nodejs'

interface PostBody   { platform?: string; businessSlug?: string | null; apiKey?: string }
interface DeleteBody { platform?: string; businessSlug?: string | null }

// Reasonable upper bound — Cloudflare zone-scoped tokens are ~40 chars,
// ConvertKit V4 keys are ~50 chars. 4 KB leaves room for any future format
// without inviting abuse via massive payloads.
const MAX_KEY_LEN = 4096

export async function POST(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 20, window: '1 m', prefix: 'connected-accounts:api-key:post' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: PostBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.platform !== 'string' || !body.platform) {
    return NextResponse.json({ error: 'platform required' }, { status: 400 })
  }
  const provider = getProvider(body.platform)
  if (!provider) return NextResponse.json({ error: 'unknown platform' }, { status: 400 })
  if (!provider.apiKeySetup) {
    return NextResponse.json({ error: `platform '${provider.id}' is not an apiKeySetup provider` }, { status: 400 })
  }

  if (typeof body.apiKey !== 'string' || body.apiKey.trim().length === 0) {
    return NextResponse.json({ error: 'apiKey required' }, { status: 400 })
  }
  const trimmed = body.apiKey.trim()
  if (trimmed.length > MAX_KEY_LEN) {
    return NextResponse.json({ error: `apiKey too long (max ${MAX_KEY_LEN} chars)` }, { status: 400 })
  }

  const businessSlug = body.businessSlug?.trim() || null
  if (businessSlug && !isValidScope(businessSlug)) {
    return NextResponse.json({ error: 'invalid businessSlug' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'database not configured' }, { status: 503 })

  // Encrypt and store. Postgres bytea accepts UTF-8 bytes of the canonical
  // "<iv>:<tag>:<ciphertext>" string from lib/crypto.encrypt() — supabase-js
  // serialises strings to bytea transparently.
  const ciphertext = encrypt(trimmed)

  // Revoke any existing active row for this (user, business, platform) so we
  // can insert a fresh one without colliding with the active-unique partial
  // indexes from migration 033. Doing it as two statements keeps the query
  // shape compatible with the loosely-typed supabase chain used elsewhere in
  // this codebase.
  type IdRow = { id: string }
  type UpdateChain = { eq: (c: string, v: unknown) => UpdateChain; is: (c: string, v: null) => UpdateChain }
  const baseRevoke = (db.from('connected_accounts' as never) as unknown as {
    update: (p: Record<string, unknown>) => UpdateChain
  }).update({ status: 'revoked' })
    .eq('user_id', session.userId)
    .eq('platform', provider.id)
    .eq('status', 'active')
  const revokeChain = businessSlug ? baseRevoke.eq('business_slug', businessSlug) : baseRevoke.is('business_slug', null)
  await (revokeChain as unknown as Promise<{ error: { message: string } | null }>)

  const insert = await (db.from('connected_accounts' as never) as unknown as {
    insert: (row: Record<string, unknown>) => { select: (cols: string) => { single: () => Promise<{ data: IdRow | null; error: { message: string } | null }> } }
  }).insert({
    user_id:             session.userId,
    business_slug:       businessSlug,
    platform:            provider.id,
    composio_account_id: null,
    encrypted_api_key:   ciphertext,
    status:              'active',
    metadata:            { source: 'apiKeySetup' },
  }).select('id').single()

  if (insert.error || !insert.data) {
    return NextResponse.json({ error: insert.error?.message ?? 'insert failed' }, { status: 500 })
  }

  audit(req, {
    action:     'connected_accounts.api_key_save',
    resource:   'connected_account',
    resourceId: insert.data.id,
    userId:     session.userId,
    metadata:   { platform: provider.id, businessSlug },
  })

  return NextResponse.json({ ok: true, id: insert.data.id })
}

export async function DELETE(req: NextRequest) {
  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'connected-accounts:api-key:delete' })
  if (!rl.success) return rateLimitResponse(rl)

  const session = await auth()
  if (!session.userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  let body: DeleteBody
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.platform !== 'string' || !body.platform) {
    return NextResponse.json({ error: 'platform required' }, { status: 400 })
  }
  const provider = getProvider(body.platform)
  if (!provider) return NextResponse.json({ error: 'unknown platform' }, { status: 400 })

  const businessSlug = body.businessSlug?.trim() || null
  if (businessSlug && !isValidScope(businessSlug)) {
    return NextResponse.json({ error: 'invalid businessSlug' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) return NextResponse.json({ error: 'database not configured' }, { status: 503 })

  type UpdateChain = { eq: (c: string, v: unknown) => UpdateChain; is: (c: string, v: null) => UpdateChain }
  const base = (db.from('connected_accounts' as never) as unknown as {
    update: (p: Record<string, unknown>) => UpdateChain
  }).update({ status: 'revoked' })
    .eq('user_id', session.userId)
    .eq('platform', provider.id)
    .eq('status', 'active')
  const chain = businessSlug ? base.eq('business_slug', businessSlug) : base.is('business_slug', null)
  const result = await (chain as unknown as Promise<{ error: { message: string } | null }>)
  if (result.error) return NextResponse.json({ error: result.error.message }, { status: 500 })

  audit(req, {
    action:    'connected_accounts.api_key_revoke',
    resource:  'connected_account',
    userId:    session.userId,
    metadata:  { platform: provider.id, businessSlug },
  })

  return NextResponse.json({ ok: true })
}
