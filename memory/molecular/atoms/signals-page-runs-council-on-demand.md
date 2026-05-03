---
title: signals page runs council on demand
created: 2026-05-02
links:
  - mocs/autonomous-qa
---

# Signals page runs council on demand

`/signals` (sidebar: "Signals") surfaces opportunity scouts. Daily at 08:00 UTC `/api/cron/signal-review` runs an LLM council over Tavily / Firecrawl signals; the page also exposes a "Run council now" button for ad-hoc dispatch. Cron auth: bearer `CRON_SECRET`; runs as the first user in `ALLOWED_USER_IDS`. Signal rows live in migration 020.

Source: `vercel.json:5-7`, `app/(protected)/signals/page.tsx`, `supabase/migrations/020_signals.sql`.
