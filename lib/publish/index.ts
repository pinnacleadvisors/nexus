/**
 * lib/publish — provider registry + dispatch for the A10 publish step.
 *
 * Use `publish(providerId, asset, credentials)` to post an asset through the
 * named provider. Credentials come from the caller — typically fetched from
 * `user_secrets` (kind = provider.requires.userSecretKind) via lib/user-secrets.
 */

import type { PublishAsset, PublishProvider, PublishProviderId, PublishResult } from './types'
import { youtubeShortsProvider } from './youtube'
import { tiktokProvider }        from './tiktok'
import { instagramReelsProvider } from './instagram'

const PROVIDERS: Record<PublishProviderId, PublishProvider> = {
  'youtube-shorts':  youtubeShortsProvider,
  'tiktok':          tiktokProvider,
  'instagram-reels': instagramReelsProvider,
}

export function listProviders(): PublishProvider[] {
  return Object.values(PROVIDERS)
}

export function getProvider(id: string): PublishProvider | null {
  return (PROVIDERS as Record<string, PublishProvider>)[id] ?? null
}

export async function publish(
  providerId:  PublishProviderId,
  asset:       PublishAsset,
  credentials: Record<string, string>,
): Promise<PublishResult> {
  const provider = PROVIDERS[providerId]
  if (!provider) {
    throw new Error(`Unknown publish provider: ${providerId}`)
  }
  return provider.publish(asset, credentials)
}

export type { PublishAsset, PublishProvider, PublishProviderId, PublishResult } from './types'
export { PublishFailure } from './types'
