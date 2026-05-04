/**
 * Google Drive API helpers.
 * Requires an OAuth access token from the Google OAuth flow.
 */

const DRIVE_BASE = 'https://www.googleapis.com'

export interface DriveFile {
  id:          string
  name:        string
  webViewLink: string
  mimeType:    string
}

/** Upload any file (PDF, text, etc.) to Google Drive */
export async function uploadFile(
  token: string,
  opts: {
    name:      string
    content:   string | Uint8Array
    mimeType:  string
    folderId?: string
  },
): Promise<DriveFile | null> {
  const metadata: Record<string, unknown> = {
    name:     opts.name,
    mimeType: opts.mimeType,
  }
  if (opts.folderId) metadata.parents = [opts.folderId]

  const boundary = 'nexus-multipart-boundary'
  const contentPart = typeof opts.content === 'string'
    ? opts.content
    : Buffer.from(opts.content).toString('base64')

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    `Content-Type: ${opts.mimeType}`,
    typeof opts.content !== 'string' ? 'Content-Transfer-Encoding: base64' : '',
    '',
    contentPart,
    `--${boundary}--`,
  ].filter(line => line !== undefined).join('\r\n')

  try {
    const res = await fetch(
      `${DRIVE_BASE}/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,mimeType`,
      {
        method:  'POST',
        headers: {
          Authorization:  `Bearer ${token}`,
          'Content-Type': `multipart/related; boundary="${boundary}"`,
        },
        body,
        // 60s — multipart uploads of large generated docs can be slow but not
        // infinite. Cap to prevent function-second exhaustion.
        signal:  AbortSignal.timeout(60_000),
      },
    )
    if (!res.ok) return null
    return await res.json() as DriveFile
  } catch { return null }
}

/** Create a Google Doc from plain text (converts automatically) */
export async function createGoogleDoc(
  token: string,
  opts: { title: string; content: string; folderId?: string },
): Promise<DriveFile | null> {
  // Upload as plain text with Google Docs MIME type triggers conversion
  return uploadFile(token, {
    name:      opts.title,
    content:   opts.content,
    mimeType:  'application/vnd.google-apps.document',
    folderId:  opts.folderId,
  })
}

/** Upload a PDF file (from a URL — fetch then re-upload) */
export async function uploadPdfFromUrl(
  token: string,
  opts: { name: string; url: string; folderId?: string },
): Promise<DriveFile | null> {
  try {
    const pdfRes = await fetch(opts.url, { signal: AbortSignal.timeout(30_000) })
    if (!pdfRes.ok) return null
    const bytes = new Uint8Array(await pdfRes.arrayBuffer())
    return uploadFile(token, {
      name:     opts.name,
      content:  bytes,
      mimeType: 'application/pdf',
      folderId: opts.folderId,
    })
  } catch { return null }
}

/** List files in a folder */
export async function listFiles(token: string, folderId?: string, limit = 20): Promise<DriveFile[]> {
  const q = folderId
    ? `'${folderId}' in parents and trashed=false`
    : `'root' in parents and trashed=false`
  try {
    const res = await fetch(
      `${DRIVE_BASE}/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,webViewLink,mimeType)&pageSize=${limit}&orderBy=modifiedTime desc`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal:  AbortSignal.timeout(15_000),
      },
    )
    if (!res.ok) return []
    const data = await res.json() as { files?: DriveFile[] }
    return data.files ?? []
  } catch { return [] }
}
