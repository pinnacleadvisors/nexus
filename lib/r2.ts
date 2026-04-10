/**
 * Cloudflare R2 client — S3-compatible storage for large binary assets.
 *
 * Required env vars (set in Doppler):
 *   R2_ACCOUNT_ID       — Cloudflare account ID
 *   R2_ACCESS_KEY_ID    — R2 API token access key
 *   R2_SECRET_ACCESS_KEY— R2 API token secret key
 *   R2_BUCKET_NAME      — bucket name (e.g. "nexus-assets")
 *   R2_PUBLIC_URL       — public bucket URL (optional, for presigned-style public links)
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY

  if (!accountId || !accessKeyId || !secretAccessKey) return null

  return new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

const BUCKET = process.env.R2_BUCKET_NAME ?? 'nexus-assets'

export function isR2Configured() {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY,
  )
}

// ── Upload ─────────────────────────────────────────────────────────────────────
export async function uploadToR2(params: {
  key: string
  body: Buffer | Uint8Array | string
  contentType?: string
  metadata?: Record<string, string>
}) {
  const client = getR2Client()
  if (!client) throw new Error('R2 not configured')

  await client.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType ?? 'application/octet-stream',
      Metadata: params.metadata,
    }),
  )

  const publicUrl = process.env.R2_PUBLIC_URL
  return {
    key: params.key,
    url: publicUrl ? `${publicUrl}/${params.key}` : null,
  }
}

// ── Presigned download URL (expires in 1 hour by default) ─────────────────────
export async function getPresignedDownloadUrl(key: string, expiresInSeconds = 3600) {
  const client = getR2Client()
  if (!client) throw new Error('R2 not configured')

  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: BUCKET, Key: key }),
    { expiresIn: expiresInSeconds },
  )
}

// ── Presigned upload URL (client-side direct upload) ──────────────────────────
export async function getPresignedUploadUrl(key: string, contentType: string, expiresInSeconds = 900) {
  const client = getR2Client()
  if (!client) throw new Error('R2 not configured')

  return getSignedUrl(
    client,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  )
}

// ── Delete ─────────────────────────────────────────────────────────────────────
export async function deleteFromR2(key: string) {
  const client = getR2Client()
  if (!client) throw new Error('R2 not configured')

  await client.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

// ── List ───────────────────────────────────────────────────────────────────────
export async function listR2Objects(prefix?: string, maxKeys = 100) {
  const client = getR2Client()
  if (!client) throw new Error('R2 not configured')

  const result = await client.send(
    new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: maxKeys }),
  )

  return (result.Contents ?? []).map(obj => ({
    key: obj.Key!,
    size: obj.Size ?? 0,
    lastModified: obj.LastModified?.toISOString() ?? '',
  }))
}

// ── Head (exists + metadata) ───────────────────────────────────────────────────
export async function headR2Object(key: string) {
  const client = getR2Client()
  if (!client) throw new Error('R2 not configured')

  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return { exists: true, contentType: result.ContentType, size: result.ContentLength }
  } catch {
    return { exists: false }
  }
}

// ── Upload from URL (fetch remote file → R2) ───────────────────────────────────
export async function uploadUrlToR2(params: { url: string; key: string; contentType?: string }) {
  const response = await fetch(params.url)
  if (!response.ok) throw new Error(`Failed to fetch ${params.url}: ${response.status}`)

  const buffer = Buffer.from(await response.arrayBuffer())
  const contentType = params.contentType ?? response.headers.get('content-type') ?? 'application/octet-stream'

  return uploadToR2({ key: params.key, body: buffer, contentType })
}
