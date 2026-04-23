/**
 * lib/publish/youtube.ts — YouTube Shorts publisher.
 *
 * Uses the YouTube Data API v3 resumable upload protocol:
 *   1. POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
 *      → returns a resumable-upload URL in the Location header
 *   2. PUT <resumable-url> with the video bytes
 *      → returns the created video resource
 *
 * A "Short" is just a vertical video ≤ 60s with `#Shorts` in the title or
 * description. YouTube auto-classifies — no special API flag. We append
 * `#Shorts` to the description if it's not already present.
 *
 * Credentials (stored in user_secrets kind='youtube'):
 *   - clientId        — Google OAuth client ID (web app type)
 *   - clientSecret    — Google OAuth client secret
 *   - refreshToken    — obtained once via the standard OAuth consent flow;
 *                       long-lived refresh token (scope = youtube.upload)
 *
 * The caller fetches these from user_secrets before calling `publishYouTubeShort`.
 */

import { PublishFailure, type PublishAsset, type PublishProvider, type PublishResult } from './types'

const OAUTH_TOKEN_URL    = 'https://oauth2.googleapis.com/token'
const UPLOAD_URL         = 'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status'
const MAX_VIDEO_BYTES    = 256 * 1024 * 1024   // 256 MB — Shorts are always small; cap to protect memory
const MAX_TITLE_LEN      = 100
const MAX_DESC_LEN       = 5000
const REQUIRED_KEYS      = ['clientId', 'clientSecret', 'refreshToken'] as const

async function refreshAccessToken(credentials: Record<string, string>): Promise<string> {
  for (const k of REQUIRED_KEYS) {
    if (!credentials[k]) {
      throw new PublishFailure('youtube-shorts', 'not-configured', `YouTube credentials missing: ${k}`)
    }
  }
  const body = new URLSearchParams({
    client_id:     credentials.clientId,
    client_secret: credentials.clientSecret,
    refresh_token: credentials.refreshToken,
    grant_type:    'refresh_token',
  })
  const res = await fetch(OAUTH_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new PublishFailure('youtube-shorts', 'auth-failed', `OAuth refresh failed (${res.status}): ${text.slice(0, 200)}`)
  }
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) {
    throw new PublishFailure('youtube-shorts', 'auth-failed', 'OAuth refresh returned no access_token')
  }
  return data.access_token
}

async function fetchVideoBytes(videoUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
  const res = await fetch(videoUrl)
  if (!res.ok) {
    throw new PublishFailure('youtube-shorts', 'upload-failed', `Could not fetch video asset: ${res.status}`)
  }
  const lenHeader = res.headers.get('content-length')
  if (lenHeader && parseInt(lenHeader, 10) > MAX_VIDEO_BYTES) {
    throw new PublishFailure('youtube-shorts', 'upload-failed', `Video exceeds ${MAX_VIDEO_BYTES}-byte cap`)
  }
  const contentType = res.headers.get('content-type') ?? 'video/mp4'
  const chunks: Uint8Array[] = []
  let received = 0
  const reader = res.body?.getReader()
  if (!reader) throw new PublishFailure('youtube-shorts', 'upload-failed', 'Video asset has no body')
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    received += value.byteLength
    if (received > MAX_VIDEO_BYTES) {
      await reader.cancel().catch(() => {})
      throw new PublishFailure('youtube-shorts', 'upload-failed', `Video exceeds ${MAX_VIDEO_BYTES}-byte cap`)
    }
    chunks.push(value)
  }
  return { buffer: Buffer.concat(chunks), contentType }
}

function buildSnippet(asset: PublishAsset): Record<string, unknown> {
  let desc = asset.description ?? ''
  if (!/#shorts\b/i.test(desc) && !/#shorts\b/i.test(asset.title)) desc = `${desc}\n\n#Shorts`.trim()
  return {
    snippet: {
      title:       asset.title.slice(0, MAX_TITLE_LEN),
      description: desc.slice(0, MAX_DESC_LEN),
      tags:        (asset.tags ?? []).slice(0, 15),
      categoryId:  '22',                        // "People & Blogs" — safe default
    },
    status: {
      privacyStatus:      asset.visibility ?? 'public',
      selfDeclaredMadeForKids: false,
    },
  }
}

export async function publishYouTubeShort(
  asset:       PublishAsset,
  credentials: Record<string, string>,
): Promise<PublishResult> {
  const accessToken = await refreshAccessToken(credentials)
  const meta = buildSnippet(asset)

  // Step 1: initiate resumable upload
  const initRes = await fetch(UPLOAD_URL, {
    method: 'POST',
    headers: {
      Authorization:   `Bearer ${accessToken}`,
      'Content-Type':  'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/*',
    },
    body: JSON.stringify(meta),
  })
  if (!initRes.ok) {
    const text = await initRes.text().catch(() => '')
    const code = initRes.status === 403 ? 'quota-exceeded' : 'upload-failed'
    throw new PublishFailure('youtube-shorts', code, `Init upload failed (${initRes.status}): ${text.slice(0, 300)}`)
  }
  const resumableUrl = initRes.headers.get('location')
  if (!resumableUrl) {
    throw new PublishFailure('youtube-shorts', 'upload-failed', 'YouTube did not return a resumable upload URL')
  }

  // Step 2: fetch video bytes and PUT to the resumable URL.
  // For simplicity we upload in a single PUT — sufficient for Shorts (< 60s,
  // typically < 50 MB) and well under YouTube's 5 GB single-chunk limit.
  const { buffer, contentType } = await fetchVideoBytes(asset.videoUrl)
  // Convert Buffer → Uint8Array so fetch's BodyInit typing is satisfied.
  const bodyBytes = new Uint8Array(buffer)
  const uploadRes = await fetch(resumableUrl, {
    method: 'PUT',
    headers: {
      'Content-Type':   contentType,
      'Content-Length': String(bodyBytes.byteLength),
    },
    body: bodyBytes,
  })
  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '')
    const retryable = uploadRes.status >= 500 || uploadRes.status === 429
    const code = uploadRes.status === 403 ? 'quota-exceeded' : 'upload-failed'
    throw new PublishFailure('youtube-shorts', code, `Upload failed (${uploadRes.status}): ${text.slice(0, 300)}`, retryable)
  }

  const created = await uploadRes.json() as { id?: string; snippet?: { publishedAt?: string } }
  if (!created.id) {
    throw new PublishFailure('youtube-shorts', 'upload-failed', 'YouTube accepted the upload but returned no video id')
  }

  return {
    provider:   'youtube-shorts',
    externalId: created.id,
    postedAt:   created.snippet?.publishedAt ?? new Date().toISOString(),
    publicUrl:  `https://www.youtube.com/shorts/${created.id}`,
    raw:        created as unknown as Record<string, unknown>,
  }
}

export const youtubeShortsProvider: PublishProvider = {
  id:       'youtube-shorts',
  label:    'YouTube Shorts',
  requires: { userSecretKind: 'youtube' },
  publish:  publishYouTubeShort,
}
