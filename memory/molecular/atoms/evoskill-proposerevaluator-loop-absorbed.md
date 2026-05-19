---
type: atom
title: "EvoSkill Proposer/Evaluator loop (absorbed)"
id: evoskill-proposerevaluator-loop-absorbed
created: 2026-05-19
links:
  - "[[evoskill]]"
  - "[[agent-framework-survey]]"
status: active
lastAccessed: 2026-05-19
accessCount: 0
---

# EvoSkill Proposer/Evaluator loop (absorbed)

EvoSkill's inner loop: propose code → run → evaluate against criteria → retry. Absorbed: skill-trainer agent runs at most max_iterations (default 5), grading each output against the brief's success_criteria; requires 3 consecutive passes before writing the SKILL.md. Eliminates EvoSkill's prompt overhead by running execution in nexus-sandbox (local Podman) instead of via an LLM round-trip.

## Related
- [[evoskill]]
- [[agent-framework-survey]]
