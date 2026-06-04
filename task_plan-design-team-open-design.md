> ⛔ **SUPERSEDED 2026-06-04 — [ADR 012](docs/adr/012-lean-nexus-integration-cockpit.md) lean-Nexus pivot.** Team orchestration → Paperclip + an agent runtime.
> Demoted: see [task_plan-lean-nexus-pivot.md](task_plan-lean-nexus-pivot.md). Kept for history; do not resume without re-promotion.

# task_plan-design-team-open-design.md

> **Architectural overlay:** this is one instance of the [departments + ecosystems abstraction](task_plan-departments-and-ecosystems.md). The Design **department** roster below is ecosystem-agnostic; open-design.ai is just the default `design` adapter. Swapping to Vercel v0 / Lovable / Galileo / Figma AI is a one-config-row change. Read the departments plan first for the adapter contract.

Goal: A "Design Team" managed-agent roster, anchored on open-design.ai, that turns a brief into a coherent visual system — brand, layouts, components, landing pages, and ad creatives — with a built-in critic loop. Reusable across any business whose `niche` includes a creative surface (ad agency, ecommerce, info-product, SaaS).

Success criteria:
- Operator command: "design the brand and homepage for `<business>`" → the chain produces a full visual system + a deployable landing page draft within 30 minutes.
- All design assets flow through a `design-critic` review node before publish — no design ships without an explicit operator approval on the final asset.
- Brand tokens persist as memory-hq atoms so subsequent assets stay on-brand without re-explaining.
- Per-business design containers can run the open-design.ai instance in self-hosted mode (`OPEN_DESIGN_BASE_URL`) so the entire pipeline can amortise a single GPU.
- 100% provider-agnostic check.

Hard constraints:
- No new shared Doppler secrets if avoidable — fold per-business open-design API keys into the existing `apiKeySetup` pattern at [`lib/oauth/providers.ts`](lib/oauth/providers.ts).
- All publishing actions (push to Vercel, push to Figma, post to social) inherit the existing approval gates — `paid_saas_signup`, `first_n_posts`. No new gate enum unless an unmistakably new class of risk appears.
- Mobile-first layouts. Every generated page renders correctly at 375 px (the operator-on-phone constraint already on the [pre-commit checklist](AGENTS.md#pre-commit-checklist)).
- All multi-step design dispatches use `swarm: true` so sub-agents render in parallel (one per breakpoint, one per page section).

---

## Phase 1 — Explore

- Read open-design.ai's API docs (need a memory-hq atom recording exact endpoints, rate limits, output formats — currently absent).
- Check if `OPEN_DESIGN_API_KEY` env var slot exists in [`memory/platform/SECRETS.md`](memory/platform/SECRETS.md). Likely not — first PR adds it.
- Audit existing design-adjacent MCPs in [`lib/businesses/mcp-manifest.ts`](lib/businesses/mcp-manifest.ts) (`muapi-ai`, `firecrawl` for inspiration scraping).
- Look at [`.claude/skills/frontend-design/`](.claude/skills/frontend-design/) — that skill already covers production-grade frontend code; design team should COMPLEMENT it (brand + visual exploration), not replace.

## Phase 2 — Plan

### Roster — seven agents

| Slug | Role | Tool budget |
|---|---|---|
| `design-brand-strategist` | Brief → brand voice + 3 visual directions (mood-board atoms) | tavily, firecrawl, memory_atom |
| `design-system-builder` | Pick a direction → tokens (palette, type scale, spacing, radii) | open-design, claude/self |
| `design-layout-architect` | Tokens + sitemap → wireframes for each route | open-design, claude/self |
| `design-visual-renderer` | Wireframe → high-fidelity comps (light/dark, mobile/desktop) | open-design, muapi-ai |
| `design-code-translator` | Comp → Next.js + Tailwind components (handed to nexus-architect for QA) | claude/self, nexus-architect (chained) |
| `design-critic` | Compare comp vs brand tokens + accessibility checklist; flag mismatches | open-design, claude/self |
| `design-publisher` | Push to a draft Vercel deploy + a Figma project (when API key present) | composio (Vercel + Figma actions) |

`design-code-translator` overlaps with the existing `frontend-design` skill — by design (no pun). The agent INVOKES the skill rather than duplicates it, so the skill stays the single source of truth for Tailwind/Next conventions.

### Workflow

1. Operator: "design `<business>`."
2. `design-brand-strategist` proposes three directions in an `approval-request` block (gate: `design_brand_direction`).
3. Approved direction → `design-system-builder` writes tokens to a memory-hq entity `entity:brand-<business-slug>` so every later agent reads the same source-of-truth.
4. `design-layout-architect` → `design-visual-renderer` → `design-code-translator` run as a swarm (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`), one sub-agent per route.
5. `design-critic` reviews each output BEFORE the operator sees it — so the review modal carries comparisons, not raw drops. If critic fails the asset, the chain retries (max 2 retries before escalation).
6. Operator approves final assets in the Board review surface.
7. `design-publisher` pushes; deploy URL lands in `experiment_metrics` for traffic A/B.

### New artifacts

- `.claude/agents/design-team/{slug}.md` × 7
- `lib/oauth/providers.ts` — add `open-design` with `apiKeySetup` + `envVar: OPEN_DESIGN_API_KEY`.
- `lib/businesses/mcp-manifest.ts` — add `open-design` to the catalog; profile it in `creator`, `ad-agency`, `ecommerce`, `info-product`, `saas` niches.
- `memory/platform/SECRETS.md` — document `OPEN_DESIGN_API_KEY` + optional `OPEN_DESIGN_BASE_URL`.
- `docs/runbooks/design-team/setup.md`
- `memory/molecular/mocs/design-team.md` (mirrored to memory-hq)

### Brand-as-memory pattern

Each business owns ONE brand entity in memory-hq: `entities/55bedf46-nexus/brand-<slug>.md`. Frontmatter carries the canonical tokens (palette, type, voice rules); body holds the rationale. Every design agent reads this entity before producing output. Updates require an `approval-request` (gate: `content_creative_brief_change` — reusing the gate from the content-team plan).

This is the architectural difference vs ad-hoc design: the brand isn't a one-off output, it's persistent state every subsequent asset reads.

### Approval gates (added to `approval_gates` enum)

- `design_brand_direction` — picking 1 of 3 directions.
- `design_publish` — pushing the final visual to a customer-facing surface.

## Phase 3 — Implement

1. Add `open-design` to providers + manifest + secrets doc (PR 1).
2. Land seven `.claude/agents/design-team/*.md` specs (PR 2).
3. Land the brand-entity convention atom in memory-hq + the MOC (PR 3).
4. Runbook + a sample end-to-end test on a fixture business (PR 4).

## Open questions

- Does open-design.ai support webhooks for "render complete"? If yes → use them; if no → fall back to polling with `lib/hooks/usePollWithBackoff.ts` shape on the server side.
- Should `design-code-translator` emit a Vercel preview or a Coolify preview? Default to Vercel until Coolify-on-KVM4 gets a per-business preview slot.
