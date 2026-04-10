/**
 * Inngest client — background job queue for async agent tasks.
 *
 * Sign up at https://inngest.com → create an app → copy your keys to Doppler:
 *   INNGEST_EVENT_KEY  — send events (server-side)
 *   INNGEST_SIGNING_KEY— verify webhooks from Inngest cloud
 *
 * In development: run `npx inngest-cli@latest dev` to start local dev server.
 */

import { Inngest } from 'inngest'

export const inngest = new Inngest({
  id: 'nexus',
  name: 'Nexus',
  eventKey: process.env.INNGEST_EVENT_KEY,
})

// ── Typed event payloads ──────────────────────────────────────────────────────

export type Events = {
  /** Fired when a Kanban card moves to Completed (approved) */
  'milestone/completed': {
    data: {
      milestoneId: string
      milestoneTitle: string
      projectId: string
      projectName: string
      assetUrl?: string
      agentName?: string
      notionPageId?: string
    }
  }
  /** Fired when OpenClaw creates an asset */
  'asset/created': {
    data: {
      assetUrl: string
      assetType: 'pdf' | 'doc' | 'image' | 'other'
      title: string
      projectId?: string
      milestoneId?: string
    }
  }
  /** Fired once daily by a cron to check cost thresholds */
  'alerts/daily-check': {
    data: Record<string, never>
  }
  /** Fired when an agent status changes */
  'agent/status-changed': {
    data: {
      agentId: string
      agentName: string
      prevStatus: string
      newStatus: string
    }
  }
}
