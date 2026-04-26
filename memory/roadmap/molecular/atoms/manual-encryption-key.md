---
type: atom
title: "Manual — Generate ENCRYPTION_KEY for OAuth tokens"
id: manual-encryption-key
created: 2026-04-26
sources:
  - ROADMAP.md#L148
links:
  - "[[manual-steps]]"
  - "[[phase-9-security-hardening]]"
status: active
lastAccessed: 2026-04-26
accessCount: 0
---

# Manual — Generate ENCRYPTION_KEY

⬜ Not done. Generate via `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` and add as `ENCRYPTION_KEY` in Doppler. Existing OAuth tokens in cookies will re-encrypt on next login.

## Related
- [[manual-steps]]
- [[phase-9-security-hardening]]
