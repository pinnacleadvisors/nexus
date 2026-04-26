---
type: atom
title: "B3 — Auth-gate /api/r2 + egress allowlist"
id: task-b3-auth-gate-r2-egress-allowlist
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L179
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b3]]"
---

# B3 — Auth-gate `/api/r2` + egress allowlist

Edit `app/api/r2/route.ts` to require `auth()` on every verb. Add
`lib/r2-url-guard.ts` validating any `{url}` payload: reject private IPs (RFC1918,
loopback, link-local `169.254.0.0/16`, IPv6 private), reject non-http(s) schemes,
follow at most 3 redirects with re-validation, cap downloads at 50 MB.

Verify: POST `{url:"http://169.254.169.254/latest/meta-data"}` → 400; public URL
under 50 MB → 201.

## Related
- [[ecosystem-b-pack]]
