---
type: atom
title: "Manual — Upstash Redis for rate limiting"
id: manual-upstash-redis
created: 2026-04-26
sources:
  - ROADMAP.md#L153
links:
  - "[[manual-steps]]"
  - "[[phase-9-security-hardening]]"
status: active
lastAccessed: 2026-04-26
accessCount: 0
---

# Manual — Upstash Redis for rate limiting

✅ Done. https://console.upstash.com → Create Database → copy REST URL + token. Add `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` to Doppler. Backs `lib/ratelimit.ts`; falls back to in-memory when unset.

## Related
- [[manual-steps]]
- [[phase-9-security-hardening]]
