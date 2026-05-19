# ADR 006 — Lean-mode pivot via feature flag, not branch fork

**Status:** Accepted
**Date:** 2026-05-19
**Owner:** dylannguyen

## Context

Nexus has been built as a multi-tenant production-ready platform: per-business Coolify containers (KVM4), separate codex-gateway (KVM2), Vercel hosting, Stripe per-business attribution, RLS partitioned by `business_slug`, tiered cost-guard. The architecture is appropriate for paying customers — but there are zero paying customers today.

The owner is the only user. Operating expense for the production-shape stack (Vercel Pro + dual KVM + Cloudflare add-ons) is ~$30-60/mo in pure infra above the LLM-subscription cost-base. More damaging is the **velocity cost** — every new feature has to thread through multi-tenant scaffolding (Stripe metadata, business_slug partitioning, per-business gateway resolution) that adds nothing while there's one tenant.

The owner wants to redirect that velocity into building the **autonomous-workforce primitives** (Voyager-style skill ingestion, EvoSkill-style sandboxed practice loop, Hermes-style versioned skill bank, "open-orchestration" registry of best-of-breed OSS frameworks). Until those primitives prove revenue-positive, multi-tenant scaffolding is dead weight.

## Decision

**Preserve the multi-tenant architecture via a `LEAN_MODE` feature flag, not a branch fork.**

- Git-tag `v1.0-multi-tenant` on the current `main` (snapshot).
- Add a central guard module `lib/lean-mode.ts` exposing `isLeanMode()`.
- Every multi-tenant boundary point short-circuits in lean mode:
  - Per-business container provisioning: returns soft error
  - Idle scale-down cron: no-op
  - Cost-guard: collapses to single global daily cap
  - Composio resolution: skips per-business lookup, goes straight to user-default
  - Stripe attribution: no business_slug metadata when payment_intent.create sites are added
- The scale-mode code stays in tree, dormant. Flipping `LEAN_MODE=0` restores production behaviour without a merge.
- New autonomous-workforce primitives (`skill-trainer` agent, rootless-Podman sandbox, open-orchestration MOC, LLM provider abstraction) are added under lean mode but work identically in scale mode.

## Alternatives considered

### 1. Branch fork (`lean-dev` off `main`)
**Rejected.** Three months of rapid development against a separate branch produces compounding merge debt. When scale-mode returns, the rebase is a multi-day project with edge cases in every multi-tenant code path. Feature flags = one truth.

### 2. Delete the multi-tenant code
**Rejected.** Re-writing it later is a strict regression on time-invested. The whole point of preserving the snapshot is that we already know that code is correct; throwing it away pre-customer is irrational.

### 3. Keep production architecture, just turn off the cron and ignore the cost
**Rejected.** $30-60/mo isn't the issue — velocity is. Every new route, every Stripe call, every Composio query is currently 2-3 lines longer than it needs to be because of multi-tenant resolution. Compounds across hundreds of edits in the autonomous-workforce phase.

### 4. Build the autonomous-workforce primitives as a separate platform
**Rejected.** Duplication of auth, memory-hq, Composio, board, dashboard, observability. The skills, the sandbox, and the open-orchestration MOC all belong in Nexus.

## Consequences

### Positive
- One Coolify-on-KVM topology hosts the whole stack (`nexus-app`, `claude-gateway`, `codex-gateway`, `nexus-sandbox`).
- Vercel project + second KVM decommissionable after parallel-run validation.
- Velocity unblocked on Phase 3 (sandboxed practice loop) — the genuinely new build.
- LLM provider abstraction unlocks one-env-var swap to Mimo Pro 2.5 (planned when Claude Max subscription ends).
- Open-orchestration MOC in memory-hq absorbs OSS framework patterns continuously, no new DB needed.

### Negative
- Every new feature must respect the lean-mode/scale-mode boundary. Easy to forget when paths are obvious; less easy when subtle (e.g. a new cron that should be no-op in lean mode). Mitigation: skill-router hint + the boundary list in `docs/runbooks/lean-mode.md`.
- The privileged rootless-Podman sandbox is a real attack surface — acceptable in lean mode (one trusted tenant = the owner) but **must** be swapped for gVisor / Firecracker before customer code lands. Tracked as a hard precondition for flipping `LEAN_MODE=0` back on.
- Mimo / Ollama adapters are stubs — they throw until activation. Acceptable: their purpose is to lower the swap cost when subscription economics change.

### Neutral
- Supabase stays the database — no self-host migration. Saves time; gives back when scale-mode returns (RLS + free tier already match production needs).
- Clerk + Composio + Stripe + memory-hq stay external on free tiers. Replacing them is a tax with no upside while solo.

## Reversibility

**Fully reversible.** To restore scale mode:

1. Unset `LEAN_MODE` (or set to `0`) in Doppler.
2. Confirm per-business secrets (`business:<slug>` gateway URLs + bearer tokens) are populated for the businesses you want active.
3. Redeploy.

The git tag `v1.0-multi-tenant` is the safety net for any regressions introduced during the lean-mode phase.

## Related

- [`task_plan-lean-mode.md`](../../task_plan-lean-mode.md) — full pivot plan
- [`docs/runbooks/lean-mode.md`](../runbooks/lean-mode.md) — operator runbook
- [`services/lean-deploy/`](../../services/lean-deploy/) — Coolify stack
- [`services/nexus-sandbox/`](../../services/nexus-sandbox/) — the rootless-Podman sandbox
- [`lib/lean-mode.ts`](../../lib/lean-mode.ts) — guard module
- ADR 002 — Codex CLI gateway as sandboxed manual-ops runtime (lean mode keeps the codex-gateway, just moves it onto the single KVM)
