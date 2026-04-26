/**
 * Wake hooks — Felixcraft-style "you'll know the moment work is done."
 *
 * Fires a Slack notification (when configured) for completion of a Run dispatch
 * or any other event the caller cares about. Fire-and-forget; never throws.
 *
 * Usage:
 *   import { wake } from '@/lib/notify/wake'
 *   void wake({ userId, runId, title: 'Sentry fix landed', description: 'PR #247 ready for review' })
 */

import { getSlackConfig, postSlackNotification, approvalBlocks } from '@/lib/slack/client'

export interface WakeOpts {
  userId:         string
  runId?:         string
  title:          string
  description?:   string
  dashboardPath?: string
}

export async function wake(opts: WakeOpts): Promise<{ posted: boolean }> {
  try {
    const cfg = await getSlackConfig(opts.userId)
    if (!cfg.webhookUrl) return { posted: false }
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
    const path = opts.dashboardPath ?? (opts.runId ? `/board?runId=${encodeURIComponent(opts.runId)}` : '/board')
    const dashboardUrl = `${baseUrl}${path}`
    const blocks = opts.runId
      ? approvalBlocks({
          runId:        opts.runId,
          title:        opts.title,
          description:  opts.description ?? '',
          dashboardUrl,
        })
      : [
          { type: 'section', text: { type: 'mrkdwn', text: `*${opts.title}*\n${opts.description ?? ''}` } },
          { type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Nexus' }, url: dashboardUrl }] },
        ]
    const posted = await postSlackNotification(cfg, { text: opts.title, blocks })
    return { posted }
  } catch {
    return { posted: false }
  }
}
