-- Migration 073 — opt-in LLM-generated persona ticket bodies.
--
-- v1 used template-based ticket bodies (TICKET_BANK in personas.ts):
-- fast, deterministic, $0. Great for cost-zero replays.
--
-- v2-B adds an opt-in mode: when synthetic_voice='llm', the engine
-- dispatches the bound LLM provider to generate a unique 1-2 sentence
-- ticket body per inbound_ticket event, in the persona's voice. The
-- chaos becomes more realistic at the cost of ~$0.02 per run at
-- default settings (depends on provider).
--
-- Schema: text column with a CHECK constraint, defaulting to 'template'
-- so existing rows keep their v1 behaviour without backfill.

alter table simulation_runs
  add column if not exists synthetic_voice text not null default 'template'
    check (synthetic_voice in ('template', 'llm'));

comment on column simulation_runs.synthetic_voice is
  'Ticket-body generator: template (v1, free) | llm (v2-B, opt-in, per-call LLM cost).';
