# 014 — Two-plane adapter model (runtime `lib/adapters` vs capability `lib/ecosystems`)

- **Date:** 2026-06-05
- **Status:** Accepted

## Context

The Third-Party Tool Matrix audit ([`docs/research/THIRD_PARTY_TOOL_MATRIX.md`](../research/THIRD_PARTY_TOOL_MATRIX.md))
found that Nexus has **two distinct adapter registries** that are easy to confuse, and that the
absence of a documented relationship between them was itself a gap (matrix "Synergy A"):

1. **Runtime plane — [`lib/adapters/`](../../lib/adapters/registry.ts)** (the Paperclip absorption).
   `Adapter` = a way to RUN an agent: `invoke(ctx) → RunHandle`, `status(handle)`, `cancel(handle)`.
   Keyed by `AdapterType` (`claude_gateway`, `codex_gateway`, `n8n`, `inngest`, `coolify_business`).
   Answers *"which engine executes this agent's loop, and how do I poll/cancel it?"*. Abstraction-only
   today — dispatch routes still call services directly (per `task_plan-paperclip-absorption.md` Phase 4e).

2. **Capability plane — [`lib/ecosystems/`](../../lib/ecosystems/registry.ts)**.
   `EcosystemAdapter` = a way to DO a capability: `invoke(verb, payload) → EcosystemResult`. Keyed by
   `EcosystemKind:name` (`video:kling`, `voice:elevenlabs`, `memory:memory-hq`, `workflow:n8n`, …).
   Answers *"which provider renders this clip / synthesizes this voice / stores this memory?"*. **Active
   in production** — `/api/ecosystems/invoke`, the `/teams` picker, and department role verbs route
   through `getEcosystem(kind, name)`.

These are NOT competitors and NOT redundant: one selects the *executor*, the other selects the
*tool a step uses*. A single agent run on the `claude_gateway` runtime plane can call many capability
adapters (search → render → memory-write). Conflating them — e.g. adding a `video` provider to
`lib/adapters`, or an agent-runtime to `lib/ecosystems` — would break both abstractions.

Note the deliberate overlap at `workflow:n8n`: n8n appears in BOTH planes. In `lib/adapters` it's a
*runtime* (a whole workflow IS the agent loop); in `lib/ecosystems` it's a *capability* (`run_workflow`
as one step inside another agent's loop). Same upstream, two roles — intentional, not duplication.

## Decision

Keep the two planes **separate**, and make the boundary explicit (this ADR + cross-links in both
registries' header comments). Rules:

- A new **agent-execution engine** (a way to run/poll/cancel an agent) → `lib/adapters/` (`Adapter`).
- A new **tool/provider for a capability** (verb + payload) → `lib/ecosystems/adapters/` (`EcosystemAdapter`),
  registered in `ALL_ADAPTERS`, covered by `check:ecosystem-bindings`.
- When a tool legitimately plays both roles (n8n), it gets one file per plane with a header note.

**Deferred (separate PR):** an explicit *bridge* letting a `lib/adapters` runtime resolve capability
adapters from `lib/ecosystems` (so a Paperclip-orchestrated worker reaches `getEcosystem` without a
third abstraction), plus registering `open-code` / `hermes_local` as runtime adapters. That work is
architectural and higher-risk; this ADR fixes the boundary first so the bridge has a documented home.

## Consequences

- **Easier:** contributors know which registry a new integration belongs in; the matrix's "two unbridged
  registries" gap now has a written answer; `check:ecosystem-bindings` guarantees the capability plane
  has no dead bindings.
- **Harder / to revisit:** until the bridge lands, a Paperclip runtime still can't auto-resolve a
  capability adapter — callers wire capabilities explicitly. Revisit when the workforce-lab soak proves
  the Paperclip orchestration path needs the bridge.
- Operator visibility: [`GET /api/ecosystems/health`](../../app/api/ecosystems/health/route.ts) reports the
  capability plane's per-kind coverage; the runtime plane's liveness is covered by `/api/health/deep`.
