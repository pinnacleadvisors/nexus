# Loop template library (`.claude/loops/`)

Version-controlled, reusable **Loop templates** — the file-based companion to the
runtime `loops` table (migration 094; `lib/loops/`, `app/api/loops/`). A template
is a ready-to-instantiate `LoopCreateInput` payload + the per-iteration steps an
agent runs. The DB table is the *runtime* library (an instantiated loop fires);
this folder is the *catalogue* of replayable loop shapes that any agent can read,
propose, or instantiate.

Discoverable from [`AGENTS.md` → Operator-gated loop pattern](../../AGENTS.md#operator-gated-loop-pattern-ralph-loop) so every agent sees it.

## Templates

| Template | What it does | Primary executor |
|---|---|---|
| [`dev-prod-test-iterate.md`](dev-prod-test-iterate.md) | change → dev test (`npm run dev` + Playwright authed/real-device-mobile) → if green, deploy + prod test (`nexus.coolifycloudtunnel.uk`) → iterate until production-ready, with env cleanup each cycle | [`loop-runner`](../agents/loop-runner.md) |

## Which agents should use these

- [`loop-runner`](../agents/loop-runner.md) — **executes** an instantiated Loop one bounded iteration per dispatch; reads the matching template here for the concrete per-iteration steps.
- [`platform-dev-loop`](../agents/platform-dev-loop.md), [`engineering-lead`](../agents/departments/engineering/engineering-lead.md) + roles ([builder](../agents/departments/engineering/builder.md) / [tester](../agents/departments/engineering/tester.md) / [deployer](../agents/departments/engineering/deployer.md)) — when a change needs verifying before it ships, follow `dev-prod-test-iterate` (dev gate → prod gate) rather than improvising a one-off verify.
- [`bug-hunt-loop`](../agents/bug-hunt-loop.md), [`codex-operator`](../agents/codex-operator.md) — same dev→prod verification spine for fixes.

Reading a template ≠ auto-running it. Instantiating an actual Loop is operator-gated (the `loops` table is the source of truth; nothing else spawns a Loop).

## Instantiate a template

Create it **paused** (dormant in the runtime library), then resume from
`/settings → Loops` when you want it to run — the `loops` table auto-dispatches
on create, so `status: "paused"` keeps it operator-gated:

```bash
doppler run -- bash -c 'curl -s -X POST "$NEXT_PUBLIC_APP_URL/api/loops" \
  -H "authorization: Bearer $NEXUS_OPS_TOKEN" -H "content-type: application/json" \
  -d @.claude/loops/<template>.json'   # or paste the template's JSON block
```

## Add a new template

1. Write `.claude/loops/<slug>.md` — a `LoopCreateInput` JSON block (`status: "paused"`,
   `delegated_agent_slug`, `north_star_md`, `end_outcome_md`, caps, `approval_gates`)
   + the per-iteration steps + cleanup rules. Mirror `dev-prod-test-iterate.md`.
2. Add a row to the Templates table above.
3. Keep every [Ralph-loop invariant](../../AGENTS.md#operator-gated-loop-pattern-ralph-loop):
   operator-gated kickoff, bounded per cycle, cost/iteration/time caps, draft PRs
   only, no auto-merge, memory atom on a generalisable lesson.
