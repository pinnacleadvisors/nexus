# Runbook — LEAN_MODE

Status: **active for solo development.** Set `LEAN_MODE=1` in the runtime env to enable.

## Overview

Nexus has two operating shapes:

| Mode | When | Topology |
|---|---|---|
| **Scale mode** (LEAN_MODE unset or `0`) | Multi-tenant — paying users with isolated businesses | Vercel + KVM2 (codex) + KVM4 (per-business claude gateways) + Supabase + Stripe attribution per business |
| **Lean mode** (LEAN_MODE=`1`) | Solo owner — rapid development of autonomous-workforce primitives | Single KVM with Coolify hosting the Next.js app, one shared `claude-gateway`, one `codex-gateway`, Supabase (free tier), Stripe (no per-business metadata) |

The scale-mode code stays in tree, dormant. Lean mode is the **default for solo development**; scale mode comes back online when paying users are onboarded.

The single source of truth for the flag is [`lib/lean-mode.ts`](../../lib/lean-mode.ts) — every guard imports `isLeanMode()` from there.

---

## What gets switched

| Subsystem | Scale-mode behaviour | Lean-mode behaviour |
|---|---|---|
| Per-business container provisioning (`POST /api/businesses/[slug]/provision`) | Resolves manifest → creates Coolify app → persists `business:<slug>` gateway secrets | Returns `200 { ok: false, error: 'Per-business provisioning disabled in lean mode' }` (200 per retry-storm rule) |
| Idle scale-down cron (`/api/cron/scale-down-businesses`) | Stops idle per-business apps every 30 min | Early-returns `{ ok: true, skipped: 'lean-mode' }` — no Coolify calls |
| Cost-guard (`lib/cost-guard.ts`) | Per-business + per-user tiered caps (default $10 + $25/day) | Single global cap from `LEAN_USER_DAILY_USD_LIMIT` (default $5/day) |
| Composio resolution (`executeBusinessAction()`) | Two-step: per-business row first, then user-default fallback | Single step: user-default only (`business_slug IS NULL`) |
| Stripe attribution | `metadata.business_slug` + per-business `statement_descriptor` on every `payment_intent.create` | Plain Stripe calls — no per-business metadata |
| Shared gateway URL | Resolved per business via `business:<slug>` user-secret | Always resolves to `CLAUDE_CODE_GATEWAY_URL` env var |

What does NOT change in lean mode:
- Auth (Clerk + `ALLOWED_USER_IDS`)
- Supabase schema or queries (multi-tenant tables still partition by `business_slug` — the column is just always set to the owner's default value or NULL)
- memory-hq (cross-project graph, always on)
- Skill router + sandbox + Board (all run identically)
- All routes that aren't touched by the boundary list above

---

## How to enable

1. Set `LEAN_MODE=1` in Doppler under the runtime config (production project → `LEAN_MODE`).
2. Optionally set `LEAN_USER_DAILY_USD_LIMIT=<dollars>` (default $5/day).
3. Redeploy. The flag is read on every request — no warm-up.

To verify:
```bash
# locally, with the flag set
LEAN_MODE=1 npx tsc --noEmit
LEAN_MODE=1 curl -X POST https://<host>/api/businesses/test/provision -H 'Authorization: Bearer <NEXUS_OPS_TOKEN>'
# Expect: 200 { ok: false, error: 'Per-business provisioning disabled in lean mode' }
```

---

## How to revert (re-enable scale mode)

1. Unset `LEAN_MODE` in Doppler (or set to `0`).
2. Confirm `CLAUDE_CODE_GATEWAY_URL`, `OPENCLAW_GATEWAY_URL`, and per-business `business:<slug>` secrets are populated for the businesses you want active.
3. Redeploy. Provisioning, scale-down cron, and per-business resolution come back online with zero code change.

The git tag [`v1.0-multi-tenant`](https://github.com/pinnacleadvisors/nexus/releases/tag/v1.0-multi-tenant) marks the last scale-mode-default commit. If anything regressed since, diff against it.

---

## Cutover playbook (Vercel + dual-KVM → single Coolify KVM)

When you're ready to physically migrate hosting (separate from flipping the flag — the flag works on either topology):

### Prerequisites
- Hostinger KVM provisioned with Coolify v4+ installed.
- KVM tier confirmed to support **rootless Podman / Docker** (most VPS plans do; check `podman info` after install).
- Cloudflare DNS already managing the apex domain.
- Doppler `production` config has every required secret (see `services/lean-deploy/README.md`).

### Steps

1. **Drop Cloudflare TTL** on the apex domain to 60s a few hours before cutover so the swap propagates fast.

2. **Import the Compose stack into Coolify**:
   - Coolify → new application → Docker Compose
   - Point at `services/lean-deploy/docker-compose.yml` from the GitHub repo
   - Bind the Doppler secrets (use Coolify's "shared variables" feature or paste in `.env`)
   - Apply, deploy

3. **Smoke test against the Coolify-hosted instance**:
   - Hit `https://<coolify-temp-domain>/api/health`
   - Sign in via Clerk
   - Run `/forge` chat once — verify Claude Code gateway path responds
   - Verify Supabase queries (`/dashboard`) — confirms `DATABASE_URL` / `SUPABASE_*` env wiring

4. **Stripe webhook URL rotation**:
   - Stripe dashboard → Webhooks → edit endpoint → swap URL from `https://nexus-xxx.vercel.app/api/stripe/webhook` to `https://<new-domain>/api/stripe/webhook`
   - Send a test event from Stripe — verify it lands

5. **DNS swap**:
   - Cloudflare DNS → A record → point at the Coolify host IP
   - Wait 1-2 min for propagation (TTL is 60s now)

6. **Decommission**:
   - Vercel project → settings → delete (or pause)
   - KVM2 codex-gateway → stop the container, keep the host running for now in case of rollback
   - Wait 7 days, then delete the second KVM

### Rollback

If anything breaks within the first 24h:
- Re-point Cloudflare DNS to the old Vercel deployment (it's still live until you delete it)
- Re-point Stripe webhook back
- Investigate, fix, retry

---

## Manual prerequisites checklist

Use the up-to-date list at the end of [`task_plan-lean-mode.md`](../../task_plan-lean-mode.md).

---

## See also

- [`lib/lean-mode.ts`](../../lib/lean-mode.ts) — the flag itself
- [`services/lean-deploy/docker-compose.yml`](../../services/lean-deploy/docker-compose.yml) — the lean Coolify stack
- [`task_plan-lean-mode.md`](../../task_plan-lean-mode.md) — full pivot plan + progress
- [`docs/adr/006-lean-mode-pivot.md`](../adr/006-lean-mode-pivot.md) — decision record
