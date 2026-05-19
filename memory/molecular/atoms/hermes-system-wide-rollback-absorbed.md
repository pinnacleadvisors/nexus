---
type: atom
title: "Hermes system-wide rollback (absorbed)"
id: hermes-system-wide-rollback-absorbed
created: 2026-05-19
links:
  - "[[hermes]]"
  - "[[agent-framework-survey]]"
status: active
lastAccessed: 2026-05-19
accessCount: 0
---

# Hermes system-wide rollback (absorbed)

Hermes takes a temporary directory snapshot before executing any command; runs git stash on assertion failure. Absorbed: the nexus-sandbox runs each exec inside an ephemeral --rm Podman container — if the script breaks, container is destroyed; nothing on the host is mutated.

## Related
- [[hermes]]
- [[agent-framework-survey]]
