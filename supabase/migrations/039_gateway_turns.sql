-- 039_gateway_turns — substrate for plan-window budgeting + live activity.
--
-- One row per spawned `claude` or `codex` job. Populated by the Vercel-side
-- dispatch code (lib/claw/gateway-turns.ts insertGatewayTurn()) AFTER the
-- job lands. Fire-and-forget insert — if the row fails, dispatch still
-- succeeds and we lose that accounting row. Better than blocking dispatch
-- on accounting.
--
-- Consumed by:
--   - The bug-hunt loop's plan-window budget query (this PR)
--   - The chat Views Live activity panel (task_plan-chat-views.md V3)
--   - Future per-user usage analytics
--
-- Per-model weighting for plan-window math (read at query time, not
-- persisted): Opus 5×, Sonnet 1×, Haiku 0.25×, GPT-5.5-Codex 1×, default 1×.
-- This lets us tweak the multipliers without rewriting historical rows.

create extension if not exists "uuid-ossp";

create table if not exists public.gateway_turns (
  id                uuid          primary key default uuid_generate_v4(),
  user_id           text          not null,

  -- Which subscription plan this turn consumed:
  --   'claude-max'    = claude-gateway (Anthropic Max plan, 5h rolling window)
  --   'codex-pro'     = codex-gateway   (ChatGPT Pro plan, 5h rolling window)
  --   'anthropic-api' = direct API     (per-token spend — fallback only)
  plan              text          not null,

  -- Model alias as resolved by the spawn (e.g. 'opus', 'sonnet-4-6',
  -- 'gpt-5.5-codex'). Used for plan-window weighting (Opus = 5×, etc.).
  model             text,

  -- How the caller framed the turn — lets us slice usage by consumer
  -- (e.g. 'bug-hunt-bh-2026-...-i3', 'platform-chat-...', 'business-chat-inkbound-...').
  session_tag       text,

  duration_ms       integer,

  -- Token counts when the spawned CLI exposes them. Nullable — if absent,
  -- the plan-window math falls back to "count turns by model" (less
  -- precise but still bounded).
  input_tokens      integer,
  output_tokens     integer,

  -- Per-call USD estimate. Always 0.0000 for claude-max / codex-pro plans
  -- (flat-fee subscriptions — the loop's USD cap is a fallback only used
  -- on the anthropic-api plan). Computed from token counts × the model's
  -- per-MTok price when known.
  cost_estimate_usd numeric(8,4)  default 0.0000,

  -- Number of tool-use blocks observed in the turn (Phase 2b capture).
  tool_calls_count  integer       default 0,

  created_at        timestamptz   not null default now(),

  constraint gateway_turns_plan_check
    check (plan in ('claude-max', 'codex-pro', 'anthropic-api'))
);

-- Window queries: "what did this user consume on this plan in the last 5h?"
create index if not exists gateway_turns_user_plan_window_idx
  on public.gateway_turns (user_id, plan, created_at desc);

-- Session-slice queries: "what did this bug-hunt session consume in the last 5h?"
create index if not exists gateway_turns_session_tag_idx
  on public.gateway_turns (session_tag, created_at desc);

alter table public.gateway_turns enable row level security;

drop policy if exists gateway_turns_service_role on public.gateway_turns;
create policy gateway_turns_service_role
  on public.gateway_turns
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
