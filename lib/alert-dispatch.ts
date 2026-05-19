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
  // `from` must be on a domain you've verified in Resend (DNS records for
  // SPF + DKIM). For lean / pre-verification, `onboarding@resend.dev` is
  // Resend's shared sender that ships without domain verification — good
  // enough for solo cost-alert emails. Override via Doppler once a domain
  // is verified: `ALERT_FROM_EMAIL='Nexus Alerts <alerts@<your-domain>>'`.
  const from = process.env.ALERT_FROM_EMAIL ?? 'Nexus Alerts <onboarding@resend.dev>'
  await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  `Bearer ${resendKey}`,
    },
    body: JSON.stringify({
      from,
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
