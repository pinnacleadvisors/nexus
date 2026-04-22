/**
 * Supabase Storage API
 *
 * GET  /api/storage?bucket=<b>&prefix=<p>     — list files
 * POST /api/storage                           — upload file (multipart/form-data)
 *      body: { bucket, key, file (File) }
 * GET  /api/storage/url?bucket=<b>&key=<k>   — get signed download URL
 * DELETE /api/storage?bucket=<b>&key=<k>     — delete file
 *
 * Required: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in Doppler
 *
 * B4: all verbs now require `auth()` because this route uses the service role
 * key, which bypasses RLS. Without auth any visitor had full bucket CRUD.
 */

import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { createServerClient } from '@/lib/supabase'
import { rateLimit, rateLimitResponse } from '@/lib/ratelimit'
import { audit } from '@/lib/audit'

const DEFAULT_BUCKET = 'nexus-assets'
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 // 50 MB

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 60, window: '1 m', prefix: 'storage:read', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const bucket = searchParams.get('bucket') ?? DEFAULT_BUCKET
  const prefix = searchParams.get('prefix') ?? ''
  const key    = searchParams.get('key') ?? ''

  // Signed URL mode
  if (key) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(key, 3600)

    if (error || !data) {
      return NextResponse.json({ error: error?.message ?? 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ url: data.signedUrl })
  }

  // List mode
  const { data, error } = await supabase.storage.from(bucket).list(prefix, {
    limit: 100,
    sortBy: { column: 'created_at', order: 'desc' },
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    files: (data ?? []).map(f => ({
      name: f.name,
      id:   f.id,
      size: f.metadata?.size ?? 0,
      contentType: f.metadata?.mimetype ?? '',
      createdAt: f.created_at ?? '',
    })),
  })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'storage:write', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const formData = await req.formData()
  const bucket   = (formData.get('bucket') as string | null) ?? DEFAULT_BUCKET
  const key      = formData.get('key') as string | null
  const file     = formData.get('file') as File | null

  if (!key || !file) {
    return NextResponse.json({ error: 'key and file are required' }, { status: 400 })
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: `Upload exceeds ${MAX_UPLOAD_BYTES} byte cap` }, { status: 413 })
  }

  // Ensure bucket exists (create if missing)
  const { data: buckets } = await supabase.storage.listBuckets()
  const exists = (buckets ?? []).some(b => b.name === bucket)
  if (!exists) {
    await supabase.storage.createBucket(bucket, { public: false })
  }

  const arrayBuffer = await file.arrayBuffer()
  const { error } = await supabase.storage.from(bucket).upload(key, arrayBuffer, {
    contentType: file.type || 'application/octet-stream',
    upsert: true,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: urlData } = await supabase.storage.from(bucket).createSignedUrl(key, 3600)

  audit(req, {
    action: 'storage.upload',
    resource: 'storage',
    resourceId: `${bucket}/${key}`,
    userId,
    metadata: { size: file.size, contentType: file.type },
  })

  return NextResponse.json({
    key,
    bucket,
    url: urlData?.signedUrl ?? null,
  })
}

export async function DELETE(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const rl = await rateLimit(req, { limit: 30, window: '1 m', prefix: 'storage:del', identifier: userId })
  if (!rl.success) return rateLimitResponse(rl)

  const supabase = createServerClient()
  if (!supabase) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 })
  }

  const { searchParams } = new URL(req.url)
  const bucket = searchParams.get('bucket') ?? DEFAULT_BUCKET
  const key    = searchParams.get('key')

  if (!key) return NextResponse.json({ error: 'key is required' }, { status: 400 })

  const { error } = await supabase.storage.from(bucket).remove([key])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  audit(req, {
    action: 'storage.delete',
    resource: 'storage',
    resourceId: `${bucket}/${key}`,
    userId,
  })

  return NextResponse.json({ deleted: key })
}
