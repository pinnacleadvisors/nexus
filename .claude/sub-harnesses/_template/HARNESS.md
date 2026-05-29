---
slug: _template
goal: "TEMPLATE — never invoked. The shape a synthesize Loop writes."
status: draft
review_modality: code
skills: []
agent_refs: [loop-runner]
tools: [Bash, WebFetch]
trained_by: loop-runner
created_at: ""
---

# Sub-harness: _template

> **TEMPLATE — never invoked directly.** A `mode=synthesize` Loop (loop-runner,
> see `.claude/agents/loop-runner.md`) writes a real `.claude/sub-harnesses/<slug>/HARNESS.md`
> in this shape via `lib/harness/manifest.ts` `writeHarnessMd()`. The structured
> manifest is also persisted to the `sub_harnesses.manifest` jsonb column
> (migration 097) — that column is the runtime source of truth; this file is the
> human-readable + auditable artifact and the review surface for the
> draft→verified promote gate.

## Goal
One paragraph: the novel goal this harness was synthesized for. A verified
harness is replayable directly (`POST /api/sub-harnesses/<slug>/invoke`) — no
re-exploration.

## Execution Steps
The winning strategy's exact, ordered steps. Each step names the tool/skill/agent
it uses (kept to a minimal core set — Pi.dev 4-core-tool minimalism). Example:

1. `WebFetch <url>` → capture HTML.
2. Assert `<title>…</title>` is present + non-empty.
3. Return `{ ok, title }`.

## Tests (evidence)
Explorer-authored tests + their pass evidence from the nexus-sandbox. The
verifier requires these to pass BEFORE it reviews (TDD-evidence-before-review).

- [ ] **test-name** — assertion
  `command the explorer ran in the sandbox`

## Review
Reviewed under the **<modality>** (vision | audio | code | text) modality against:
- criterion 1
- criterion 2

## Error Remediation
Log of what failed during exploration + how it was fixed (Hermes-style — for
future debugging + so a re-synthesis doesn't repeat the same dead ends).

_(none)_

## Manifest (lossless)
Canonical bundle — mirrors `sub_harnesses.manifest`. `parseHarnessMd()` reads it.

```json manifest
{
  "skills": [],
  "agent_refs": ["loop-runner"],
  "tools": ["Bash", "WebFetch"],
  "tests": [],
  "review_spec": { "modality": "code", "criteria": [] }
}
```
