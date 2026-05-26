-- 070_business_simulation_flag — mark businesses that are running under the
-- simulation harness rather than against live money / live customers.
--
-- When `simulation = true`:
--   - lib/cost-guard.ts SHORT-CIRCUITS cash_spend writes (logged-only, never
--     billed against real Stripe/Composio)
--   - executeBusinessAction() refuses any verb classified as money-moving
--     (Stripe.charge, payouts, Composio.send_email to real recipients, etc.)
--   - The UI surfaces a 🧪 sim badge so the operator can't confuse them with
--     real businesses at a glance
--
-- Inspired by Microsoft's RD-Agent framework: thousands of synthetic personas
-- + chaotic, realistic friction → agents learn to navigate messy enterprise
-- environments rather than clean toy tasks. This column is the safety gate
-- that lets us seed that chaos without burning real spend.
--
-- `simulation_seed_at` records when the harness last seeded chaos data so
-- the operator can decide whether to re-seed (a top-up cron can run this on
-- a schedule once we wire it up).

alter table public.business_operators
  add column if not exists simulation         boolean     not null default false,
  add column if not exists simulation_seed_at timestamptz null;

comment on column public.business_operators.simulation is
  'When true, this business runs under the simulation harness — cost-guard short-circuits real spend, money-moving verbs are blocked, UI shows a sim badge. Set by scripts/seed-simulation-business.mjs.';
comment on column public.business_operators.simulation_seed_at is
  'When the simulation harness last seeded chaos data (personas / fake metrics / fake tickets). Null for non-sim businesses.';

create index if not exists business_operators_simulation_idx
  on public.business_operators (simulation)
  where simulation = true;
