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
### Completed
- Ground-truthed adapter inventory: 21 ecosystem adapters + 6 lib/adapters present.
- Confirmed `brew install openhuman` is a dead end (no such formula in the tap; non-admin user can't write to operator's Homebrew). Reported, awaiting correct source.

### Remaining
- [ ] Exploration workflow → ground-truth gap report per area
- [ ] Prioritized implementation plan (post-exploration)
