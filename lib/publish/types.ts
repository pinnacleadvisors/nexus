/**
 * lib/publish/types.ts — shared types for the publish/distribute pipeline (A10).
 */

export type PublishProviderId = 'youtube-shorts' | 'tiktok' | 'instagram-reels'

/**
 * Minimum required asset shape. The video URL must be publicly reachable by
 * the publisher (typically a signed R2 download URL or a public CDN asset).
 */
export interface PublishAsset {
  videoUrl:     string
  title:        string
  description?: string
  tags?:        string[]
  /** Optional publish-visibility hint. Defaults to 'public'. */
  visibility?:  'public' | 'unlisted' | 'private'
  /** Optional thumbnail URL (ignored by providers that don't support it). */
  thumbnailUrl?: string
  /** Optional runId — provider writes externalId back onto runs.metrics. */
  runId?:       string
}

export interface PublishResult {
  provider:   PublishProviderId
  externalId: string
  postedAt:   string
  publicUrl?: string
  raw?:       Record<string, unknown>
}

export interface PublishError extends Error {
  provider?:  PublishProviderId
  code?:      'not-configured' | 'not-implemented' | 'auth-failed' | 'upload-failed' | 'quota-exceeded' | 'unknown'
  retryable?: boolean
}

export class PublishFailure extends Error implements PublishError {
  provider:  PublishProviderId
  code:      PublishError['code']
  retryable: boolean
  constructor(provider: PublishProviderId, code: PublishError['code'], message: string, retryable = false) {
    super(message)
    this.name      = 'PublishFailure'
    this.provider  = provider
    this.code      = code
    this.retryable = retryable
  }
}

/**
 * A provider is a named implementation of `publish(asset, credentials)`.
 * Credentials come from either env vars or (preferred) user_secrets.
 */
export interface PublishProvider {
  id:       PublishProviderId
  label:    string
  /** Env vars or user_secrets kind expected. Used by /api/publish to fetch them. */
  requires: { envVars?: string[]; userSecretKind?: string }
  publish(asset: PublishAsset, credentials: Record<string, string>): Promise<PublishResult>
}
