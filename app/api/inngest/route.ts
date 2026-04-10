/**
 * Inngest event handler — receives and processes background jobs.
 *
 * Inngest calls this endpoint to execute background functions.
 * In development, the Inngest dev server proxies to localhost:3000/api/inngest.
 *
 * Required env vars (add to Doppler):
 *   INNGEST_EVENT_KEY   — for sending events
 *   INNGEST_SIGNING_KEY — for verifying Inngest webhook requests
 *
 * To send events from anywhere in the app:
 *   import { inngest } from '@/inngest/client'
 *   await inngest.send({ name: 'milestone/completed', data: { ... } })
 */

import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { functions } from '@/inngest/functions'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
})
