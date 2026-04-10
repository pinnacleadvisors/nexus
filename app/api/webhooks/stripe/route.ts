import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export const runtime = 'nodejs'

// ── Stripe webhook handler ────────────────────────────────────────────────────
// Set STRIPE_WEBHOOK_SECRET in Doppler once you have your endpoint secret.
// Required Stripe events to forward: payment_intent.succeeded, invoice.payment_succeeded
// Webhook URL to register in Stripe Dashboard: https://<your-domain>/api/webhooks/stripe

async function verifyStripeSignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  // Use the Web Crypto API to verify Stripe's HMAC-SHA256 signature
  // Stripe signature format: t=<timestamp>,v1=<hmac>
  try {
    const parts = Object.fromEntries(
      signature.split(',').map(p => p.split('=')),
    )
    const timestamp = parts['t']
    const expectedSig = parts['v1']
    if (!timestamp || !expectedSig) return false

    const payload = `${timestamp}.${body}`
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    )
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))
    const computed = Buffer.from(sig).toString('hex')
    return computed === expectedSig
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not configured' }, { status: 500 })
  }

  const signature = req.headers.get('stripe-signature') ?? ''
  const body = await req.text()

  const valid = await verifyStripeSignature(body, signature, secret)
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: { type: string; data: { object: Record<string, unknown> } }
  try {
    event = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const db = createServerClient()
  if (!db) {
    console.warn('[stripe-webhook] Supabase not configured — event not persisted')
    return NextResponse.json({ received: true })
  }

  // ── Handle relevant events ────────────────────────────────────────────────
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const pi = event.data.object
      const amount = typeof pi['amount'] === 'number' ? pi['amount'] / 100 : 0
      const desc = typeof pi['description'] === 'string' ? pi['description'] : null
      await db.from('revenue_events').insert({
        amount_usd: amount,
        source: 'stripe',
        description: desc,
        metadata: pi as import('@/lib/database.types').Json,
      })
      break
    }

    case 'invoice.payment_succeeded': {
      const inv = event.data.object
      const amount = typeof inv['amount_paid'] === 'number' ? inv['amount_paid'] / 100 : 0
      await db.from('revenue_events').insert({
        amount_usd: amount,
        source: 'stripe',
        description: typeof inv['description'] === 'string' ? inv['description'] : 'Invoice payment',
        metadata: inv as import('@/lib/database.types').Json,
      })
      break
    }

    default:
      // Unhandled event type — log but do not error
      console.log(`[stripe-webhook] Unhandled event type: ${event.type}`)
  }

  return NextResponse.json({ received: true })
}
