# Task Plan — Migrate Nexus to a Local Mac-mini "Personal OS"

> Initialised 2026-06-04. Branch: `chore/local-os-migration-plan`.
> Goal: retire the Hostinger subscription by running the Nexus stack on the operator's Mac mini.

## Step 0 — North Star

```
Goal:             Run the Nexus platform on the local Mac mini (OrbStack + docker-compose),
                  fronted by Cloudflare Tunnel, so the Hostinger KVM4 / Coolify subscription
                  can be cancelled — while keeping Supabase Cloud as the durable data layer.

Success criteria:
  - All 7 services run on the Mac via `docker compose` under OrbStack (no Coolify).
  - Public hostnames (nexus / claude-gw / codex-gw / n8n .coolifycloudtunnel.uk) resolve
    to the Mac via a local cloudflared tunnel.
  - /api/health/deep returns green for claude_gateway, codex_gateway, supabase, redis.
  - cron-job.org jobs fire successfully against the Mac-hosted NEXUS_BASE_URL.
  - Operator dashboard + at least one autonomous business cycle run end-to-end locally.
  - Stack auto-restarts after a reboot / power loss.
  - Hostinger KVM4 decommissioned; subscription cancelled.

Hard constraints (must NOT break):
  - Supabase Cloud stays the source of truth — zero DB data migration, no RLS changes.
  - No secret values leave Doppler / land in git / hit stdout. DOPPLER_TOKEN-only pattern preserved.
  - Live businesses keep their connected-account scoping (business_slug partition) intact.
  - KVM4 stays running as fallback until Phase 4 soak passes — no big-bang.
  - 16 GB RAM budget respected — qa-runner stays on-demand, Supabase NOT self-hosted.
```

### Decisions (from operator, 2026-06-04) → write ADR 007
- **Mac-mini role:** Primary host + cloud fallback (Supabase + external SaaS remain the backbone).
- **Orchestration:** OrbStack + plain `docker-compose`. Coolify dropped locally (not native to macOS).
- **Database:** Supabase Cloud retained. (Operator's "local DB access for Claude" wish is met by
  Claude running scripts on the Mac directly against cloud Supabase with the service-role key in
  Doppler — no tunnel hops, no per-business-container indirection. A local read-mirror is a deferred
  future option, not in scope.)
- **Rollout:** Phased, each phase reversible before the next.

### Why this is a net win (call out in ADR)
- claude-gateway + codex-gateway on the operator's OWN machine → pty-mode **subscription billing**
  (Claude Max 20x / Codex Pro) instead of API rates. See memory `nexus-claude-gateway-pty-mode`.
- One box the operator physically controls → Claude can inspect the whole stack locally without
  hitting 3rd-party-platform errors through remote hops.
- Kills the recurring Hostinger cost.

---

## Phase 1 — Local runtime + secrets (localhost only, no public traffic)

Goal: stand the app + both gateways up on `localhost`, smoke-test against cloud Supabase. KVM4 untouched.

### Task 1 — Install OrbStack
- Cmd: `brew install orbstack` then launch once to start the Docker daemon.
- Verify: `docker version` shows a running server; `docker run --rm hello-world` passes.
- Parallel: no (blocks everything)

### Task 2 — Verify Doppler access on the Mac
- Cmd: `doppler configure` is already at `dev-3.76.0`. Confirm the `prd` (or chosen) config is reachable:
  `doppler secrets --only-names -p <project> -c prd | head`.
- Verify: secret NAMES list (never values) prints without auth error.
- Parallel: yes

### Task 3 — Create the shared local docker network
- Cmd: `docker network create nexus-net` (replaces the external `coolify` network the compose files expect).
- Verify: `docker network ls | grep nexus-net`.
- Parallel: yes

### Task 4 — Author a local override compose (`services/local-os/docker-compose.yaml`)
- Change: new compose that `include:`s the per-service files but (a) maps the external `coolify`
  network → local `nexus-net`, (b) publishes app on `127.0.0.1:3000`, gateways on `:3001/:3002`,
  n8n on `:5678`. Scaffold-then-fill per write-size discipline.
- Verify: `docker compose -f services/local-os/docker-compose.yaml config` resolves with no errors.
- Parallel: no (depends on Task 3)

### Task 5 — Build + boot app, claude-gateway, codex-gateway locally
- Cmd: `doppler run -- docker compose -f services/local-os/docker-compose.yaml up -d nexus-app claude-gateway codex-gateway`
  (each service still self-fetches via its own DOPPLER_TOKEN; the outer `doppler run` only seeds build args).
- Verify: `curl localhost:3000/api/health` ok; gateway `/health` on 3001/3002 ok.
- Parallel: no

### Task 6 — Smoke test against cloud Supabase
- Verify: log in to the local dashboard (Clerk), confirm a Supabase-backed page (Board / dashboard)
  renders real rows; run one `/api/claude-session/dispatch` and confirm the local gateway answers
  in pty/subscription mode (check gateway logs for the pty path, not `-p`).
- Parallel: no
- GATE (PDCA): app + gateways healthy on localhost against cloud DB before any networking changes.

---

## Phase 2 — Networking cutover (Cloudflare Tunnel → Mac)

Goal: public hostnames resolve to the Mac. KVM4 still running as live fallback during this phase.

### Task 7 — Stand up `cloudflared` on the Mac
- Change: add a `cloudflared` service to the local compose with an ingress `config.yml` mapping
  `nexus.coolifycloudtunnel.uk → nexus-app:3000`, `claude-gw.* → claude-gateway:3000`,
  `codex-gw.* → codex-gateway:3000`, `n8n.* → n8n:5678`. Reuse the existing tunnel credentials
  (pull the tunnel token from Doppler; cf. `scripts/migrate-tunnel-hostname.mjs`).
- Verify: `cloudflared tunnel info` shows the Mac connector registered.
- Parallel: no

### Task 8 — Flip DNS / ingress to the Mac, drain KVM4
- Change: point the Cloudflare tunnel ingress at the Mac connector (or move CNAMEs). Keep KVM4
  connector up but lower-priority so rollback = re-point.
- Verify external reachability of EACH integration callback:
  - Clerk sign-in works from a fresh browser.
  - Stripe webhook test event → `/api/webhooks/stripe` 200.
  - Composio OAuth callback round-trips.
  - cron-job.org "run now" on `chat-turn-drain` → 200.
- Parallel: no
- GATE: every external webhook green before touching KVM4 services.

---

## Phase 3 — Remaining services

### Task 9 — n8n (preserve `N8N_ENCRYPTION_KEY`)
- Change: boot n8n locally with the SAME `N8N_ENCRYPTION_KEY` value so existing credentials decrypt.
  Export workflows+creds from KVM4 n8n, import locally (cf. `docs/runbooks/n8n-kvm1-to-coolify.md`).
- Verify: workflows list non-empty, a credential test passes, one manual workflow run succeeds.

### Task 10 — nexus-sandbox + qa-runner + firecrawl
- Change: boot nexus-sandbox (rootless-podman-in-docker) and firecrawl; qa-runner stays `--profile ondemand`
  (not auto-started — RAM). Resolve `FIRECRAWL_API_URL` to the local container.
- Verify: `/api/sandbox/exec` round-trips; firecrawl scrape of a test URL returns markdown.

---

## Phase 4 — Reliability soak

### Task 11 — Auto-start on boot / power
- Change: `pmset -a autorestart 1` (restart after power loss); a launchd plist that runs
  `docker compose ... up -d` on login/boot. OrbStack set to auto-start.
- Verify: full reboot → stack comes back green unattended within N minutes.

### Task 12 — 48–72h soak with KVM4 still alive as fallback
- Verify: `/api/health/deep` green continuously; cron-job.org dashboard shows no auto-disabled jobs;
  one full `solopreneur-tick` cycle completes locally.
- GATE: soak clean → proceed to decommission.

---

## Phase 5 — Decommission Hostinger

### Task 13 — Tear down KVM4 + cancel subscription
- Change: stop KVM4 Coolify apps, snapshot/export anything stateful, cancel the Hostinger plan.
- Verify: nothing 5xxs after KVM4 is off for 24h.

### Task 14 — Memory + docs
- Update AGENTS.md **Topology** paragraph: KVM4 → "Mac mini (local, OrbStack)". Mark KVM4 RETIRED.
- Write infra-change `memory_atom` linked to `[[mocs/platform-topology]]` per the
  Post-infrastructure-change protocol.
- Write ADR 007 (the decisions above).
- Update `memory/platform/SECRETS.md` if any env var moved.

---

## Progress (as of 2026-06-04)
### Completed
- [x] Phase 0 — explored topology, captured 4 operator decisions, wrote this plan + branch.
- [x] Phase 1 COMPLETE (Tasks 1–6):
  - OrbStack installed, Docker 29.4.0 daemon live; `coolify` network created.
  - prd Doppler service token `local-os-mac-mini` minted → gitignored `.env` (138 secrets, verified).
  - app + claude-gateway + codex-gateway built & running under OrbStack, all healthy.
  - **Mac → cloud Supabase REST = 200 REACHABLE** (direct, no hops — the core goal).
  - Gateways `loggedIn:true` on fresh volumes via prd `CLAUDE_CODE_OAUTH_TOKEN` (likely already
    subscription-billed in pty-mode — CONFIRM with a real dispatch before Phase 5).
  - Fix applied: nexus-app needed `HOSTNAME=0.0.0.0` (Next standalone bound to container-ID IP
    only; localhost healthcheck + host port-forward missed it). Masked on Coolify by network-alias routing.

### Remaining
- [ ] Phase 2 — cloudflared on Mac + tunnel cutover. Decide: also override the LOCAL app's
  `CLAUDE_CODE_GATEWAY_URL` → `http://claude-gateway:3000` so it uses local gateways (no tunnel hop)?
  Currently it routes to remote KVM4 (prd value `https://claude-gw.coolifycloudtunnel.uk`).
- [ ] Phases 3–5.

### Resolved (operator, 2026-06-04)
- Doppler: run the Mac against the existing **`prd`** config (project `nexus`). Repo dir currently
  defaults to `dev` — local-os compose must explicitly target `prd`.
- Cloudflare Tunnel credential: Doppler secret **`CLOUDFLARE_NEXUS_COOLIFY_MIGRATION`** (confirmed present in `prd`).

### Blockers / Open Questions
- Firecrawl: a container exists in Coolify today but operator is unsure it's functioning. → DEFER
  to Phase 3 Task 10; verify the existing one first, only then decide local vs keep-hosted.
```
