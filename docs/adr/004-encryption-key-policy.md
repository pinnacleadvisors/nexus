# ADR 004 — ENCRYPTION_KEY Policy: Fail-Closed in Production AND Staging

- Status: Accepted
- Date: 2026-05-02
- Deciders: Platform Owner

## Context

`lib/crypto.ts` provides AES-256-GCM symmetric encryption used by:
- `user_secrets` table (OAuth tokens, OpenClaw config)
- `business_operators.slack_webhook_url_enc` (PR 4)
- Future: any per-user secret store

The implementation throws on import in production when `ENCRYPTION_KEY` is unset (B6 in `task_plan.md`). In `development`, a static placeholder key is used so contributors can run the app without configuring secrets — this is acceptable because dev DBs are disposable.

Staging is a third environment that's neither dev nor production: it's a real deployed Vercel preview against a real Supabase project. A staging deployment with `ENCRYPTION_KEY` accidentally unset would silently use the dev placeholder, encrypting real owner data with a publicly-readable key.

## Problem

`NODE_ENV` only differentiates `development` vs `production`. Vercel preview deploys ship with `NODE_ENV=production` by default (so the prod check protects them). But:
- Custom Vercel staging branches with `NEXT_PUBLIC_VERCEL_ENV=preview` and `NODE_ENV=development` (rare, but possible if someone overrides) are exposed.
- Self-hosted Coolify staging deployments default to `NODE_ENV=production`, which is correct, but warrants explicit policy documentation.

## Decision

`lib/crypto.ts` fails closed when `ENCRYPTION_KEY` is unset AND **either**:
- `NODE_ENV === 'production'`, OR
- `VERCEL_ENV === 'preview'` (any non-production deploy on Vercel), OR
- `NEXUS_REQUIRE_ENCRYPTION_KEY === '1'` (explicit override for self-hosted staging)

The static dev placeholder is **only** used when the running environment matches `NODE_ENV=development` AND none of the above flags trigger. Everywhere else, importing the module throws `EncryptionKeyMissingError` so the deploy never starts.

## Consequences

- **Staging safe:** Vercel preview deploys without `ENCRYPTION_KEY` will fail at import, surfacing the misconfiguration before any user data is written.
- **Self-hosted staging requires the override flag.** Document this in `memory/platform/SECRETS.md`.
- **Local dev unchanged.** Contributors continue running without configuring secrets.

## Alternatives considered

- **Always fail closed**: blocks contributor onboarding. Discarded.
- **Fail closed only in production**: leaves Vercel preview vulnerable. Discarded.
- **Generate a random per-deploy key when unset**: silently breaks decryption on the next deploy. Discarded.

## Rollout

1. Update `lib/crypto.ts` to add the staging check (PR 6 of `task_plan-ux-security-onboarding.md`).
2. Add `NEXUS_REQUIRE_ENCRYPTION_KEY` to `memory/platform/SECRETS.md` under the Security section.
3. Verify by running `NODE_ENV=production node -e "require('./lib/crypto')"` with the env unset → should throw.

## Related

- `lib/crypto.ts`
- `memory/platform/SECRETS.md`
- `task_plan.md` Pillar B item B6
- `task_plan-ux-security-onboarding.md` PR 6
