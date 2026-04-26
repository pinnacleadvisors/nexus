---
type: atom
title: "Manual — Stripe webhook setup"
id: manual-stripe-webhook
created: 2026-04-26
sources:
  - ROADMAP.md#L99
links:
  - "[[manual-steps]]"
status: active
lastAccessed: 2026-04-26
accessCount: 0
---

# Manual — Stripe webhook setup

✅ Done. Add `STRIPE_WEBHOOK_SECRET` to Doppler (Stripe Dashboard → Developers → Webhooks → endpoint secret). Register webhook endpoint in Stripe Dashboard at `https://<your-vercel-domain>/api/webhooks/stripe` for events: `payment_intent.succeeded`, `invoice.payment_succeeded`.

## Related
- [[manual-steps]]
