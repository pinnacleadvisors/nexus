---
type: atom
title: "Coolify secret edits require Redeploy not Restart"
id: coolify-secret-edits-require-redeploy-not-restart
created: 2026-04-28
sources:
  - https://github.com/coollabsio/coolify
links:
  - "[[coolify]]"
status: active
lastAccessed: 2026-04-28
accessCount: 0
---

# Coolify secret edits require Redeploy not Restart

Editing a Secret-marked environment variable in the Coolify v4 UI does not propagate to the running container on a plain restart; the container keeps the old value until a full Redeploy. Symptom: bearer/HMAC mismatches after env edits, fixed only by clicking Redeploy.

## Related
- [[coolify]]
