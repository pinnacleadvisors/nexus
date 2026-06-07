Goal: Close the implementable gaps in docs/research/THIRD_PARTY_TOOL_MATRIX.md so every documented tool is actually routable through the platform's registries, with verification.
Success criteria:
- `maxTokens` is enforced in the claude-llm ecosystem adapter (declared field actually passed to generateText).
- The two stubbed LLM providers (Mimo, Ollama) no longer throw-on-construct — at minimum they build a model when their env is set and return a typed unavailable signal otherwise (no hard crash).
- `lib/adapters/registry.ts` can route to `open-code` (and the bridge to `lib/ecosystems` capability adapters is at least scaffolded), closing the §1 "orchestrator cannot route" gap.
- The `code` ecosystem has an explicit `claude-code` adapter (honesty gap) so a binding reflects what actually runs.
- The 4 prose-only `design` providers (v0/Lovable/Galileo/Figma) are either real env-gated stubs registered in the registry OR the design-lead prose is softened to "planned" — no naming-vs-wiring mismatch.
- The §9 follow-ups that are codeable now (D-ID avatar fallback, Flux image, PDF/OCR doc-parse) land as env-gated adapters, or are explicitly deferred with a one-line reason.
- The Inngest adapter's "NOT YET WIRED" gap is closed (run-status lookup + cooperative cancel) or scoped down.
- Doc drift fixed: NIM marked ✅ live in OPEN_SOURCE_ABSORPTIONS.md; matrix rows flipped as adapters land.
- `npx tsc --noEmit` + `npm run check:provider-agnostic` + `npm run check:ecosystem-bindings` pass; UI binding picker verified at 1280px + 375px via Playwright where adapters surface in `/teams`.
Hard constraints:
- Never crash the platform if an optional ecosystem/provider isn't wired — `available()` must return false / typed `unavailable`, never throw at module load.
- Honor write-size discipline (≤300 lines / 10KB per Write/Edit). New adapters = fork the closest existing verb-router.
- Provider names must NOT appear in agent-spec prose (check:provider-agnostic). Frontmatter `model:` is allowed.
- This work goes on a FRESH branch off origin/main — not the current p0-closeout branch.
- Env-gated adapters that need an upstream key I can't verify: scaffold + register + `available()` gate, mark the upstream-contract risk in a comment; do NOT fake a working integration.

## Progress (as of 2026-06-07)
### Completed (branch feat/tool-matrix-gap-closeout)
- 7-agent recon workflow ground-truthed every documented gap vs actual code. Key corrections:
  `maxTokens` already enforced (stale doc); two-plane registry separation is by-design (ADR 014/007), not a bug.
- **Tier 1** (commit a91e6f6): Mimo + Ollama LLM providers wired via `createOpenAI` (no new dep);
  new `code:claude-code` + `code:code-codex` adapters close the §4 honesty gap; `DEFAULT_BINDINGS.code`
  → `claude-code`; NIM doc drift fixed.
- **Tier 2** (commit a187442): `did.ts` (avatar fallback) + `flux.ts` (Replicate image) best-effort routers;
  firecrawl `parse_pdf` verb; design v0/Lovable/Galileo/Figma prose softened to "planned" (deprioritized dept).
- **Inngest** (commit ae57a3f): runtime `status()` via Cloud REST event-runs lookup (gated, graceful degrade);
  `cancel()` cooperative (no per-run REST cancel exists — honest, not faked); SECRETS.md annotated.
- **UI + spec + §1 reframe** (commit a59b3c6): `data-testid` on BindingChip; Playwright binding-picker spec;
  matrix §1/Synergy reframed per ADR 014.
- Drive-by: `topology-check: ignore` on a pre-existing main breakage (p0-security-remediation.md KVM2 row).
- Verification: `npx tsc --noEmit` 0; `npm run check:all` exit 0 (lint 0-errors, all 13 guards pass);
  registry = 25 adapters / 15 kinds; dev server serves `/teams` 200 with all new adapters.

### Deferred by design (documented, not forced)
- Runtime↔capability bridge (ADR 014 defers it); `hermes_local` runtime (needs external spec);
  runtime-plane dispatch-route migration (Phase 4e, ADR 007); true OCR/file-upload doc-parse (Docling);
  Vapi voice-agent adapter; dynamic registry file-discovery (M follow-up).
- `openhuman` brew install: no such formula in `tinyhumansai/core` tap; awaiting correct source from operator.

### Remaining
- [ ] Confirm Playwright spec skips cleanly once browser binary present (env detail, not spec correctness)
- [ ] Open PR; restore the parked p0-closeout startup.sh stash to its own branch
