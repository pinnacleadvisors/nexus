/**
 * GET /api/models/available
 *
 * Returns the chat-composer model list: the curated static whitelist
 * (lib/chat/models.ts) MERGED with any newer Claude models discovered from the
 * Anthropic models API (lib/chat/model-discovery.ts). Lets a fresh release
 * (e.g. the next Opus) appear in the dropdown without a code edit.
 *
 * Owner-gated (Clerk). Always returns 200 with the static list as the floor —
 * discovery failures never break the dropdown.
 */
import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { AVAILABLE_MODELS, DEFAULT_MODEL_ID } from '@/lib/chat/models'
import { getAvailableChatModels } from '@/lib/chat/model-discovery'

export const runtime = 'nodejs'

export async function GET() {
  const session = await auth()
  if (!session.userId) {
    // Even unauthorized callers get the static list — it's not sensitive, and a
    // 401 would just make the dropdown fall back to its imported copy anyway.
    return NextResponse.json({ ok: true, models: AVAILABLE_MODELS, defaultId: DEFAULT_MODEL_ID, discovered: false })
  }
  try {
    const models = await getAvailableChatModels()
    return NextResponse.json({
      ok:        true,
      models,
      defaultId: DEFAULT_MODEL_ID,
      discovered: models.length > AVAILABLE_MODELS.length,
    })
  } catch {
    return NextResponse.json({ ok: true, models: AVAILABLE_MODELS, defaultId: DEFAULT_MODEL_ID, discovered: false })
  }
}
