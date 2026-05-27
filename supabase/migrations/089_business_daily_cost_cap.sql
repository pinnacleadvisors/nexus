-- 089 — per-business daily cost cap (R3 of UX consult).
--
-- Today's cost-guard reads `business_operators.money_model.budget_usd` as a
-- TOTAL budget per business + platform-wide USER_DAILY_USD_LIMIT as the
-- daily ceiling. R3 adds a DAILY per-business cap so the operator can
-- protect against one runaway business starving the others.
--
-- Semantics:
--   - NULL means "inherit": the platform-wide USER_DAILY_USD_LIMIT applies
--     (split equally if needed, or whatever cost-guard decides).
--   - A positive integer is a hard daily cap in cents. cost-guard's
--     per-dispatch check refuses when today's accumulated spend +
--     intended marginal cost would exceed this.
--
-- Migration is idempotent: re-running is a no-op via IF NOT EXISTS.

alter table business_operators
  add column if not exists daily_cost_cap_cents integer
    check (daily_cost_cap_cents is null or daily_cost_cap_cents >= 0);

comment on column business_operators.daily_cost_cap_cents is
  'Per-business daily spend ceiling in cents. NULL = inherit platform-wide '
  'USER_DAILY_USD_LIMIT. cost-guard reads + enforces. Operator sets via the '
  '/businesses/<slug> BusinessCostWidget edit-mode (R3, 2026-05-27 UX consult).';
