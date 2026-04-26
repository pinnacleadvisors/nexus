---
type: moc
title: "Pillar B — Secure the platform"
id: ecosystem-b-pack
created: 2026-04-26
sources:
  - task_plan.md#L163
links:
  - "[[task-b1-auth-gate-chat]]"
  - "[[task-b2-auth-gate-content]]"
  - "[[task-b3-auth-gate-r2-egress-allowlist]]"
  - "[[task-b4-auth-gate-storage]]"
  - "[[task-b5-auth-gate-audit]]"
  - "[[task-b6-encryption-key-fail-closed]]"
  - "[[task-b7-csp-hardening]]"
  - "[[task-b8-csrf-origin-wrapper]]"
  - "[[task-b9-per-user-daily-cost-cap]]"
  - "[[task-b10-openclaw-config-encrypted-db]]"
  - "[[task-b11-secret-scanning-precommit]]"
  - "[[task-b12-rate-limit-public-audit]]"
---

# Pillar B — Secure the platform

The 12 tasks (B1–B12) closing the confirmed auth gaps in `app/api/*`. B1–B5 are
critical (unauthenticated routes that cost money or leak data); B6–B12 harden the
broader platform. Ship before any Pillar A feature that spends real money.

## Tasks
- [[task-b1-auth-gate-chat]] — `/api/chat` auth + ratelimit + audit
- [[task-b2-auth-gate-content]] — `/api/content/{generate,score,variants}`
- [[task-b3-auth-gate-r2-egress-allowlist]] — `/api/r2` + `lib/r2-url-guard.ts`
- [[task-b4-auth-gate-storage]] — `/api/storage` + user-id prefix scoping
- [[task-b5-auth-gate-audit]] — `/api/audit` self-or-owner gate
- [[task-b6-encryption-key-fail-closed]] — `lib/crypto.ts` fails closed in production
- [[task-b7-csp-hardening]] — `next.config.ts` gates `unsafe-eval` on dev
- [[task-b8-csrf-origin-wrapper]] — `lib/withGuards.ts` consolidates guards
- [[task-b9-per-user-daily-cost-cap]] — `lib/cost-guard.ts` enforces 402 over `USER_DAILY_USD_LIMIT`
- [[task-b10-openclaw-config-encrypted-db]] — `user_secrets` table replaces cookie storage
- [[task-b11-secret-scanning-precommit]] — `.husky/pre-commit` runs `scripts/scan-secrets.sh`
- [[task-b12-rate-limit-public-audit]] — Distinct buckets per public surface

## Related
- [[ecosystem-a-pack]]
- [[ecosystem-c-pack]]
