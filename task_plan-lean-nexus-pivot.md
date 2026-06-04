# Task Plan — Lean Nexus Pivot (integration cockpit over OSS)

> Initialised 2026-06-04. Decision record: [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md).
> Companion experiment: `task_plan-workforce-lab.md` (OSS stack on the Mac mini).

## Step 0 — North Star

```
Goal:    Make Nexus as LEAN as possible — a dashboard + integration cockpit that sits
         on top of best-of-breed OSS agent tools, owning only the substrate (memory,
         connectors), the governance, and the operator UX. Build the gap, not the world.

Principle (the timeline):
   use OSS (OSS-first, prefer high-star/active)
     → absorb + personalise, OR fork + write a plugin
        ONLY when the OSS genuinely does not offer what we need.

Success criteria:
  - Demoted plans clearly marked + rationale recorded; nothing silently abandoned.
  - The MCP substrate (memory-hq + Composio, already skeletoned) is THE shared surface
    every agent (Claude Code, Hermes, opencode, Paperclip workers) consumes.
  - A documented keep/demote/integrate decision for every overlapping capability.
  - memory-hq enhanced with the memory-os features it lacks (no framework coupling).

Hard constraints:
  - Keep memory-hq as the memory source of truth (do NOT adopt memory-os wholesale).
  - Keep the Nexus dashboard as the visual integration point.
  - Demote = banner + register, never delete (reversible).
```

## The KEEP / DEMOTE / INTEGRATE matrix

### ✅ KEEP building (Nexus's genuine differentiators — OSS doesn't give these)
- **Integration dashboard / cockpit** — cross-tool stats, the single pane of glass.
- **MCP substrate servers** — [`services/mcp-memory`](services/mcp-memory) + [`services/mcp-composio-admin`](services/mcp-composio-admin). The collaboration backbone. Double down.
- **Per-business Composio connector scoping + governance UI** (`connected_accounts`, `executeBusinessAction`).
- **cost-guard / kill-switch**, **lean-mode**, **business provisioning**, **mobile operator UX**.
- **memory-hq** (+ memory-os feature absorption — see INTEGRATE).

### ⛔ DEMOTE (superseded by OSS — banner + stop building)
| Plan | Superseded by | Action |
|---|---|---|
| `task_plan-paperclip-absorption.md` | Paperclip (run it) | banner ⛔ |
| `task_plan-departments-and-ecosystems.md` | Paperclip org-chart/governance | banner ⛔ |
| `task_plan-content-team-higgsfield.md` | Paperclip + agent runtime + Composio | banner ⛔ |
| `task_plan-design-team-open-design.md` | Paperclip + agent runtime | banner ⛔ |
| `task_plan-dev-team-open-code.md` | opencode / Claude Code directly | banner ⛔ |
| `task_plan-paperclip-ui-phase-2.md` | Paperclip UI | banner ⛔ (keep only Nexus-unique bits) |

### ⛔ DEMOTE — chat stack (operator decision 2026-06-04: **embed + replace fully**)
Rip out the bespoke chat *engine*; embed claudecodeui/opencode-web as the chat surface.
The governance affordances (approval gates, typed iteration/edit/signals blocks, business-scoping)
must be **re-homed** — into Paperclip's governance, or a thin wrapper around the embedded UI —
BEFORE cutover (they are not lost, they move). Banner these:
| Plan | Superseded by |
|---|---|
| `task_plan-chat.md` | embedded Claude Code/opencode web chat |
| `task_plan-collaborative-chat.md` | Paperclip multi-agent + embedded chat |
| `task_plan-chat-views.md` | claudecodeui views |
| `task_plan-sse-streaming.md` | the embedded UI's own streaming |
| `task_plan-model-agnostic-chat.md` | opencode (75+ providers, model-agnostic by design) |

### 🔬 DECIDE (memory — keep lean)
| Plan | Tension | Recommendation |
|---|---|---|
| `task_plan-hmem-architecture.md`, `-gbrain-integration.md` | More memory engines vs. memory-hq + memory-os features | Keep memory-hq; fold the good ideas in; don't build new engines. |

### 🔗 INTEGRATE (wire OSS in; minimal glue)
- **Paperclip** = orchestration (separate `workforce-lab` first; then point its dashboard view into Nexus).
- **Claude Code / opencode web UI** = the chat surface (replaces bespoke chat engine).
- **memory-os features** → port into memory-hq: trust-scored facts, semantic dedup (cosine>0.92), weekly decay/archival, 4-level retrieval cascade. (Add to `task_plan-memory-architecture.md`.)
- **Composio hosted MCP** = the connector source every external agent points at.

## Answers to the operator's architecture questions (as decisions)

1. **Embed Claude Code chat in Nexus to replace bespoke chat?** DECIDED 2026-06-04: **embed + replace fully** with claudecodeui (mobile+web; drives Claude Code + opencode/Codex/Cursor). Bespoke chat engine demoted; governance affordances re-homed (Paperclip / thin wrapper) before cutover.
2. **opencode for model-agnostic, or just VSCode?** opencode = model-agnostic chat engine with an embeddable server API (`opencode serve`, 75+ providers). **VSCode + Claude Code** is for *your own coding*; the *platform's* operator chat should be an embedded web UI (opencode-web or claudecodeui w/ opencode backend). Use both for their right contexts.
3. **Nexus dashboard = just stats/memory?** No — make it the **integration cockpit**: stats across tools + memory mgmt + connector mgmt + embedded agent chat + a window into Paperclip's org chart. The dashboard is the durable Nexus surface.
4. **Can Claude Code / Hermes access Nexus's MCP connectors (single source)?** YES — already skeletoned. Memory via `mcp-memory`; connectors via `mcp-composio-admin` + Composio hosted MCP. Make these the canonical endpoints every agent registers. This IS the lean collaboration substrate (Doppler/memory-hq pattern, extended to connectors).

## Sequencing
1. [x] ADR 012 + this plan + start demotion banners (2026-06-04).
2. [ ] Update `docs/research/OPEN_SOURCE_ABSORPTIONS.md` (correct Hermes/OpenClaw; add memory-os, opencode, claudecodeui; add RUN/ABSORB/FORK column).
3. [ ] **Operator decisions:** (a) chat — embed vs. retain how much? (b) approve `workforce-lab` build?
4. [ ] `workforce-lab` repo (Paperclip + Hermes + memory-os + Discord + Claude on the Mac — `task_plan-workforce-lab.md`, plan written; build on go-ahead).
5. [ ] Port memory-os features into memory-hq.
6. [ ] Harden the MCP substrate as the documented shared endpoint set for all agents.
7. [ ] **Chat replacement** (operator: embed + replace fully): (a) embed claudecodeui/opencode-web as the chat surface; (b) re-home governance — approval gates, typed blocks, business-scoping — into Paperclip or a thin wrapper; (c) cut over; (d) banner-demote the 5 chat plans (done).

## Progress (2026-06-04)
### Completed
- [x] ADR 012; this master plan; demotion banners on the 6 clear-cut plans.
### Remaining / Open questions
- [ ] Chat-stack demotion depth (governance re-homing) — operator decision.
- [ ] workforce-lab build go-ahead.
- [ ] Re-score demoted plans after the workforce-lab soak.
