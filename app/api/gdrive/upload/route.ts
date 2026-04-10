/**
 * POST /api/gdrive/upload
 *
 * Upload a file or create a Google Doc in Google Drive.
 * Body (JSON):
 *   { name, content?, url?, mimeType?, folderId?, type: 'doc' | 'pdf' | 'file' }
 *
 * - type=doc   → create a Google Doc from the `content` string
 * - type=pdf   → fetch PDF from `url`, re-upload to Drive
 * - type=file  → upload raw `content` as `mimeType`
 */
import { NextRequest, NextResponse } from 'next/server'
import { createGoogleDoc, uploadPdfFromUrl, uploadFile } from '@/lib/gdrive'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const token = req.cookies.get('oauth_token_google')?.value
    ?? process.env.GOOGLE_ACCESS_TOKEN

  if (!token) return NextResponse.json({ error: 'Google Drive not connected' }, { status: 401 })

  const body = await req.json() as {
    type:       'doc' | 'pdf' | 'file'
    name:       string
    content?:   string
    url?:       string
    mimeType?:  string
    folderId?:  string
  }

  let result = null

  if (body.type === 'doc') {
    if (!body.content) return NextResponse.json({ error: 'content is required for type=doc' }, { status: 400 })
    result = await createGoogleDoc(token, {
      title:    body.name,
      content:  body.content,
      folderId: body.folderId,
    })
  } else if (body.type === 'pdf') {
    if (!body.url) return NextResponse.json({ error: 'url is required for type=pdf' }, { status: 400 })
    result = await uploadPdfFromUrl(token, {
      name:     body.name,
      url:      body.url,
      folderId: body.folderId,
    })
  } else {
    if (!body.content) return NextResponse.json({ error: 'content is required for type=file' }, { status: 400 })
    result = await uploadFile(token, {
      name:     body.name,
      content:  body.content,
      mimeType: body.mimeType ?? 'text/plain',
      folderId: body.folderId,
    })
  }

  if (!result) return NextResponse.json({ error: 'Upload failed' }, { status: 502 })
  return NextResponse.json(result)
}
