-- 069_agent_library_inject_platform_brief — opt-out flag for the platform-brief injector.
--
-- When the gateway spawns a managed agent via /api/claude-session/dispatch,
-- it can prepend a "platform brief" (memory/INDEX.md + the most relevant
-- task_plan-*.md + a small set of memory-hq atoms) to the agent's task
-- message. This gives the spawned agent the same depth of context that
-- claude-gateway sessions naturally see — closing the autonomy-gap between
-- gateway-driven work (rich context) and dispatched-agent work (thin context).
--
-- Default: ON for every agent. The handful of agents that don't need it
-- (skill-trainer running sandboxed shell builds, doppler-broker doing
-- single-command secret-gated work) can flip it off:
--
--     update agent_library set inject_platform_brief = false where slug = '<slug>';
--
-- Failure path: the injector is fail-soft. If the brief can't be built
-- (file missing, memory-hq HTTP down, exceeds budget), the dispatch still
-- proceeds with the un-augmented brief.
--
-- See lib/agents/inject-platform-brief.ts for the helper and
-- task_plan-this-session-2026-05-26.md (in-session work) for the rollout.

alter table public.agent_library
  add column if not exists inject_platform_brief boolean not null default true;

comment on column public.agent_library.inject_platform_brief is
  'When true, /api/claude-session/dispatch prepends a memory-derived platform brief to the agent task message. Opt out for agents that operate in narrow sandboxes (skill-trainer, doppler-broker).';
