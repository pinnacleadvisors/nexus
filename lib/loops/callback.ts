/**
 * lib/loops/callback.ts — scoped HMAC auth for the loop-runner → platform
 * iteration-result callback.
 *
 * Mirrors lib/platform-dev/dispatch.ts buildCallbackToken: the /start route
 * mints a per-(loop, nonce) token, embeds it in the dispatch brief, and the
 * agent echoes it back to POST /api/loops/[id]/iteration-result. The handler
 * verifies via HMAC under LOOP_CALLBACK_SECRET (falling back to CRON_SECRET).
 *
 * Why scoped HMAC over the ops bearer: the gateway container doesn't need to
 * hold NEXUS_OPS_TOKEN, and a leaked token only unlocks ONE loop's callback,
 * not every ops endpoint.
 */

import { createHmac } from 'node:crypto'

const NO_SECRET = 'no-secret-configured'

function secret(): string {
  return process.env.LOOP_CALLBACK_SECRET ?? process.env.CRON_SECRET ?? ''
}

export function buildLoopCallbackToken(loopId: string, nonce: string): string {
  const s = secret()
  if (!s) return NO_SECRET
  return createHmac('sha256', s).update(`${loopId}:${nonce}`).digest('hex')
}

export function verifyLoopCallbackToken(loopId: string, nonce: string, token: string): boolean {
  if (!nonce || !token) return false
  const expected = buildLoopCallbackToken(loopId, nonce)
  if (expected === NO_SECRET) return false
  if (expected.length !== token.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i)
  return diff === 0
}
