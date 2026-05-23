-- 055_agent_library_hooks — per-agent hooks for the super-harness.
--
-- Phase 6 of task_plan-collaborative-chat.md. Each agent in agent_library
-- can now carry its own hooks block — same shape Claude Code's
-- settings.json `hooks` key uses (PreToolUse / UserPromptSubmit /
-- SessionStart / etc.). When the claude-gateway spawns the agent, it
-- merges this column with the repo-wide hooks from /repo/.claude/hooks/
-- (per services/claude-gateway/entrypoint.sh, PR #281) before writing
-- /root/.claude/settings.json.
--
-- v1 ships the column + the convention. The entrypoint wiring (read this
-- column, merge into settings.json) lands in a follow-up PR so this
-- migration can be applied independently without breaking existing agents.
--
-- Shape example (stored as jsonb):
--   {
--     "PreToolUse": [
--       { "matcher": "Bash", "hooks": [{ "type": "command", "command": ".claude/hooks/check-write-size.sh" }] }
--     ],
--     "UserPromptSubmit": [
--       { "hooks": [{ "type": "command", "command": ".claude/hooks/skill-router.sh" }] }
--     ]
--   }
--
-- Default is empty object so existing agents continue inheriting only the
-- repo-wide hooks (no behavioural change until an operator opts in).

alter table public.agent_library
  add column if not exists hooks jsonb not null default '{}'::jsonb;

-- No index — hooks are read with the row (point lookup by slug), not queried.
