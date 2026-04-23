/**
 * lib/publish/tiktok.ts — TikTok publisher stub.
 *
 * Rejected intentionally until the TikTok for Developers review process is
 * completed and a sandbox access token is obtained. The shape is in place so
 * /api/publish, the UI, and the measure-phase ingestion do not have to change
 * when the real implementation lands.
 */

import { PublishFailure, type PublishAsset, type PublishProvider, type PublishResult } from './types'

export async function publishTikTok(
  _asset:       PublishAsset,
  _credentials: Record<string, string>,
): Promise<PublishResult> {
  throw new PublishFailure(
    'tiktok',
    'not-implemented',
    'TikTok publisher not yet implemented. Complete the TikTok for Developers app review, then replace this stub with the Content Posting API call.',
  )
}

export const tiktokProvider: PublishProvider = {
  id:       'tiktok',
  label:    'TikTok',
  requires: { userSecretKind: 'tiktok' },
  publish:  publishTikTok,
}
