/**
 * Cloudflare R2 API — alternative large-asset storage
 *
 * GET    /api/r2?prefix=<p>              — list objects
 * POST   /api/r2                         — upload (JSON body)
 *        { key, content (base64), contentType } — server-side upload
 *        { key, contentType, presign: true }    — returns presigned PUT URL for client upload
 * GET    /api/r2/url?key=<k>            — presigned download URL (1 h)
 * DELETE /api/r2?key=<k>               — delete object
 * POST   /api/r2  { key, url }          — fetch remote URL and upload to R2
 *
 * Required env vars: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
 *
 * B3: all verbs now require `auth()`. Remote-URL fetch goes through `fetchGuarded`
 * which blocks private IPs, non-http(s) schemes, and 50 MB+ downloads.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import {
  isR2Configured,
  uploadToR2,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  deleteFromR2,
  listR2Objects,
} from '@/lib/r2'
import { fetchGuarded } from '@/lib/r2-url-guard'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'

const MAX_DIRECT_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB — mirror r2-url-guard cap

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'r2:read', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const key    = searchParams.get('key')
  const prefix = searchParams.get('prefix') ?? undefined

  // Presigned download URL
  if (key) {
    const url = await getPresignedDownloadUrl(key)
    return NextResponse.json({ url })
  }

  const objects = await listR2Objects(prefix)
  return NextResponse.json({ objects })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'r2:write', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 503 })
  }

  const body = await req.json() as {
    key: string
    contentType?: string
    content?: string      // base64 encoded
    url?: string          // fetch from remote URL
    presign?: boolean     // return presigned upload URL instead
  }

  if (!body.key) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  // Presigned upload URL for client-side direct upload
  if (body.presign) {
    const url = await getPresignedUploadUrl(body.key, body.contentType ?? 'application/octet-stream')
    audit(req, { action: 'r2.presign', resource: 'r2', resourceId: body.key, userId })
    return NextResponse.json({ uploadUrl: url, key: body.key })
  }

  // Fetch from remote URL and upload — goes through SSRF + size guard
  if (body.url) {
    const guarded = await fetchGuarded(body.url)
    if (!guarded.ok) {
      return NextResponse.json({ error: guarded.error }, { status: guarded.status ?? 400 })
    }
    const contentType = body.contentType ?? guarded.contentType
    const result = await uploadToR2({ key: body.key, body: guarded.body, contentType })
    audit(req, {
      action: 'r2.upload_url',
      resource: 'r2',
      resourceId: body.key,
      userId,
      metadata: { sourceUrl: body.url, finalUrl: guarded.finalUrl, size: guarded.body.length },
    })
    return NextResponse.json(result)
  }

  // Direct upload from base64 content
  if (!body.content) {
    return NextResponse.json({ error: 'content or url is required' }, { status: 400 })
  }

  const buffer = Buffer.from(body.content, 'base64')
  if (buffer.length > MAX_DIRECT_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Upload exceeds ${MAX_DIRECT_UPLOAD_BYTES} byte cap` }, { status: 413 })
  }
  const result = await uploadToR2({
    key: body.key,
    body: buffer,
    contentType: body.contentType,
  })
  audit(req, {
    action: 'r2.upload',
    resource: 'r2',
    resourceId: body.key,
    userId,
    metadata: { size: buffer.length },
  })

  return NextResponse.json(result)
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'r2:del', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')

  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  await deleteFromR2(key)
  audit(req, { action: 'r2.delete', resource: 'r2', resourceId: key, userId })
  return NextResponse.json({ deleted: key })
}
