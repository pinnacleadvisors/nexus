# Task Plan — workforce-lab (OSS autonomous-workforce stack on the Mac mini)

> Initialised 2026-06-04. **Plan only — build held for operator go-ahead.**
> Sibling strategy: [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md) · [`task_plan-lean-nexus-pivot.md`](task_plan-lean-nexus-pivot.md).
> Lives in a SEPARATE repo (`workforce-lab`) — keeps Nexus clean.

## Step 0 — North Star

```
Goal:    Stand up a working autonomous workforce FAST by composing mature OSS
         (Paperclip orchestration + an agent runtime + shared memory + Discord +
         Claude) with MINIMAL glue, on the Mac mini under OrbStack. Run it in
         PARALLEL with Nexus — and let hands-on use steer what Nexus builds.

Success criteria:
  - `docker compose up` brings the stack live on the Mac (mirrors services/local-os pattern).
  - Paperclip org-chart drives ≥1 agent worker that produces real output.
  - Discord receives alerts; operator can steer from a phone.
  - Glue we wrote = a compose file + env + a Discord webhook. No bespoke app code.
  - Documented learnings feed back into Nexus's KEEP/DEMOTE decisions.

Hard constraints:
  - Separate repo; do NOT entangle with the Nexus codebase.
  - One secret pattern: DOPPLER_TOKEN only (reuse the local-os convention).
  - Respect 16 GB RAM — Nexus local-os already uses ~6–8 GB (see Risks).
  - Timeboxed experiment with an explicit decision gate (below).
```

## The stack (compose under OrbStack)

| Service | Project | Role |
|---|---|---|
| `paperclip` | [paperclipai/paperclip](https://github.com/paperclipai/paperclip) | Orchestration: org chart, roles, budgets, governance, heartbeats. `npx paperclipai onboard`; embedded Postgres; :3100. |
| `hermes` | [nousresearch/hermes-agent](https://github.com/nousresearch/hermes-agent) | Worker runtime: model-agnostic, self-improving skills, Discord-native. Plugs into Paperclip via heartbeat. |
| `memory-os` *(phase 2)* | [ClaudioDrews/memory-os](https://github.com/ClaudioDrews/memory-os) | Hermes's 7-layer memory (Qdrant+Redis). **Defer** until basics work (RAM). |
| Discord | webhook | Alerts + control channel (Hermes native). |
| Claude | Max subscription | The brain (point Hermes/opencode at it). |

**Glue = Paperclip's heartbeat model + the MCP substrate.** Point Hermes at Nexus's shared
MCP endpoints (`mcp-memory`, `mcp-composio-admin` / Composio hosted MCP) so the lab and Nexus
**share memory + connectors** — the same single-source-of-truth substrate (ADR 012). That's the
collaboration bridge between the two stacks.

## Risks / constraints
- **RAM (16 GB).** Nexus local-os ≈ 6–8 GB; Paperclip+Hermes ≈ 1–2 GB; +memory-os(Qdrant+Redis) ≈ 3–4 GB.
  Running everything at once is tight. Mitigations: start without memory-os; timeshare with Nexus
  services; or treat the lab as the priority and pause non-critical Nexus containers during experiments.
- **memory-os** single-maintainer/young — fine for a lab, don't depend on it for anything durable.
- **Upstream churn** — pin versions; OrbStack snapshots before upgrades.

## Sequencing (when approved)
1. [ ] Create `workforce-lab` repo + `docker-compose.yaml` (mirror `services/local-os`: DOPPLER_TOKEN-only, LaunchAgent autostart optional).
2. [ ] Paperclip up (`npx paperclipai onboard`), reachable on the Mac.
3. [ ] One Hermes worker, pointed at Claude + the Nexus MCP substrate, registered to Paperclip via heartbeat.
4. [ ] Discord webhook for alerts.
5. [ ] Give it ONE real task; observe end-to-end.
6. [ ] (phase 2) Add memory-os if memory depth is the bottleneck.

## Decision gate (timebox ~3–4 weeks)
After the soak: **is the lab producing real autonomous work with less effort than Nexus?**
- **Yes** → lean in; fold the best patterns back into Nexus's "build the gap" list; demote more Nexus plans.
- **No** → fold the learnings into Nexus; park the lab.

## Progress (2026-06-04)
### Completed
- [x] Plan scoped; stack + glue + risks + decision gate defined.
### Remaining
- [ ] Operator go-ahead to build (then execute Sequencing).
