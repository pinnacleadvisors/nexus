---
type: atom
title: "B11 — Secret-scanning pre-commit hook"
id: task-b11-secret-scanning-precommit
created: 2026-04-26
status: planned
sources:
  - task_plan.md#L227
links:
  - "[[ecosystem-b-pack]]"
---

# B11 — Secret-scanning pre-commit hook

Add `.husky/pre-commit` (or `.git/hooks/pre-commit`) plus
`scripts/scan-secrets.sh`. The script greps for
`(sk-[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{20,}\.|-----BEGIN [A-Z ]+ PRIVATE KEY-----)`
across `*.ts` and `*.md` (excluding `node_modules`) and fails the commit on hit.
Pair with `gitleaks` config when CI exists.

Verify: drop an `sk-test...` token in a file → commit rejected.

## Related
- [[ecosystem-b-pack]]
