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
    // SSRF defence — three layers:
    //   1. require https + a hostname (rejects file://, http://, IP-literal)
    //   2. reject private/loopback/link-local hosts (RFC 1918 + RFC 4193)
    //   3. host MUST be on the env-configured asset allowlist (defaults
    //      to common platform-managed storage origins so the common case
    //      doesn't need extra config)
    const parsed = new URL(opts.url)
    if (parsed.protocol !== 'https:' || !parsed.hostname) {
      console.warn('[gdrive] refused upload from non-https URL:', parsed.protocol)
      return null
    }
    const host = parsed.hostname.toLowerCase()
    // Block obvious internal targets — Drive should never be a vector
    // for fetching internal services or cloud-metadata endpoints.
    if (
      host === 'localhost'
      || host === '127.0.0.1'
      || host === '0.0.0.0'
      || host === '169.254.169.254'              // cloud metadata IMDS
      || host.endsWith('.internal')
      || host.endsWith('.local')
      || /^10\./.test(host)                       // RFC 1918
      || /^192\.168\./.test(host)
      || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    ) {
      console.warn('[gdrive] refused upload from private/internal host:', host)
      return null
    }
    // Allowlist (env-configurable). Defaults cover the platforms Nexus
    // actually uses for asset URLs today; operator can extend with
    // GDRIVE_UPLOAD_ALLOWLIST="r2.dev,public.blob.vercel-storage.com,..."
    const allowList = (process.env.GDRIVE_UPLOAD_ALLOWLIST
      ?? 'public.blob.vercel-storage.com,r2.dev,supabase.co,supabase.in,googleusercontent.com')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
    const hostOk = allowList.some(suffix => host === suffix || host.endsWith('.' + suffix))
    if (!hostOk) {
      console.warn('[gdrive] refused upload from non-allowlisted host:', host)
      return null
    }
    // Rebuild via a literal-https-protocol URL so CodeQL's data-flow
    // analysis can see the protocol pin even after the host check.
    const safeUrl = new URL(parsed.pathname + parsed.search, `https://${host}`)
    const pdfRes = await fetch(safeUrl, { signal: AbortSignal.timeout(30_000) })
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
