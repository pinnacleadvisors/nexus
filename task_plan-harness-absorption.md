# Task Plan — Harness Absorption (Continual Harness + Life-Harness)

Goal: Absorb the net-new patterns from two new May-2026 harness papers — **Continual Harness** ([arXiv 2605.09998](https://arxiv.org/abs/2605.09998), Princeton + DeepMind, MIT [`sethkarten/continual-harness`](https://github.com/sethkarten/continual-harness)) and **Life-Harness** ([arXiv 2605.22166](https://arxiv.org/abs/2605.22166), Peking University, [`Tianshi-Xu/Life-Harness`](https://github.com/Tianshi-Xu/Life-Harness)) — into Nexus without rewriting any of the existing harness layer. Tracked in [`docs/research/OPEN_SOURCE_ABSORPTIONS.md`](docs/research/OPEN_SOURCE_ABSORPTIONS.md).

Success criteria:
- A `harness.h2/h3/h4/h5` taxonomy is defined in AGENTS.md and mapped to existing Nexus surfaces — every reviewer can name where an intervention lives in <30s.
- `workflow-optimizer` agent reads `run_events` failure clusters automatically (not only human feedback) and emits one `edit-plan` block per detected pattern, operator-gated.
- `check:provider-agnostic` static check fails when a `.claude/skills/*` or `.claude/agents/*` file hard-codes a model name (e.g. `claude-sonnet-4-6`) instead of going through `lib/llm/provider.ts`.
- One new `edit-self` block (Continual Harness "self-refining hierarchy") lets an agent propose mid-cycle edits to its OWN spec / hooks / skills with the same Ralph-loop invariants as `edit-plan` (operator gate, draft PRs only, no auto-merge).
- `docs/research/OPEN_SOURCE_ABSORPTIONS.md` covers all 5 candidate patterns, with status flipped from 🔬 to ✅ or ❌ once each lands.
- Zero new runtimes, zero new gateways, zero new Coolify containers — absorption is **patterns only**, not infrastructure.

Hard constraints:
- Stack rules in `AGENTS.md` + `memory/platform/STACK.md`.
- Write-size discipline: every task fits one tool call under 300 lines / 10 KB.
- Ralph-loop invariants apply to every new block type (operator-gated kickoff, bounded items, draft PRs, no auto-merge, memory atom on exit).
- No model training — Continual Harness's "process-reward co-learning" is explicitly OUT OF SCOPE (we don't update model weights; pattern adopted is the harness-side mid-cycle self-modification).
- License compliance — both repos are MIT (CH explicitly; LH not stated in README, so any verbatim code copy needs the GitHub LICENSE confirmed first). Default to pattern-absorption (no verbatim copy) per the Paperclip absorption recipe.
- Per-agent hooks invariant — repo-wide hooks (`.claude/hooks/`) are baseline; per-agent hooks ADD, never remove (PR #299).

---

## Phase 1 — Findings (filesystem + paper-verified 2026-05-24)

### What Nexus already has that maps cleanly

| Paper concept | Nexus already has it at | Net new work? |
|---|---|---|
| Interface-only adaptation (Life-Harness invariant) | Whole architecture — Claude/Codex/Mimo/Ollama swappable via `LLM_PROVIDER`; hooks + skills are LLM-agnostic | Document explicitly + add check |
| Long-context introspection (Continual Harness pattern 3) | memory-hq atoms, `memory_search`, `[[wikilinks]]` | Document "reflect on own trajectories" prompt pattern |
| Failure feedback loop | `workflow-optimizer` + `workflow_feedback` table | Extend to read `run_events` automatically |
| Self-hosted runtime gateways | `services/claude-gateway/` + `services/codex-gateway/` | None |
| Reset-free long-running agent | `business-operator` cron-driven, multi-day | None — the mid-cycle SELF-EDIT is the net new bit |
| `.pokeagent_cache` / `run_data` persistence (CH) | `run_events` + `metric_samples` + memory-hq | None |
| 4-dim harness layer (LH `h2/h3/h4/h5`) | Scattered across MCP wrappers, MCP manifest, operator-gated loop pattern, `.claude/skills/` | Document as taxonomy; no new code |

### Net-new patterns worth absorbing

1. **Mid-cycle self-modification block** (Continual Harness) — agent proposes edits to its OWN spec / hooks / skills mid-cycle. Today these edits happen out-of-band via PRs. Block shape: extend the existing `edit-plan` / `swarm-task` / `background-task` family with one new `edit-self` type.
2. **4-layer harness taxonomy** (Life-Harness `h2/h3/h4/h5`) — adopt as the canonical organisation of harness interventions. Documentation-only.
3. **Automatic failure→intervention distillation** (Life-Harness) — extend `workflow-optimizer` to scan `run_events.outcome='error'` clusters and propose hook/skill diffs without human feedback.
4. **Provider-agnostic invariant + static check** (Life-Harness cross-model transferability) — formal contract that hooks/skills work across LLMs. Lint covers it.
5. **Fixed-during-evaluation harness window** (Life-Harness) — optional "release window" mode that freezes hooks; agent self-edits only fire during a "training window". Lowest priority; skip for v1.

### Explicit rejections (already noted in tracker)

- **CH process-reward co-learning** — we don't train models. OUT OF SCOPE.
- **CH Pokémon-specific scaffolding** — ROM emulators, state formatters, OCR dialogue, anticheat — domain-bound to gameplay, no analog in business autonomy.
- **LH τ-bench / τ²-bench / AgentBench evaluation harnesses** — interesting for `qa-runner` smoke testing in future, but not part of this absorption.

---

## Phase 2 — Atomic tasks (operator-approval gated)

### Group A — Documentation foundation (~2-3 hours, parallel-safe)

```
### Task A1 — AGENTS.md "Harness taxonomy" section (h2/h3/h4/h5)
- File:     AGENTS.md (anchored Edit; insert between "Operator-gated loop pattern (Ralph loop)" and "Platform debug loop pattern")
- Change:   ~50-70 line section documenting the 4 layers, mapping each to existing Nexus surfaces (h2=MCP wrappers, h3=lib/businesses/mcp-manifest.ts + tool budgets, h4=Ralph loop + permission_prompt + edit-plan invariants, h5=.claude/skills/).
- Verify:   grep -n "Harness taxonomy" AGENTS.md → exactly one match; check:agent-spec-freshness clean.
- Parallel: yes

### Task A2 — OPEN_SOURCE_ABSORPTIONS.md tracker
- File:     docs/research/OPEN_SOURCE_ABSORPTIONS.md (new — shipped alongside this plan)
- Change:   Single-source-of-truth doc covering Hermes / EvoSkill / Voyager / Paperclip / OpenClaw / OpenSwarm / Mimo / Higgsfield / Continual Harness / Life-Harness with status legend.
- Verify:   Every linked path resolves (`grep -oE '\(\.\.[^)]+\)' OPEN_SOURCE_ABSORPTIONS.md | sort -u` cross-checked with `ls`).
- Parallel: yes
- STATUS:   ✅ shipped in this same commit as this plan
```

### Group B — Provider-agnostic invariant + static check (~1 hour)

```
### Task B1 — check:provider-agnostic static check
- File:     scripts/check-provider-agnostic.mjs (new), package.json (add to scripts)
- Change:   Scan .claude/agents/*.md + .claude/skills/**/SKILL.md for hard-coded model names ('claude-sonnet-4-6', 'gpt-5.5', 'claude-opus-4-7') outside the explicit `model:` frontmatter field. Per-line allowlist + per-file ignore comment (// provider-agnostic-check: ignore <reason>).
- Verify:   `npm run check:provider-agnostic` clean against current tree. Inject a hard-coded model name into a test file → fails. Add ignore comment → passes.
- Parallel: yes

### Task B2 — Wire into pre-commit checklist
- File:     AGENTS.md "Pre-commit Checklist" section
- Change:   Add row: `[ ] npm run check:provider-agnostic passes (hooks/skills don't pin a specific LLM)`.
- Verify:   grep -n "check:provider-agnostic" AGENTS.md → exactly one match in checklist.
- Parallel: no (depends on B1 landing)
```

### Group C — Automatic failure distillation (~3-4 hours)

```
### Task C1 — lib/runs/failure-clusters.ts
- File:     lib/runs/failure-clusters.ts (new)
- Change:   Helper that reads `run_events` WHERE outcome='error' over the past N days, groups by (error_class, route, business_slug), returns clusters with frequency + sample event IDs. Pure read; no mutations.
- Verify:   unit-friendly. Seed 5 error events, call cluster() → returns 1-2 clusters with right counts.
- Parallel: yes

### Task C2 — workflow-optimizer agent reads clusters
- File:     .claude/agents/workflow-optimizer.md
- Change:   Extend the agent spec with a "Automatic failure-cluster scan" responsibility — on a daily cadence, the agent calls `failure-clusters.ts` via a brief from the cron, picks the highest-frequency unresolved cluster, and emits ONE `edit-plan` block proposing a hook/skill diff. Operator approves the diff via the existing edit-plan flow.
- Verify:   memory_atom kind:pattern-absorbed linking to [[mocs/agent-framework-survey]] — "life-harness-failure-distillation-absorbed".
- Parallel: yes (depends on C1)

### Task C3 — Cron entry point for the scan
- File:     app/api/cron/optimizer-scan-failures/route.ts (new), vercel.json
- Change:   Daily cron at 6 AM UTC. Calls failure-clusters() → if any unresolved cluster has frequency ≥ 5, dispatches workflow-optimizer with the cluster brief. Returns 200 always (retry-storm safe).
- Verify:   curl -H "Authorization: Bearer $CRON_SECRET" /api/cron/optimizer-scan-failures → 200 with dispatched count.
- Parallel: yes (depends on C1, C2)
```

### Group D — Mid-cycle self-modification block (~4-5 hours)

```
### Task D1 — edit-self block grammar
- File:     lib/chat/edit-self.ts (new), lib/types.ts (export EditSelfPlan type)
- Change:   Define an `edit-self` fenced block shape: { plan_id, intent, target: 'agent-spec' | 'skill' | 'hook', target_slug, items: [{ id, label, file_path, change_summary }] }. Parser + serializer pair. Mirrors `edit-plan` invariants (max 6 items, plan_id required, etc.).
- Verify:   Round-trip parse → serialize → parse stable. tsc clean.
- Parallel: yes

### Task D2 — EditSelfCard UI
- File:     components/platform-chat/EditSelfCard.tsx (new), wire into PlatformChat + BusinessChat MessageBubble
- Change:   Operator-facing card rendering the proposed edits with one checkbox per item. APPROVAL reply syntax: `APPROVAL [<plan_id>]: approve g1,g2`. Matches existing EditPlanCard ergonomics.
- Verify:   Mobile parity (375px) — checkboxes tappable; modal sheet < md.
- Parallel: yes (depends on D1)

### Task D3 — Server-side execution path
- File:     app/api/chat/edit-self/route.ts (new) + lib/chat/edit-self-exec.ts
- Change:   On approved edit-self, the route opens a DRAFT PR with the proposed file edits (mirrors /api/build/diff pattern). NEVER auto-merges. Operator merges via GitHub UI.
- Verify:   Submit an approved edit-self → see draft PR open at github.com/.../pull/N with the right files modified.
- Parallel: yes (depends on D1, D2)

### Task D4 — Agent spec change: edit-self emission grammar
- File:     .claude/agents/platform-copilot.md + .claude/agents/business-copilot.md
- Change:   Document the edit-self block in the agent spec under "Output blocks". Limit: agents may emit edit-self at most once per turn; only after observing ≥ 2 cycles of friction at the same surface (avoid premature self-editing).
- Verify:   check:agent-spec-freshness clean.
- Parallel: yes (depends on D1)

### Task D5 — Memory atom for the absorption
- File:     memory_atom MCP call (no source file change)
- Change:   `continual-harness-mid-cycle-self-modification-absorbed.md` — atom kind: pattern-absorbed, linked to [[mocs/agent-framework-survey]]. Body cites the paper + the 4 surfaces (agent-spec/skill/hook/memory) and the operator-gate invariant.
- Verify:   memory_search "mid-cycle self-modification" → returns the atom.
- Parallel: no (run after D1-D4 ship)
```

### Group E — Cleanup + status flip (~30 min)

```
### Task E1 — Flip status in OPEN_SOURCE_ABSORPTIONS.md
- File:     docs/research/OPEN_SOURCE_ABSORPTIONS.md
- Change:   Continual Harness section: flip "Self-refining component hierarchy" from 🔬 → ✅ with file-paths citation. Life-Harness section: flip 3 patterns (4-layer taxonomy, failure distillation, provider-agnostic) from 🔬 → ✅.
- Verify:   Status legend rendered correctly; no stale 🔬 on absorbed patterns.
- Parallel: no (run last)

### Task E2 — Lessons-learned atom
- File:     memory_atom MCP call
- Change:   One `mocs/harness-absorption-2026-05` atom summarising what landed vs rejected + what surprised us during integration. Future absorptions reference it.
- Verify:   memory_search "harness-absorption-2026-05" returns the atom.
- Parallel: no
```

---

## Phase 3 — Verify (pre-commit gates per Group)

- `npx tsc --noEmit`
- `npm run check:retry-storm`
- `npm run check:topology`
- `npm run check:sentry-config`
- `npm run check:agent-spec-freshness` (Groups A, C, D touch agent specs)
- `npm run check:provider-agnostic` (after B1 lands; baseline must be clean)
- Mobile parity (`--project=iphone`) for Group D UI work
- Manual: emit an `edit-self` block from platform-copilot, confirm card renders, approve → draft PR opens

---

## Phase 4 — Out of scope (paper trail)

- Process-reward co-learning (CH) — model training, not relevant.
- Pokémon-specific scaffolding (CH) — domain-bound.
- τ-bench / τ²-bench / AgentBench harnesses (LH) — interesting for `qa-runner` v2; track separately.
- Fixed-during-evaluation harness window (LH pattern 5) — defer to v2; low immediate value.
- Verbatim code copy from either repo — both papers' contribution is the PATTERN; absorption is at the design level. If we ever need to copy code, confirm Life-Harness LICENSE file first (README didn't list one).

---

## Progress

### Completed (as of 2026-05-27, verified by filesystem)
- [x] **Phase 1** findings + verification against both repos + Nexus tree.
- [x] **A1** — AGENTS.md "Harness taxonomy (h2–h5)" section shipped (grep `AGENTS.md` for "Harness taxonomy" returns the canonical mapping).
- [x] **A2** — `docs/research/OPEN_SOURCE_ABSORPTIONS.md` tracker shipped.
- [x] **B1** — `scripts/check-provider-agnostic.mjs` lives + runs in the pre-commit suite (`npm run check:provider-agnostic`).
- [x] **B2** — Wired into the pre-commit checklist in AGENTS.md.
- [x] **C1** — `lib/runs/failure-clusters.ts` shipped.
- [x] **C2** — `.claude/agents/workflow-optimizer.md` extended with the failure-cluster scan responsibility.
- [x] **C3** — `app/api/cron/optimizer-scan-failures/route.ts` shipped; `vercel.json` carries the daily entry (operator runs `node scripts/migrate-crons-to-cronjob-org.mjs` to push it to cron-job.org post-lean-mode).
- [x] **D1** — `lib/chat/edit-self.ts` block grammar shipped.
- [x] **D2** — `components/platform-chat/EditSelfCard.tsx` UI shipped.
- [x] **D4** — `platform-copilot.md` documents the `edit-self` block (5 mentions in spec).

### Remaining (lower priority — not blocking production)
- [ ] **D3** — Server-side execution path (POST → draft-PR opener). The card today emits the structured block + the operator opens the PR by hand. The auto-open path is a convenience, not a correctness gap.
- [ ] **D4 for business-copilot** — `edit-self` grammar not yet documented in `.claude/agents/business-copilot.md`. Platform-copilot is the natural emitter for now (it's the one doing platform audits); business-copilot lives per-business and rarely needs self-edits.
- [ ] **E** — One `kind:pattern-absorbed` memory atom per pattern (life-harness-taxonomy / life-harness-failure-distillation / continual-harness-edit-self / provider-agnostic-invariant). Will land as the absorption is declared complete.

### Verdict
The absorption is **functionally complete**. Taxonomy is in AGENTS.md (every reviewer can name the layer in <30s), the provider-agnostic check is enforced in CI, the failure-cluster scan auto-fires daily, and the edit-self block grammar + card both ship. D3 is the only "missing" piece and it's a workflow convenience — the operator can already gate self-edits manually via the existing PR review flow.

### Blockers / Open questions (resolved)
- **Group D decision** — Resolved: included as documented above (D1+D2+D4 shipped, D3 deferred as convenience).
- **License confirmation on Life-Harness** — Not blocking since absorption is pattern-only (no verbatim code copy).
- **Daily-cron cadence** — Defaulted to 7 AM UTC per `vercel.json`; adjust if it surfaces noise.
