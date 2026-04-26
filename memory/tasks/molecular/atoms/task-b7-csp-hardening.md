---
type: atom
title: "B7 — CSP hardening"
id: task-b7-csp-hardening
created: 2026-04-26
status: completed
sources:
  - task_plan.md#L203
links:
  - "[[ecosystem-b-pack]]"
  - "[[progress-ecosystem-b7]]"
---

# B7 — CSP hardening

Edit `next.config.ts` to gate `'unsafe-eval'` behind
`process.env.NODE_ENV !== 'production'`. Add a stricter
`Content-Security-Policy-Report-Only` header (no `'unsafe-inline'` on scripts) plus
a `Report-To` endpoint at `/api/csp-report` that collects violations for a week
before enforcing.

Verify: production build inspects headers — no `'unsafe-eval'`; report-only header
present.

## Related
- [[ecosystem-b-pack]]
