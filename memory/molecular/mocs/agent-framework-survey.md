---
type: moc
title: "agent-framework-survey"
id: agent-framework-survey
created: 2026-05-19
updated: 2026-05-27
---

# agent-framework-survey

Open-orchestration survey of OSS agent frameworks. Nexus continuously evaluates Voyager, Hermes, OpenClaw, EvoSkill, OpenSwarm, Mimo, Higgsfield — absorbs best patterns, rejects anti-patterns, combines them into one autonomous-workforce architecture. Workflow: POST /api/agents/survey-oss-framework with repo_url + framework_name.

## Frameworks under continuous review

- [[entities/voyager]] — iterative curriculum + skill library + self-verification (Minecraft origins, generalised)
- [[entities/hermes]] — light index recall, frontmatter routing, system-wide rollback
- [[entities/openclaw]] — Anthropic CUA-style browser automation (legacy fallback at Nexus)
- [[entities/evoskill]] — Proposer/Evaluator loop with git-branched skill versioning
- [[entities/openswarm]] — multi-agent coordination via shared context window
- [[entities/mimo]] — cheap top-performer LLM family, Vercel-AI-SDK-compatible
- [[entities/higgsfield]] — long-form physical-motion video model

## Patterns absorbed (use these in Nexus)

- [[atoms/voyager-iterative-curriculum-absorbed]] — propose → exec → grade → 3 consecutive passes → ship as draft skill
- [[atoms/evoskill-proposerevaluator-loop-absorbed]] — separating proposer from evaluator avoids self-grading bias
- [[atoms/evoskill-git-branched-skill-versioning-absorbed]] — every skill rev is a git branch; revert by checking out the parent
- [[atoms/hermes-3-tier-light-index-recall-absorbed]] — title → frontmatter → body, in that order; full-body read is the exception
- [[atoms/hermes-frontmatter-skill-routing-absorbed]] — `intent:` + `required_tools:` make routing decisions cheap
- [[atoms/hermes-system-wide-rollback-absorbed]] — every destructive op records a rollback token; one-click revert

## Anti-patterns rejected (do NOT replicate)

- [[atoms/openclaw-tool-switchboard-fragility-rejected]] — Composio-style central registry beats hand-rolled tool switchboards
- [[atoms/voyager-vector-db-skill-drift-rejected]] — pinning every skill to a vector embedding drifts as models change; markdown-frontmatter is the durable surface

## On trial (data still incoming)

- [[atoms/mimo-pro-25-cheap-top-performer-trial]] — Mimo Pro 2.5 will replace Claude when Claude Max ends; stub adapter ready in `lib/llm/providers/mimo.ts`

## Nexus-originated patterns (combined from the above)

- [[atoms/lean-mode-pivot-via-feature-flag-not-branch-fork-nexus-pattern]] — `LEAN_MODE` env flag keeps multi-tenant code dormant rather than branching; cheaper revert + no merge debt
- [[atoms/rootless-podman-sandbox-for-closed-upskilling-loop-nexus-pattern]] — `services/nexus-sandbox` runs proposed skill code rootless; skill-trainer agent grades via the verifier loop
- [[atoms/claude-gateway-hmac-protocol-matches-dispatchtoopenclaw]] — Claude gateway's HMAC-bearer-signature shape mirrors the legacy claw dispatch protocol so call sites swap one client for another

## Ingestion workflow

Operator POSTs `{ repo_url, framework_name }` to `/api/agents/survey-oss-framework`. The route spawns the `firecrawl` agent on the README + key docs, hands findings to `supermemory` which extracts entity + atom rows and back-links them to this MOC. Each atom carries `kind:` (`pattern` / `anti-pattern` / `trial` / `nexus-pattern`) and `status:` (`absorbed` / `rejected` / `evaluating`). The cron at `/api/cron/rebuild-graph-hq` regenerates orphan + dangling-link reports nightly; this MOC's body is the canonical source of "what's actually linked vs floating."
