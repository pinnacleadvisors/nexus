# Dev fixture harness — testing the full UI flow without real OAuth

> **TL;DR** — flip `/settings` → Access tab → "Dev fixture harness" to **ON**.
> The platform overlays synthetic `connected_accounts` rows for every supported
> platform AND short-circuits `executeBusinessAction()` to return canned
> responses. Create a business, graduate it, chat with its agents, run a
> smoke — all without connecting a single real OAuth account or spending a
> cent on Composio.

---

## Why this exists

When developing a new feature for Nexus you usually need to verify the whole
operator UI flow:

1. Create a business via the wizard
2. Open the GraduateModal + run a smoke
3. Connect platforms via the suggested-connectors cards
4. Chat with the business's agents about the (now-connected) data
5. Watch the agents dispatch real-feeling Composio actions

Without fixtures, step 3 forces you to OAuth into Stripe-test, Gmail-test,
Slack-test, etc. every time you want to verify a UI tweak. Worse: many platforms
don't HAVE a test mode (Twitter, LinkedIn, ConvertKit, ...). So you end up either
mocking each call ad-hoc or never actually exercising the flow.

The fixture harness:

- Replicates the **shape** of every connection at the `/api/connected-accounts`
  + `executeBusinessAction()` boundary.
- Returns realistic-looking canned responses (synthetic IDs, current timestamps,
  echoed input fields) so downstream UI renders look real.
- Lets the dev loop exercise the full flow with a single toggle.

## When to use it

- **Always on** while developing new UI features that touch connectors, chat,
  graduate-flow, or anything that calls an agent which dispatches Composio.
- **Always off** when verifying real production behaviour (smoke against prd,
  graduate-to-real-mode dry-runs).
- Per the operator: dev account should keep this ON by default.

## How to flip it

1. Open `/settings`
2. Click the **Access** tab
3. Top card: **Dev fixture harness** — click "Turn fixture mode ON"

The toggle is instant for new calls (the read-through cache invalidates +
warms within the same request). Existing in-flight dispatches keep using
whatever value they saw at start.

## What gets overlaid

### Connected accounts (`lib/fixtures/connected-accounts.ts`)

V1 covers 12 platforms — Stripe, Shopify, Gmail, ConvertKit, Resend, Twitter,
LinkedIn, YouTube, TikTok, Slack, Notion, Google Calendar. Each renders in
`/settings/accounts` with a "Fixture" tag and `composio_account_id =
fixture-<platform>`.

To add a platform: append an entry to `FIXTURE_CONNECTED_ACCOUNTS`. The dev
panel auto-picks it up on next page load.

### Action responses (`lib/fixtures/actions.ts`)

For each platform, a small set of common verbs returns canned objects shaped
like the real Composio response. The agent's downstream code path (UI parser,
KPI updater, audit logger) works without modification because the shapes
match.

To add a verb: add a key under the platform's record in `FIXTURE_ACTIONS`.
Each fixture function receives the same `arguments` object the agent would
pass to Composio.

## What happens to verbs WITHOUT a fixture

Fixture mode is **fail-loud**: if the agent dispatches a verb with no fixture
registered, `executeBusinessAction()` throws

```
fixture_mode_no_fixture_for <platform>:<action> — add an entry in
  lib/fixtures/actions.ts FIXTURE_ACTIONS
```

This is intentional — the operator notices the missing fixture immediately and
adds it. Silent fallback to real Composio would defeat the purpose (real
$ on a test dispatch).

## What does NOT get overlaid

- **Real DB state** — businesses, simulation runs, audit log, board cards.
  These are real DB writes; fixture mode only short-circuits external
  network calls.
- **LLM dispatches** — `getLlm()` still calls the real provider chain.
  Fixture mode doesn't subsume cost-guard; the simulation flag on
  business_operators is the right knob for that.
- **Cron + Inngest** — these run on schedules independent of the operator's
  fixture flag. A cron firing while fixture mode is on still hits real
  Composio for non-operator dispatches.
- **OAuth connect flows** — the `/api/connected-accounts/init` route still
  fires real OAuth. Use the fixture mode toggle to AVOID needing to OAuth,
  not as a way to fake it during flow.

## Pre-commit checklist additions (for ongoing growth)

Every PR that adds a new OAuth provider, a new agent that calls a new verb,
or a new third-party SDK should also add the corresponding fixtures:

- New provider in `lib/oauth/providers.ts` →
  - Add a row to `FIXTURE_CONNECTED_ACCOUNTS` in `lib/fixtures/connected-accounts.ts`
  - Add a fixture function for at least the most common verb in `FIXTURE_ACTIONS`
- New agent dispatch verb →
  - Add a fixture function for it in the platform's record
- New skill that calls Composio →
  - Same as above — add a fixture for any net-new verb

The growth is additive. Fixtures never break each other; missing fixtures
surface loudly via the fail-loud error above.

## Cleanup

- Toggle off: `/settings` → Access → "Turn fixture mode OFF"
- Or via API: `PATCH /api/dev/fixtures/active` with `{ enabled: false }`
- Or via SQL: `update fixture_mode_active set enabled = false where user_id = '<your-clerk-id>'`

The cache invalidates within ~30 s if you change DB directly; the toggle
endpoint invalidates immediately.

## Related

- `task_plan-dev-loop-fixtures.md` — design doc for V2+ enhancements
- `lib/llm/provider-settings.ts` — the cache pattern this store mirrors
- `lib/composio/actions.ts` — where the short-circuit lives
- `app/api/connected-accounts/route.ts` — where the fixture overlay
  is merged into the list response
