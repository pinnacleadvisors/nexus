/**
 * lib/publish/instagram.ts — Instagram Reels publisher stub.
 *
 * Intentional stub — Instagram Graph API requires a Business / Creator account
 * plus the Content Publishing permission. The UI and /api/publish route still
 * show it as a provider so the wiring is complete; the actual POST to
 *   POST /{ig-user-id}/media
 *   POST /{ig-user-id}/media_publish
 * will replace this body when credentials are in place.
 */

import { PublishFailure, type PublishAsset, type PublishProvider, type PublishResult } from './types'

export async function publishInstagramReel(
  _asset:       PublishAsset,
  _credentials: Record<string, string>,
): Promise<PublishResult> {
  throw new PublishFailure(
    'instagram-reels',
    'not-implemented',
    'Instagram Reels publisher not yet implemented. Requires a Business/Creator account with the instagram_content_publish permission. Replace this stub with the media + media_publish calls.',
  )
}

export const instagramReelsProvider: PublishProvider = {
  id:       'instagram-reels',
  label:    'Instagram Reels',
  requires: { userSecretKind: 'instagram' },
  publish:  publishInstagramReel,
}
