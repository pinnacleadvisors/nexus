# Agent Generation Protocol

> **Trigger.** Whenever the user says any of the following (or a paraphrase), Claude MUST follow this protocol instead of writing code directly:
> - "create an agent that …"
> - "make an agent for …"
> - "spawn a new agent to …"
> - "I want an agent that …"
> - "build me an agent to …"

Claude responds by delegating to the `agent-generator` managed agent. The protocol emits **four artifacts**, and is idempotent so it can be re-run when the user refines the spec.

## Why managed agents

Nexus defaults to **Claude Code managed agents** (`.claude/agents/*.md`) because:

1. Zero infra — Claude Code loads the markdown file at session start, no hosting or deploy step.
2. The markdown frontmatter is a portable spec. Tools, model, and system prompt translate cleanly to OpenAI Assistants, Vercel AI SDK 6, or the Anthropic Managed Agents API.
3. Version controlled — each agent is a single reviewable file.

To keep agents portable, the spec file MUST contain:

- `name` — slug, unique across the library.
- `description` — when to use (this is what the dispatcher reads).
- `tools` — comma-separated list drawn from the standard tool catalog (`Read`, `Edit`, `Grep`, `Glob`, `Bash`, `WebFetch`, `WebSearch`). Keep this minimal; avoid Claude-only tools unless essential.
- `model` — optional hint (`opus`, `sonnet`, `haiku`, or a concrete model id). Runtime falls back to `claude-sonnet-4-6` when the hint is not recognised.
- `transferable` — if `true`, the system prompt avoids referencing Claude-specific primitives so the file can be reused by a non-Claude runtime.

## Step 1 — Write the agent markdown

Location: `.claude/agents/<slug>.md`

Template:

```markdown
---
name: <slug>
description: <one-sentence trigger rule — "Use when the user asks to X">
tools: Read, Grep, Bash
model: sonnet
transferable: true
env:
  - NAME_OF_ENV_VAR        # document what the env var is for in body
---

You are the <Title-Case Name> agent.

## Responsibilities
- …

## Inputs
- …

## Outputs
- …

## Handoffs
- Call `/supermemory` after every non-trivial run so the work is archived.
- If a workflow needed changing, call `/workflow-optimizer`.

## Non-goals
- …
```

## Step 2 — Register in Supabase

Persist the spec so it survives across Claude sessions and surfaces in the Nexus UI.

```ts
await fetch('/api/agents', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    slug,
    name,
    description,
    tools,         // string[]
    model,
    transferable,
    envVars,       // string[] of required env var NAMES only — never values
    systemPrompt,  // the body of the markdown file
  }),
})
```

The `agent_library` table stores one row per agent, keyed by `slug`. The API route upserts on `(user_id, slug)` so re-running the protocol updates rather than duplicates.

## Step 3 — Seed molecular memory

So the same agent can be found, re-used, and remixed in other projects:

```bash
node .claude/skills/molecularmemory_local/cli.mjs entity concept "<Title-Case Name>" \
  --description="<one-sentence>"

node .claude/skills/molecularmemory_local/cli.mjs atom "<Title-Case Name> agent exists" \
  --fact="<slug> is a Claude managed agent that <responsibility>" \
  --source="file://.claude/agents/<slug>.md" \
  --links="<Title-Case Name>,agent-library"

node .claude/skills/molecularmemory_local/cli.mjs graph
node .claude/skills/molecularmemory_local/cli.mjs reindex
```

If the agent is part of a larger capability cluster (e.g. "research agents"), add it to or create a MOC in `memory/molecular/mocs/`.

## Step 4 — Document env vars

If the agent requires new env vars:

1. Add them to `memory/platform/SECRETS.md` under the matching phase/section.
2. Do NOT commit values — only variable names and where to get them.
3. Mention in the agent body that the env vars are read from Doppler / the hosting environment.

## Step 5 — Transferability checklist

Before returning the agent to the user, the generator runs this checklist:

- [ ] System prompt does not reference Claude-only tool names in critical paths.
- [ ] `tools:` list contains only items from the standard catalog.
- [ ] Env var names are uppercase snake, no defaults hardcoded.
- [ ] Handoff instructions use slash-name syntax (`/supermemory`) that the dispatcher can map across runtimes.
- [ ] A short "Fallback runtime" paragraph explains how to run the agent against OpenAI / Vercel AI SDK if Claude is unavailable.

## Long-Horizon policy

If the user asks for an agent whose build would take more than ~5 minutes of implementation work (e.g. requires new API routes, migrations, or UI), the generator pauses after Step 1 and emits a `task_plan.md` entry for user review before touching Steps 2–4. This aligns with Nexus' Long-Horizon Task Protocol.

## See also

- `.claude/agents/agent-generator.md` — the managed agent that executes this protocol.
- `.claude/agents/supermemory.md` — archives every run.
- `.claude/agents/workflow-optimizer.md` — consumes review-node feedback to improve agents over time.
- `AGENTS.md` — top-level contributor guide.
