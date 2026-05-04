/**
 * Shared alert dispatch helpers — used by /api/alerts and /api/chat (per-run cost alerts)
 */
import type { AlertThreshold } from '@/lib/types'

export async function sendSlackAlert(webhookUrl: string, message: string): Promise<void> {
  await fetch(webhookUrl, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ text: `🚨 *Nexus Alert*\n${message}` }),
    signal:  AbortSignal.timeout(10_000),
  })
}

export async function sendEmailAlert(to: string, subject: string, body: string): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY
  if (!resendKey) {
    console.warn('[alerts] RESEND_API_KEY not set — email alert skipped')
    return
  }
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from:    'Nexus Alerts <alerts@nexus.pinnacleadvisors.com>',
      to,
      subject,
      text:    body,
    }),
    signal:  AbortSignal.timeout(10_000),
  })
}

export async function sendSlackOrEmail(threshold: AlertThreshold, message: string): Promise<void> {
  if (threshold.channel === 'slack') {
    await sendSlackAlert(threshold.destination, message)
  } else {
    await sendEmailAlert(threshold.destination, `Nexus Alert: ${threshold.metric}`, message)
  }
}
