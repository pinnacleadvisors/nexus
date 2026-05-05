---
type: moc
title: "Memory & Cost Incidents"
id: memory-and-cost-incidents
created: 2026-05-04
---

# Memory & Cost Incidents

Hub for postmortem-style atoms covering incidents where Nexus burned compute, memory, or paid quotas faster than expected. Each atom captures one incident with: symptom, root cause, fix, generalised pattern, prevention surface.

This MOC is the case-study counterpart to two forward-looking documents:
- [`docs/RETRY_STORM_AUDIT.md`](../../../docs/RETRY_STORM_AUDIT.md) — failure-driven amplification audit + checklist.
- [`AGENTS.md`](../../../AGENTS.md) "Retry-storm" + "Webhook self-amplification" checklists — pre-commit prevention rules.

The audit lists what *could* go wrong systematically. The atoms here record what *did* go wrong, with timestamps and commits. New incidents land here as they're triaged.

## Atoms

### 2026-05 — Webhook self-amplification class
- [[atoms/webhook-self-amplification-log-drain-2026-05-04|Vercel log drain hit 70-100 req/s + 338MB middleware (2026-05-04)]]

### 2026-05 — Schema-mismatch retry-storm class
- [[atoms/tasks-table-has-no-idea-fk-before-migration-025|tasks table had no idea/run FK before migration 025]]
- [[atoms/orphan-sweep-cron|Orphan-sweep cron deletes stale Kanban cards nightly]]
- [[atoms/slack-webhook-encrypted-at-rest-after-026|Slack webhook URLs encrypted at rest after migration 026]]

## Patterns observed across incidents

| Pattern | Trigger | Prevention surface |
|---|---|---|
| **Schema-mismatch retry-storm** | Migration applied to dev but not prod; route 500s; upstream auto-retries. | Fail-soft inserts ([`lib/board/insert-task.ts`](../../../lib/board/insert-task.ts)); always-200 envelope; `claimEvent` idempotency. |
| **Webhook self-amplification** | Receiver's own output is observed by the same upstream that triggered it. | Filter self-traffic at the boundary; exclude HMAC-auth routes from Clerk middleware; lazy-load heavy SDKs. |
| **Eager SDK init** | Heavy SDK module-imported at top of a high-rate route. | `await import()` inside the function that uses it; type-only static import. |
| **Sync writes on hot paths** | Slow downstream (R2, Supabase) blocks the response. | `after()` from `next/server` to background non-critical writes. |

## Adding a new incident atom

When a postmortem-worthy event is triaged:

1. Create `memory/molecular/atoms/<slug>-YYYY-MM-DD.md` with `kind: incident` and `importance: high|critical` in frontmatter.
2. Body sections: **Symptom**, **Root cause**, **Generalised pattern**, **Fix (commit ref)**, **Forward-looking prevention** (link to the checklist that now covers it in `AGENTS.md` or `docs/RETRY_STORM_AUDIT.md`).
3. Add a bullet to this MOC under the most appropriate class heading.
4. If the incident reveals a new pattern not covered by an existing checklist, add a checklist section to `AGENTS.md` and reference the atom from it.
