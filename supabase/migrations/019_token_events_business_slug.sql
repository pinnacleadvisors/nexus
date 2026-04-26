-- Migration: 019_token_events_business_slug
-- Description: Attach business_slug to token_events so the per-business daily
--              cost cap (lib/cost-guard.ts D10) can scope spend by business
--              when a dispatch routes to a per-business OpenClaw container.
--              Nullable — rows with NULL business_slug roll up into the
--              user-level cap only (USER_DAILY_USD_LIMIT).

ALTER TABLE token_events
  ADD COLUMN IF NOT EXISTS business_slug TEXT;

CREATE INDEX IF NOT EXISTS token_events_user_business_created_at
  ON token_events (user_id, business_slug, created_at DESC)
  WHERE user_id IS NOT NULL AND business_slug IS NOT NULL;
