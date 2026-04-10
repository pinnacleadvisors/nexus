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
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  isR2Configured,
  uploadToR2,
  uploadUrlToR2,
  getPresignedDownloadUrl,
  getPresignedUploadUrl,
  deleteFromR2,
  listR2Objects,
} from '@/lib/r2'

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ uploadUrl: url, key: body.key })
  }

  // Fetch from remote URL and upload
  if (body.url) {
    const result = await uploadUrlToR2({
      url: body.url,
      key: body.key,
      contentType: body.contentType,
    })
    return NextResponse.json(result)
  }

  // Direct upload from base64 content
  if (!body.content) {
    return NextResponse.json({ error: 'content or url is required' }, { status: 400 })
  }

  const buffer = Buffer.from(body.content, 'base64')
  const result = await uploadToR2({
    key: body.key,
    body: buffer,
    contentType: body.contentType,
  })

  return NextResponse.json(result)
}

export async function DELETE(req: NextRequest) {
  if (!isR2Configured()) {
    return NextResponse.json({ error: 'R2 not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const key = searchParams.get('key')

  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  await deleteFromR2(key)
  return NextResponse.json({ deleted: key })
}
