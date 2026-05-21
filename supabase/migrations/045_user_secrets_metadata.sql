-- 045_user_secrets_metadata — per-row JSONB metadata column.
--
-- Adds a `metadata jsonb` column so AI-provider preferences (subscription
-- tier, execution mode, future routing weights) can ride alongside the
-- encrypted secret without spawning a new table per knob.
--
-- Stored shape for the canonical "preferences" row:
--   user_secrets WHERE user_id=<u> AND kind=<provider> AND name='preferences'
--   metadata = {
--     "subscription_tier": "20x Max" | "5x Max" | "Pro" | "API only",
--     "execution_mode":    "subscription" | "api" | "node-pty"
--   }
-- The row's `value` is a dummy empty string — the encrypted column is unused
-- for preference rows. Helper code in lib/user-secrets.ts hides the dummy.
--
-- Future toggles add new keys under metadata WITHOUT new migrations. Schema
-- drift is bounded by the helper's validation, not by SQL.

alter table public.user_secrets
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- No index — preference queries are always (user_id, kind, name='preferences')
-- which the existing primary key already covers. Adding an index on jsonb
-- would only help if we ever query BY metadata content; for now we just read
-- it back after the PK lookup.

comment on column public.user_secrets.metadata is
  'Per-row JSONB metadata for AI-provider preferences (subscription tier, execution mode, etc.). Defaults to empty object so existing secret rows are unaffected. See lib/user-secrets.ts for the canonical helper surface.';
