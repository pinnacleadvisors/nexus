# 011 — Mac-mini local OS as primary host (off Hostinger)

- **Date:** 2026-06-04
- **Status:** Accepted

## Context

Post-lean-mode (ADR 006) the whole platform ran on a single Hostinger VPS (KVM4) under Coolify. Two problems: (1) the Hostinger subscription is a recurring cost whose plan expires 2026-06-28, and (2) the operator + Claude/agents kept hitting friction operating the stack through a remote host (debugging, DB inspection, cron management all required round-tripping a third party). The operator owns a Mac mini (Apple Silicon, 16 GB) that can host the stack directly.

## Decision

Move the **primary host to the Mac mini**, running the existing per-service `docker-compose.yaml` files under **OrbStack** (Coolify is not native to macOS; a single box doesn't need its orchestration). Decisions taken with the operator:

- **Role:** Mac = primary; cloud SaaS (Supabase, Stripe, Composio, Cloudflare) is the durable backbone. KVM4 stays as fallback until its 2026-06-28 expiry.
- **Orchestration:** OrbStack + plain compose (`services/local-os/docker-compose.yaml`), not Coolify-in-a-VM.
- **Database:** **Supabase stays cloud** — zero data migration, survives Mac outages. (A local mirror was considered and declined: 16 GB RAM + single-point-of-failure for data.)
- **Networking:** a dedicated `nexus-mac` Cloudflare tunnel (separate from KVM4's `nexus-fleet`), so cutover is a per-hostname DNS flip with instant rollback.
- **Secrets:** one `DOPPLER_TOKEN` (prd service token) in a gitignored `.env`; containers self-fetch — same pattern as Coolify.
- **Crons:** run locally via a `cron-runner` (supercronic) container reading an agent-editable `crons.json`, replacing cron-job.org (retired) — eliminating the third-party scheduler the operator wanted gone.
- **Autostart:** OrbStack login-item + a `com.nexus.local-os` LaunchAgent; `pmset` set to never-sleep + auto-restart after power loss. Auto-login left **off** (security choice — unattended power-cut reboot needs one manual login).

**Scoped out:** n8n stays on KVM4 (no substantial workflows). firecrawl was already broken pre-migration. qa-runner stays on KVM4 (heavy/on-demand).

Alternatives considered: Coolify-in-a-Linux-VM (rejected — RAM + complexity on 16 GB); self-hosting Supabase (rejected — RAM + data SPOF); big-bang cutover (rejected — phased with KVM4 fallback is reversible).

## Consequences

- **Easier:** Claude/agents operate the whole stack locally (no remote hops); crons are a local file edit + container restart; gateways run on the operator's own machine → pty-mode **subscription billing** (Claude Max / Codex Pro) instead of API rates; Hostinger cost eliminated.
- **Harder / to watch:** uptime now depends on the Mac staying awake + on home internet/power (mitigated by `pmset` + Cloudflare tunnel; no auto-failover — rollback is a manual DNS repoint). The Mac app reaches the gateways via a tunnel hairpin (minor latency; internal-routing optimization deferred).
- **Must revisit before 2026-06-28:** the KVM4 fallback (and thus the DNS-repoint rollback) disappears when the Hostinger plan expires. Decommission tasks, n8n's fate, and `N8N_BASE_URL` (still a raw Hostinger URL) must be resolved by then. Tracked in `task_plan-local-os-migration.md`.
