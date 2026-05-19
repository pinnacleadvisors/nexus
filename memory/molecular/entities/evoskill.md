---
type: entity
subtype: concept
title: "EvoSkill"
id: evoskill
created: 2026-05-19
---

# EvoSkill

Proposer/Evaluator loop with git-branched skill versioning. Agent proposes candidate code → evaluator scores against success criteria → if it passes 3 consecutive cases, commit to a versioned skill branch. Nexus absorbs the inner loop + branch-per-skill pattern; moves execution into a local Podman sandbox to eliminate prompt overhead.
