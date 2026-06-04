# 012 — Lean Nexus: integration cockpit over best-of-breed OSS

- **Date:** 2026-06-04
- **Status:** Accepted

## Context

Nexus has been rebuilding, from scratch, capabilities that mature high-activity OSS projects now offer and maintain:
- **Org-chart / workforce orchestration** → [Paperclip](https://github.com/paperclipai/paperclip) (~67K⭐; agent-agnostic "company OS" with roles, budgets, governance, heartbeats; any agent that receives a heartbeat plugs in: Claude/Codex/OpenClaw/HTTP).
- **Agent runtime** → [Hermes Agent](https://github.com/nousresearch/hermes-agent) (model-agnostic, self-improving skills, multi-channel) · [opencode](https://github.com/sst/opencode) (client/server, `opencode serve`, 75+ providers).
- **Agent chat UI** → [claudecodeui](https://github.com/siteboon/claudecodeui) / opencode web (continuously updated; Claude Code ships new features weekly).
- **Memory** → [memory-os](https://github.com/ClaudioDrews/memory-os) (7-layer; Hermes-specific).

Absorbing each is slow and test-heavy ([`docs/research/OPEN_SOURCE_ABSORPTIONS.md`](../research/OPEN_SOURCE_ABSORPTIONS.md)), whereas these projects have userbases stress-testing them and teams shipping features. The operator now has a capable always-on Mac mini host (ADR 011). **Operator decision: pivot Nexus to a lean integration layer — use OSS (OSS-first), absorb/personalise or fork/plugin ONLY where OSS genuinely lacks the need. Build only the gap.**

## Decision

**1. Substrate = single sources of truth, exposed over MCP so every agent shares them** (the collaboration backbone — like Doppler is for secrets):
| Concern | Source of truth | MCP surface (exists) |
|---|---|---|
| Secrets | Doppler | (per-service token) |
| Memory | `memory-hq` | [`services/mcp-memory`](../../services/mcp-memory) (`memory_atom/search/walk`) |
| Connectors | Composio | [`services/mcp-composio-admin`](../../services/mcp-composio-admin) + Composio's hosted MCP |
Any agent (Claude Code, Hermes, opencode, Paperclip workers) points at these → they collaborate over shared memory + connectors. **Double down here.**

**2. Orchestration → Paperclip.** Demote Nexus's `paperclip-absorption`, `departments-and-ecosystems`, and the `content/design/dev-team` plans — they reinvent Paperclip's org-chart/governance. Fork or write a Paperclip plugin only for Nexus-specific needs.

**3. Agent runtimes → Claude Code / opencode / Hermes** (model-agnostic), consuming the MCP substrate + plugging into Paperclip via heartbeat.

**4. Chat → prefer embedding a Claude Code / opencode web UI** over the bespoke Nexus chat. (Caveat: the Nexus chat carries governance affordances — approval gates, typed iteration/edit/signals blocks, business-scoping — that a generic UI lacks. Net decision on how much bespoke chat to retain vs. move governance into Paperclip is tracked in `task_plan-lean-nexus-pivot.md`.)

**5. Memory → KEEP `memory-hq`** (model/framework-agnostic, cross-project provenance — memory-os is Hermes-coupled and single-maintainer, wrong to depend on). **Absorb memory-os's *features*** memory-hq lacks: trust-scored facts, semantic dedup (cosine>0.92 merge), weekly decay/archival, 4-level retrieval fallback cascade.

**6. Nexus keeps building only its genuine differentiators:** the cross-tool **integration dashboard/cockpit**, per-business Composio connector scoping + governance, `cost-guard`/kill-switch, lean-mode + business provisioning, the **mobile operator UX**, and the **MCP substrate servers** themselves.

## Consequences

- **Easier:** dramatically leaner codebase + less maintenance; ride upstream roadmaps + userbase testing; operator's hands-on use of Paperclip/Hermes steers Nexus's "build the gap" decisions.
- **Harder / watch:** integration seams + multi-tool ops + dependency on upstream breaking-changes; 16 GB RAM contention if running Nexus + the OSS stack at once; the chat-governance affordances must be re-homed, not lost.
- **Reversible:** demoted plans are bannered, not deleted — history + rationale preserved. Re-promote if an OSS dependency proves inadequate.
- **Revisit:** after the `workforce-lab` (ADR-pending) experiment soak, re-score each demoted plan: confirmed-superseded vs. needs-a-fork vs. re-promote.
