# P0 Security Remediation Guide

> Source: the 2026-06-05 multi-agent security audit (`/manage-platform` dynamic workflow).
> Scope: the **three P0 items only**. P1/P2 live in the audit report.
> Companion to [topology](../../AGENTS.md#topology) and [`services/local-os/README.md`](../../services/local-os/README.md).

The three P0 items:
1. **Rotate the Doppler `prd` secret set** (a gateway RCE dumps the entire vault; some values were also rendered in a local audit transcript).
2. **Separate macOS user + sign personal iCloud out** of the host that runs public services.
3. **Cloudflare Access in front of `code.coolifycloudtunnel.uk`** (the one public host-shell with the weakest gate).

### Legend — who does what

| Mark | Meaning |
|------|---------|
| 🤖 **Claude** | I can do this autonomously (in-repo file/script changes) — I stage it, you review + apply. |
| 🧑 **You** | Operator-only — needs a provider dashboard, `sudo`, the macOS GUI, iCloud, or a dev-machine interactive login. I physically cannot do it and shouldn't. |
| ⚠️ | Has a data-loss / lockout trap — read before running. |

### At-a-glance split

| Step | Owner | Why |
|------|-------|-----|
| 1a Calibrate which secrets actually need rotating | 🤖 | Pure analysis — done below. |
| 1b Generate the self-minted-secret rotation script | 🤖 | In-repo script; you run it. |
| 1c Rotate provider-issued keys (Supabase, Clerk, Composio, Coolify, Inngest) | 🧑 | Each is a vendor dashboard. |
| 1d `codex login` → new `CODEX_AUTH_JSON` | 🧑 | Interactive OAuth on your dev machine. |
| 1e Push new values to Doppler `prd` + redeploy the stack | 🧑 (🤖 helper) | I provide the exact commands; you run them (outward + destructive). |
| 2  New macOS user, move the stack, iCloud sign-out | 🧑 (🤖 templates) | `sudo` + GUI + per-user OrbStack + iCloud. I provide parameterized plists. |
| 3  Cloudflare Access on `code.*` (+ gateways) | 🧑 | Cloudflare Zero-Trust dashboard. |
| ★ Scrub the local audit transcript that printed tokens | 🤖 | I can locate + redact on your go-ahead. |

---

## Task 1 — Rotate the Doppler `prd` secrets

### 1a. Calibration first (🤖 — read this before rotating anything)

**How bad is the exposure, really?** The tokens were rendered in plaintext into a **local** audit transcript on *your own* Mac (`/private/tmp/claude-501/.../tasks/wmvbgdpq4.output` + the workflow subagent logs). They were **not** sent to any external service. So the realistic exposure is "cleartext-at-rest on your own box," not "leaked to the internet." That makes this **important but not a fire** — *unless* you ever sync `~/.claude` or `/tmp` somewhere, or the box is later compromised, in which case those files are a free credential dump.

**The structural finding stands regardless of the transcript:** *any* future RCE in a gateway dumps the whole vault in one `env` call (audit findings #1, #6). Rotation reduces the standing risk; the P1 work (scoped Doppler configs, non-root, `:ro` repo) is what actually fixes the root cause.

**Priority order** (rotate cheap + high-blast-radius first):

| Tier | Secrets | Effort |
|------|---------|--------|
| **Rotate now** | gateway bearers, `CRON_SECRET`, `NEXUS_OPS_TOKEN`, `NEXUS_SANDBOX_TOKEN`, the Doppler service token itself, `MEMORY_HQ_TOKEN` (GitHub PAT), `CODEX_AUTH_JSON` | minutes |
| **Rotate now (vendor)** | `SUPABASE_SERVICE_ROLE_KEY`, `CLERK_SECRET_KEY`, `COMPOSIO_API_KEY`, `COOLIFY_KVM4_API_TOKEN`, `INNGEST_SIGNING_KEY`/`INNGEST_EVENT_KEY` | dashboard each |
| **⚠️ DO NOT blind-rotate** | `ENCRYPTION_KEY`, `N8N_ENCRYPTION_KEY` | see 1b |
| Delete (already dead) | `COOLIFY_KVM2_API_TOKEN` (KVM2 retired) | `doppler secrets delete` |

### 1b. ⚠️ The two secrets you must NOT just swap

Rotating these does **not** just invalidate a token — it makes existing **encrypted data unreadable**:

- **`ENCRYPTION_KEY`** — encrypts data at rest in Supabase (connected-account material / stored API keys). Swap it and every existing ciphertext row fails to decrypt. Correct procedure = a **re-encryption migration**: decrypt-with-old → encrypt-with-new in one pass, keeping both keys available during the cutover. Don't touch it as part of this P0 unless you run that migration. (I can write the re-encryption script as a separate task.)
- **`N8N_ENCRYPTION_KEY`** — n8n's credential store is encrypted with it. Rotate it and **every saved n8n credential becomes undecryptable** and must be re-entered by hand. n8n lives on KVM4, not the Mac. Leave it unless you're prepared to re-enter all n8n creds.

Since neither was the cause of any *internet* exposure (they're symmetric data-keys, not network tokens), leaving them is the right call for this P0.

### 1c. Self-minted secret rotation — 🤖 script (you run it)

These are random strings *we* own (no vendor) — safe to regenerate locally. I'll stage this as `scripts/rotate-self-minted-secrets.sh`; it generates fresh values, writes them to Doppler `prd`, and prints what changed so you can redeploy. It deliberately **excludes** the two encryption keys.

```bash
# Stub of what I'll stage (review before running — it WRITES to prd):
set -euo pipefail
P="--project nexus --config prd"
rot() { local k="$1"; local v; v="$(openssl rand -hex 32)"; \
        doppler secrets set $P "$k=$v" >/dev/null && echo "rotated $k"; }

rot CLAUDE_CODE_BEARER_TOKEN
rot CODEX_GATEWAY_BEARER_TOKEN
rot CRON_SECRET
rot NEXUS_OPS_TOKEN
rot NEXUS_SANDBOX_TOKEN
# NOTE: ENCRYPTION_KEY / N8N_ENCRYPTION_KEY intentionally NOT rotated (see 1b).
echo "Done. Now: re-run codex login (1d), rotate vendor keys (1c-vendor), then redeploy (1e)."
```

> ⚠️ Confirm the **exact** Doppler key names against your prd config first — e.g. the claude bearer may be `CLAUDE_CODE_BEARER_TOKEN` or `CLAUDE_GATEWAY_BEARER`. I'll read the real names from `services/*/docker-compose.yaml` + `entrypoint.sh` when I stage the script so it matches your config 1:1.

### 1c-vendor. Provider-issued keys — 🧑 dashboards

| Secret | Where to roll | Then |
|--------|---------------|------|
| `SUPABASE_SERVICE_ROLE_KEY` | ⚠️ Supabase → Settings → API. Note: "Generate new JWT secret" rolls **both** anon + service_role and invalidates all existing tokens — schedule a brief window. | `doppler secrets set --config prd SUPABASE_SERVICE_ROLE_KEY=...` |
| `CLERK_SECRET_KEY` | Clerk → API Keys → roll Secret Key | `doppler secrets set ... CLERK_SECRET_KEY=...` |
| `COMPOSIO_API_KEY` | Composio dashboard → API keys → regenerate | `doppler secrets set ... COMPOSIO_API_KEY=...` |
| `COOLIFY_KVM4_API_TOKEN` | Coolify (KVM4) → Keys & Tokens → revoke + new | `doppler secrets set ... COOLIFY_KVM4_API_TOKEN=...` |
| `INNGEST_SIGNING_KEY` / `INNGEST_EVENT_KEY` | Inngest → app keys → rotate | `doppler secrets set ...` |
| `MEMORY_HQ_TOKEN` | GitHub → Settings → Developer settings → PAT → regenerate (repo scope) | `doppler secrets set ... MEMORY_HQ_TOKEN=...` |

### 1d. `CODEX_AUTH_JSON` — 🧑 (this is the one that was fully printed)

On your **dev machine** (not the Mac, per the auth-rotation runbook):
```bash
codex login                                  # interactive OAuth
# then paste the fresh ~/.codex/auth.json contents into Doppler:
doppler secrets set --project nexus --config prd CODEX_AUTH_JSON="$(cat ~/.codex/auth.json)"
```
See [`docs/runbooks/codex-gateway-auth-rotation.md`](codex-gateway-auth-rotation.md).

### 1e. Rotate the Doppler service token + redeploy — 🧑 (🤖 commands)

The `DOPPLER_TOKEN` in `services/local-os/.env` is itself a full-vault key. Rotate it last (it's how the box reads everything else):
```bash
# Mint a fresh prd service token, revoking the old one:
doppler configs tokens create local-os-mac --project nexus --config prd --plain --max-age 0 > /tmp/newtok
# Update the ONLY on-box secret, then bring the stack up with new secrets:
#   (edit services/local-os/.env -> DOPPLER_TOKEN=<new>, then:)
cd ~/Dev/nexus && bash services/local-os/startup.sh     # reconciles + restarts containers
# Revoke the old token in Doppler → Access → Service Tokens once the box is healthy.
```
Then **restart the gateways** so they re-pull the rotated bearers/keys:
```bash
docker compose -f services/local-os/docker-compose.yaml restart claude-gateway codex-gateway cron-runner nexus-app
```
Verify: `docker compose -f services/local-os/docker-compose.yaml ps` all `Up`, and the dashboard still loads behind Clerk.

---

## Task 2 — Separate macOS user + sign personal iCloud out — 🧑 (🤖 templates)

**The risk, restated:** everything runs as `dylan_mini` (admin, in the `admin` group) with your personal iCloud (`nguydylan@icloud.com`) signed in. `claudecodeui` runs **on the host** as this user and is publicly tunneled. A claudecodeui auth-bypass or a `nexus-sandbox` (`privileged:true`) escape lands *as you* — inheriting iCloud Keychain, Drive, Photos, Messages, Find My, Apple Pay.

**The fix:** run all public-facing services under a dedicated **standard (non-admin)** user with no personal iCloud. This is operator work end-to-end (`sudo`, GUI, per-user OrbStack, iCloud), but I can hand you parameterized copies of every launch artifact so the move is mechanical.

### What I can stage (🤖, on your go-ahead)
- `com.nexus.local-os.plist` + `com.workforce.claudecodeui.plist` rewritten for a `nexus-host` home (`/Users/nexus-host/...`).
- A `services/local-os/migrate-to-host-user.sh` checklist-script that clones the repo, copies `.env`, installs the LaunchAgents, and brings the stack up under the new user.

### What you must do (🧑)
1. **Create a standard user** (System Settings → Users & Groups → Add User → *Standard*, not Administrator). Name it `nexus-host`. Give it a strong password. Do **not** sign any Apple ID / iCloud into it.
2. **Enable fast user switching** so the host user stays logged in headless (so LaunchAgents + OrbStack run): System Settings → Control Center → Fast User Switching → show. Log into `nexus-host` once via switch-user and leave it logged in (the Mac mini is always-on).
   - ⚠️ GUI LaunchAgents only run while that user has an active login session. Log into `nexus-host` and keep the session (don't log out — locking the screen is fine).
3. **Install OrbStack for that user** (OrbStack's VM + named volumes are per-user) — open OrbStack once while logged in as `nexus-host`, enable *Start at login*.
4. **Move the workloads:** clone `~/Dev/nexus` + `~/Dev/claudecodeui` into `/Users/nexus-host/Dev/`, copy `services/local-os/.env` (the `DOPPLER_TOKEN`), `npm install && npm run build` claudecodeui, then run my staged `migrate-to-host-user.sh`.
5. **Re-register claudecodeui's single login** under the new user (its `~/.cloudcli/auth.db` is per-user) with a **long random** password.
6. **Tear down the old host's services:** `launchctl bootout gui/$(id -u)/com.nexus.local-os` and `...com.workforce.claudecodeui` under `dylan_mini`; stop its OrbStack containers. Confirm `code.*` / `nexus.*` now serve from `nexus-host`.
7. **Sign personal iCloud out** of `dylan_mini` *or* (cleaner) just never run public services there again. The invariant: **no account that runs public services has your personal iCloud.**

> Don't skip the "standard, not admin" part — it's the half of the fix that bounds a host compromise to a throwaway user.

### Recommended dual-user architecture (keep `dylan_mini` for personal use)

You want `dylan_mini` (admin, iCloud) to stay usable for personal projects. That is **safe** — the audit's risk was the *combination* of (iCloud + admin + running the public services) on one account. You break it by moving the services, not by giving up iCloud:

| Account | Role | iCloud | Admin | Runs public services |
|---------|------|--------|-------|----------------------|
| `dylan_mini` (501) | your personal projects/tests | ✅ keep | ✅ keep | ❌ **no** (after teardown) |
| `nexus-host` (502) | all public Nexus services | ❌ none | ❌ standard | ✅ yes (its own OrbStack) |

Why this is safe: every internet-reachable RCE surface (gateways, host claudecodeui, the `privileged` sandbox) now runs under `nexus-host`'s OrbStack. A container→VM→macOS escape lands as `nexus-host` — non-admin, no iCloud — so it can't reach `dylan_mini`'s Keychain/Drive/Photos or get macOS admin. Both users stay logged in simultaneously via fast user switching (nexus-host already is). Keep `nexus-host` non-admin so it can't `sudo`. (P2 — de-privileging the sandbox — closes even the contained-escape case.)

> Reboot note: OrbStack is per-user and tied to a GUI login session, so after a (rare) reboot, switch to `nexus-host` once to restart its stack. Optional: enable auto-login for `nexus-host` if you want it fully hands-off.

### How to run it — staged scripts (steps 3–6 collapsed)

I can't execute 3–6 myself (no passwordless sudo + the work must run as `nexus-host`), so it's two scripts:

1. **Operator, from a `dylan_mini` admin Terminal** — copy the working dirs + secrets across the `750` home boundary:
   ```bash
   sudo rsync -a --delete /Users/dylan_mini/Dev/nexus/        /Users/nexus-host/Dev/nexus/
   sudo rsync -a --delete /Users/dylan_mini/Dev/claudecodeui/ /Users/nexus-host/Dev/claudecodeui/
   sudo chown -R nexus-host:staff /Users/nexus-host/Dev
   ```
2. **Operator, switch to the `nexus-host` session → Terminal** — one command does steps 3–6 (OrbStack, build+up, LaunchAgents, claudecodeui, verify):
   ```bash
   bash /Users/nexus-host/Dev/nexus/services/local-os/bootstrap-nexus-host.sh
   ```
   It prompts for the one interactive bit (register the claudecodeui login with a long random password) and flags if `nexus-host` still needs node + the `claude` CLI.
3. **Verify** the public hostnames serve from the new host, then **I run the teardown myself** (it's a `dylan_mini` shell, no sudo needed):
   ```bash
   bash services/local-os/teardown-dylan-services.sh   # I can execute this for you
   ```
   It guards on the public site answering first, unloads + disables `dylan_mini`'s LaunchAgents, and `compose down`s — leaving `dylan_mini` a clean personal account.

---

## Task 3 — Cloudflare Access in front of `code.*` — 🧑

**Why not just delete the ingress?** Because you manage Nexus (and `/code`) **from your phone while travelling** — dropping `code.coolifycloudtunnel.uk` would break that. So the fix is to keep the hostname but put a **network-layer auth gate** in front of it, independent of claudecodeui's own login. A leaked app password then isn't enough.

### Option A (recommended) — Cloudflare Access (Zero Trust) — 🧑
1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → *Add a self-hosted application*.
2. Application domain: `code.coolifycloudtunnel.uk`. (Repeat for `claude-gw.*`, `codex-gw.*`, `n8n.*` — all shell-capable.)
3. Policy: **Allow** → include rule **Emails** = `nguyendtrade@gmail.com` (your own), action *Allow*, with **One-time PIN** or Google login.
4. Session duration: pick what suits phone use (e.g. 24h).
5. Save. Now hitting `code.*` shows a Cloudflare login *before* claudecodeui — defense in depth, no app changes, no config.yml edit.

This is **purely dashboard** — nothing in the repo changes, so there's no autonomous part for me here. It's also the single highest-leverage P0 because it closes the shortest internet→iCloud path immediately, before Task 2 even lands.

### Option B (alternative) — Tailscale, drop the public ingress — 🧑 + 🤖
If you'd rather not expose `code.*` publicly at all: install Tailscale on the Mac + your phone, reach claudecodeui at `http://<tailscale-ip>:3010`, and I'll stage the one-line edit removing the `code.*` block from `services/local-os/cloudflared/config.yml` (you restart cloudflared to apply). Only choose this if you're comfortable the phone always has Tailscale up.

---

## ★ Optional but recommended — scrub the local audit transcript — 🤖

The workflow subagents printed `CODEX_AUTH_JSON` (and enumerated other env values) into local transcript files. On your go-ahead I'll **locate and redact** the secret values in:
- `/private/tmp/claude-501/.../tasks/wmvbgdpq4.output`
- the workflow subagent `.jsonl` logs under `~/.claude/projects/.../subagents/workflows/`

I'll replace the matched secret values with `[REDACTED]` in place (not delete the files), and report which files were touched. Do this **after** Task 1 rotation so even the pre-scrub copies are worthless. (Deleting files is a destructive op, so I'll only run this once you confirm.)

---

## Final verification (run after all three)

```bash
# Stack healthy under the (new) host user:
docker compose -f services/local-os/docker-compose.yaml ps          # all Up
# Gateways picked up rotated bearers (should still serve to YOU, 401 to a bad bearer):
curl -sS -o /dev/null -w '%{http_code}\n' https://claude-gw.coolifycloudtunnel.uk/health
# code.* now sits behind Cloudflare Access (expect the Access login page, not claudecodeui):
curl -sS -I https://code.coolifycloudtunnel.uk | head -5
# Old Doppler service token revoked; new one in services/local-os/.env only.
# Personal iCloud no longer signed into any account running public services.
```

**Done when:** every P0 row in the at-a-glance table is checked, the two encryption keys were left intact (1b), `code.*`/gateways require a network-layer gate, and your personal iCloud is off the hosting account.

---

## What I'll do next on your word

- 🤖 **"stage task 1 script"** → I read your real prd key names + write `scripts/rotate-self-minted-secrets.sh` (excluding the encryption keys) on a branch.
- 🤖 **"stage task 2 templates"** → I write the `nexus-host` plists + `migrate-to-host-user.sh`.
- 🤖 **"scrub transcripts"** → I redact the printed secrets from the local audit logs.
- 🤖 **"option B"** → I stage the cloudflared `code.*` ingress removal for the Tailscale path.

Everything else in this guide is yours (dashboards, `sudo`, iCloud, interactive logins) — I've made each step copy-paste ready.
