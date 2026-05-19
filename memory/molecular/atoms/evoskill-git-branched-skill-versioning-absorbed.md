---
type: atom
title: "EvoSkill git-branched skill versioning (absorbed)"
id: evoskill-git-branched-skill-versioning-absorbed
created: 2026-05-19
links:
  - "[[evoskill]]"
  - "[[agent-framework-survey]]"
status: active
lastAccessed: 2026-05-19
accessCount: 0
---

# EvoSkill git-branched skill versioning (absorbed)

EvoSkill commits each successful candidate to a versioned skill branch — easy A/B against alternatives, full history of fixes. Absorbed: Nexus skill-trainer writes SKILL.md to .claude/skills/<name>/ which is git-tracked; the human flips status: draft → verified via POST /api/skills/<slug>/promote, the change is committed by the operator.

## Related
- [[evoskill]]
- [[agent-framework-survey]]
