# n8n migration — Hostinger KVM1 → Coolify KVM4

**Why now:** the Hostinger KVM1 VPS expires **2026-05-22**. Every n8n workflow, credential, and execution lives in the SQLite database inside that container. If we let the VPS lapse without migrating, every workflow stops AND we lose the credential set encrypted under the container's `N8N_ENCRYPTION_KEY`.

**Target:** the new `services/n8n/` Coolify resource on KVM4, fronted by Cloudflare Tunnel at `n8n.coolifycloudtunnel.uk`. Same SQLite backing store, same encryption key, same workflows.

**Estimated wall-clock time:** 30–45 minutes if you have SSH to KVM1 and Coolify access. Test workflows resume working at step 6.

---

## Pre-flight — collect what you need

Before touching anything, copy these to a local scratchpad. Some of them you can only get from the running KVM1 container, and that container is going away.

| What | Where | Sensitive? |
|---|---|---|
| KVM1 SSH access | Hostinger panel → KVM1 → SSH credentials | Yes |
| Old `N8N_ENCRYPTION_KEY` | `docker exec <n8n-container> printenv N8N_ENCRYPTION_KEY` OR the `.env` file you wired up | **Critical** — without this, credentials in workflows are unrecoverable on the new instance |
| Old `N8N_BASIC_AUTH_USER` / `N8N_BASIC_AUTH_PASSWORD` | Same | Yes |
| Old webhook URL (if anything outside Nexus calls n8n) | n8n UI → settings → public webhook URL | Useful for the cutover |
| Coolify KVM4 API token | Coolify → Security → API tokens | Yes |
| Doppler config name (`dev` or `prd`) | Whichever the rest of your stack uses | No |

If you don't have the old encryption key, **stop here**. Restoring the SQLite file without the matching key produces a working n8n with unreadable credentials — you'd have to delete every credential and re-paste secrets, which for OAuth nodes means re-running the OAuth flow per connection.

---

## Step 1 — Pin the old n8n container's data while it's still alive

SSH into KVM1, find the container, copy its data dir to the host, tar it up, scp it locally.

```bash
ssh root@<kvm1-ip>

# Find the n8n container — usually called `n8n` or `n8n_n8n_1` depending on
# how it was set up.
docker ps --filter name=n8n --format '{{.ID}}\t{{.Names}}\t{{.Status}}'

# Capture the env vars BEFORE you stop the container.
docker exec <container-id> printenv | grep -E '^N8N_|^DB_|^WEBHOOK_' \
  > /root/n8n-env-backup-$(date +%Y%m%d).env

# Stop the container — pending executions WILL be lost, so check the n8n UI
# Executions tab first; cancel anything running.
docker stop <container-id>

# Tar up the volume. Default n8n compose uses a named volume — find it via
# `docker volume ls | grep n8n`.
VOLUME=$(docker inspect <container-id> --format '{{range .Mounts}}{{.Name}}{{end}}' | head -1)
docker run --rm \
  -v "$VOLUME":/source \
  -v "$PWD":/backup \
  alpine \
  tar czf /backup/n8n-data-$(date +%Y%m%d).tar.gz -C /source .

ls -lh n8n-data-*.tar.gz   # sanity-check size (usually 10MB–1GB depending on history)
exit

# From your local machine. Single-quote the remote path so zsh doesn't try
# to glob-expand it locally — without the quotes you'd see
# `zsh: no matches found: ...`, because zsh refuses to pass an unmatched
# glob through to the receiving command (bash would). Quoting is also
# correct in bash, so the same line works in either shell.
scp 'root@<kvm1-ip>:/root/n8n-data-*.tar.gz'       /tmp/
scp 'root@<kvm1-ip>:/root/n8n-env-backup-*.env'    /tmp/
```

### If your laptop can't SSH to KVM1

If you only have Hostinger Browser Terminal access (no SSH key set up on
KVM1, password disabled / unknown), neither `scp` nor SFTP will work — and
**Hostinger has no dashboard file-download feature for VPS** (their "Backups"
are restore-only and stay on Hostinger's infrastructure). Two fallbacks:

**Small tarball (≤ a few MB) — base64 paste-through.** Works without any
SSH access at all:

```bash
# In Hostinger Browser Terminal on KVM1:
base64 -w0 /root/n8n-data-$(date +%Y%m%d).tar.gz
# Select all the output, copy.

cat /root/n8n-env-backup-*.env
# Plain text — just copy.
```

```bash
# On your Mac, paste the base64 blob:
pbpaste | base64 -d > /tmp/n8n-data-$(date +%Y%m%d).tar.gz
tar tzf /tmp/n8n-data-*.tar.gz | head -5    # sanity check

# And the env file:
pbpaste > /tmp/n8n-env-backup-$(date +%Y%m%d).env
grep N8N_ENCRYPTION_KEY /tmp/n8n-env-backup-*.env
```

**Larger tarball — one-shot HTTPS upload.** Works as long as KVM1 has
outbound HTTPS:

```bash
# In Browser Terminal — returns a single-use download URL.
curl -F "file=@/root/n8n-data-$(date +%Y%m%d).tar.gz" https://file.io
# Open the URL in your Mac browser; downloads to ~/Downloads.
```

`file.io` URLs are single-use and expire on first download — safe for
ephemeral secrets. `transfer.sh` is an alternative but has been flaky in
2025-26.

After the urgent bytes are local, set up real SSH access before continuing
the runbook (you'll need it for step 7 verification and rollback):

```bash
# In the Browser Terminal:
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo 'ssh-ed25519 AAAA... your laptop public key ...' >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

Your laptop's public key is at `~/.ssh/id_ed25519.pub` (or `id_rsa.pub`).
If you don't have one, generate it with `ssh-keygen -t ed25519`.

---

You now have an offline copy. **Do NOT delete the KVM1 container or VPS yet** — you may need to rerun this if the import has issues.

---

## Step 2 — Stash secrets into Doppler

Open the env-backup file and seed the values into Doppler so the new container can read them at boot.

**Reserved-name aliases.** Doppler / Coolify reserve a handful of variable
names (`TZ`, `WEBHOOK_URL`, etc.) and refuse to let you set them. The
compose file works around this by reading from `N8N_`-prefixed Doppler
keys and mapping them to the container env names n8n actually expects
(see `services/n8n/docker-compose.yaml`). So you'll see two columns
below: **Doppler key** is what you `doppler secrets set`; **container
env** is what n8n reads at runtime (don't touch — set by the compose).

```bash
# Critical — without this, every credential in every workflow is
# unreadable on the new instance. Extract from /home/node/.n8n/config:
#   docker exec <old-n8n> cat /home/node/.n8n/config   →   .encryptionKey
doppler secrets set N8N_ENCRYPTION_KEY="<value from /home/node/.n8n/config>"

# Webhook URL — Doppler key is N8N_WEBHOOK_URL (bare WEBHOOK_URL reserved).
# n8n reads this as `WEBHOOK_URL` via the compose alias.
doppler secrets set N8N_WEBHOOK_URL="https://n8n.coolifycloudtunnel.uk/"

# Timezone — Doppler key is N8N_TZ (bare TZ reserved). n8n reads both
# TZ and GENERIC_TIMEZONE via the compose alias.
doppler secrets set N8N_TZ="UTC"

# Preserve KVM1 runtime flags (defaults in compose are sensible, but
# matching the source instance avoids surprises):
doppler secrets set N8N_WEBHOOK_SECRET="<value from env backup>"
doppler secrets set N8N_PROXY_HOPS="<value from env backup, usually 1>"
doppler secrets set N8N_RUNNERS_ENABLED="<value from env backup, usually true>"
doppler secrets set N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS="<value from env backup>"
doppler secrets set N8N_RELEASE_TYPE="<value from env backup, usually stable>"

# Hostname (matches Cloudflare Tunnel route):
doppler secrets set N8N_HOST="n8n.coolifycloudtunnel.uk"

# Basic auth — OPTIONAL. Leave unset to skip auth (UI is gated by
# Cloudflare Tunnel zero-trust). To enable:
#   doppler secrets set N8N_BASIC_AUTH_ACTIVE="true"
#   doppler secrets set N8N_BASIC_AUTH_USER="admin"
#   doppler secrets set N8N_BASIC_AUTH_PASSWORD="$(openssl rand -base64 24)"
```

Verify:

```bash
doppler secrets get N8N_ENCRYPTION_KEY --plain | head -c 8     # first 8 chars only, confirms it's set
doppler secrets get N8N_TZ N8N_WEBHOOK_URL --plain             # quick sanity check on the renamed pair
```

---

## Step 3 — Deploy n8n on Coolify (KVM4)

The `services/n8n/docker-compose.yaml` we just shipped is the Coolify resource template. The existing `migrate-to-lean-kvm.mjs` script knows how to pick up a new `services/<name>/docker-compose.{yml,yaml}` and create a Coolify Compose application.

```bash
# Dry-run first — confirms it sees the new service and won't clobber others.
doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run | grep -E 'n8n|Plan:'

# Apply — creates the Coolify app, sets the env vars from Doppler, deploys.
doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply
```

If the migration script doesn't pick up `services/n8n/` because of any filter, the manual path:

1. Coolify → KVM4 → New Resource → Docker Compose
2. Source: GitHub repo `pinnacleadvisors/nexus`, branch `main`, base directory `services/n8n`
3. Env vars: paste in the N8N_* values (or attach the Doppler integration)
4. Click Deploy. Wait for `healthcheck: passing`. Coolify reports "Running" once `/healthz` returns 200 — first boot includes a SQLite migration step that takes ~30s.

**Stop the new container after the first boot succeeds.** The next step restores the OLD database over the fresh empty one — if the container is running it'll have file locks open and the restore will silently corrupt.

Coolify → Resource → Stop.

---

## Step 4 — Restore the old SQLite + workflow data

Coolify creates the volume during the first deploy. Find it on the KVM4 host and untar the backup into it.

```bash
ssh root@<kvm4-ip>

# Find the volume — Coolify suffixes its name with the resource UUID.
docker volume ls | grep n8n_data

# Untar the KVM1 backup into the volume's mountpoint. Substitute the path.
VOLUME_NAME=$(docker volume ls --format '{{.Name}}' | grep n8n_data | head -1)
docker run --rm \
  -v "$VOLUME_NAME":/dest \
  -v /tmp:/backup \
  alpine \
  sh -c "cd /dest && tar xzf /backup/n8n-data-*.tar.gz"

# Sanity check — database.sqlite should be present and recent.
docker run --rm \
  -v "$VOLUME_NAME":/data \
  alpine \
  ls -lah /data | head -10
```

You should see `database.sqlite`, `.cache`, `binaryData/` (if your workflows store binary outputs), and `nodes/` (if you've installed community nodes).

---

## Step 5 — Restart the container and probe

Coolify → Resource → Start. The container picks up the restored volume.

```bash
# Verify it boots — n8n logs migration steps loudly on startup if SQLite
# schema needs an update. A clean boot ends with "n8n ready on 0.0.0.0:5678".
docker logs -f $(docker ps --filter name=n8n -q | head -1)

# Probe the health endpoint from inside the docker network.
docker exec <cloudflared-container> wget -qO- http://n8n:5678/healthz
# Expected: {"status":"ok"}
```

---

## Step 6 — Point Cloudflare Tunnel at the new container

If you weren't already routing `n8n.coolifycloudtunnel.uk` to anything, add it to the cloudflared config on KVM4:

```yaml
# /etc/cloudflared/config.yml on the KVM4 host (or in the cloudflared Docker
# container's mounted config volume). Append an ingress entry:
ingress:
  - hostname: n8n.coolifycloudtunnel.uk
    service: http://n8n:5678
  # ... existing rules ...
  - service: http_status:404
```

Reload cloudflared. Then in Cloudflare dashboard, add a DNS record:
- `n8n.coolifycloudtunnel.uk` → CNAME → `<tunnel-id>.cfargotunnel.com`

If the n8n UI was previously on a different hostname (`n8n.dylannguyen.com` for example), keep that name AND `n8n.coolifycloudtunnel.uk` both pointing at the new container during the cutover so external webhooks (Stripe, etc.) keep landing while you migrate them.

---

## Step 7 — Verify in the n8n UI

Open `https://n8n.coolifycloudtunnel.uk`. Sign in with the same basic-auth credentials from the old container.

Run through this checklist:

- [ ] Workflows tab lists every workflow that existed on KVM1
- [ ] Open a workflow that uses an OAuth credential → execute manually → it doesn't 401 (proves the encryption key matches)
- [ ] Open the Credentials tab → no credentials show as "broken" or "unreadable"
- [ ] Executions tab shows historical executions from KVM1
- [ ] Webhook test: pick a workflow with a webhook trigger, send a test request to its public URL via curl

If any credentials appear as "unable to decrypt", **your encryption key doesn't match**. Stop, delete the new container's volume, re-export the key from KVM1, redo step 2.

---

## Step 8 — Decommission KVM1

Only after step 7 passes for every critical workflow:

1. Wait at least 24 hours so any cron-triggered workflows have a chance to fire and confirm they hit the new container.
2. Cancel the Hostinger KVM1 renewal (or let it lapse 2026-05-22).
3. Keep the offline tarball backup for ≥30 days in case something subtle breaks.

---

## Rollback (if step 7 fails badly)

The KVM1 container is still alive (you stopped it but didn't delete it). Restart it:

```bash
ssh root@<kvm1-ip>
docker start <old-container-id>
# Point n8n.coolifycloudtunnel.uk's CNAME back at KVM1's IP via Cloudflare
```

The new KVM4 container can stay in place — it's harmless when external traffic isn't routed at it. Investigate offline, then redo from step 4 with a corrected backup or env.

---

## Why this runbook, not a script

A scripted migration would need SSH credentials for two hosts, would be a one-shot, and would either succeed entirely or leave you in an uncertain state. A runbook keeps the operator in the loop at the high-stakes moments (encryption key, restore, cutover). Each step is small enough to verify before continuing. If a step fails, the next step has a clear "stop here" instruction.

When this migration is done, fold the `services/n8n/docker-compose.yaml` template into the regular Coolify-managed deployment flow — future redeploys go through `scripts/deploy.sh` like any other service.
