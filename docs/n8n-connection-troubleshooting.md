# Fixing the n8n connection failure

The Nexus app cannot reach the self-hosted n8n instance at
`https://srv1610898.hstgr.cloud:5678`. The browser sees:

```
n8n unreachable at https://srv1610898.hstgr.cloud:5678 — fetch failed
```

This guide walks the most likely causes in priority order, based on the
diagnostics collected from the Hostinger VPS.

---

## TL;DR — most likely cause

`N8N_BASE_URL` in Doppler is wrong. It is set to
`https://srv1610898.hstgr.cloud:5678`, but n8n is **not** exposed on port 5678
externally. The container binds to `127.0.0.1:5678` (loopback only) and is
fronted by Traefik on the public domain `n8n.srv1610898.hstgr.cloud` (port 443).

**Fix:**

```bash
doppler secrets set N8N_BASE_URL=https://n8n.srv1610898.hstgr.cloud
```

Then redeploy (Vercel auto-deploys on Doppler push) and reload the
`/tools/n8n` page. The "Load from n8n" button should return the workflow list.

The rest of this guide is for cases where the URL fix alone does not work.

---

## Diagnostics summary

From the VPS:

```text
$ docker ps
CONTAINER ID   IMAGE                       STATUS                          PORTS
4b36da0ce274   traefik:latest              Restarting (1) 19 seconds ago   —
2d9856428861   traefik                     Up 2 days                       0.0.0.0:80->80, 0.0.0.0:443->443
531b98564698   docker.n8n.io/n8nio/n8n     Up 2 days                       127.0.0.1:5678->5678/tcp
```

```text
$ docker exec n8n-n8n-1 env | grep WEBHOOK_URL
WEBHOOK_URL=https://n8n.srv1610898.hstgr.cloud/
```

Three things stand out:

1. **n8n binds to `127.0.0.1:5678`** — only the VPS itself can reach 5678.
   External clients must go through Traefik on 443 with the `n8n.*` subdomain.
2. **`WEBHOOK_URL` is `https://n8n.srv1610898.hstgr.cloud/`** — n8n's own
   self-reference matches the Traefik route, confirming this is the correct
   public URL.
3. **A second Traefik container is crash-looping** (`traefik-bzuc-traefik-1`,
   restarting every ~20s). It likely conflicts with the working
   `n8n-traefik-1` for ports 80/443 or for the Docker socket. Even if it never
   binds the ports, the noise in logs makes diagnosis harder.

---

## Step 1 — Point Nexus at the right URL

Update the env vars in Doppler (production config used by Vercel):

| Variable        | Value                                       |
|-----------------|---------------------------------------------|
| `N8N_BASE_URL`  | `https://n8n.srv1610898.hstgr.cloud`        |
| `N8N_API_KEY`   | (existing key from n8n → Settings → API)    |

Notes:

- No port suffix. Traefik terminates TLS on 443.
- `lib/n8n/client.ts` automatically strips a trailing `/api` or `/api/v1` if
  pasted by mistake, and prefixes `https://` if you forget the protocol.
- After the change, hit `GET /api/n8n/workflows` from the browser — the
  response now uses HTTP 200 with an `error` field on failure (commit
  `ee0eff3`), so the warning shows in the yellow banner instead of as a
  console 5xx.

Verify from your laptop, **not** from the VPS:

```bash
curl -i -H "X-N8N-API-KEY: $N8N_API_KEY" \
  https://n8n.srv1610898.hstgr.cloud/api/v1/workflows
```

A `200 OK` with a JSON body confirms the public route works. A `401` means
the URL is reachable but the API key is wrong. A timeout/connection-refused
means a deeper issue — continue below.

---

## Step 2 — Confirm the n8n public API is enabled

n8n's REST API is opt-in. In `/home/<user>/.n8n/config` (or the docker-compose
env block) make sure the API is on and the key is set:

```bash
docker exec n8n-n8n-1 env | grep -E 'N8N_API|N8N_PUBLIC_API'
```

You want to see:

```
N8N_PUBLIC_API_DISABLED=false        # or unset
N8N_API_KEY_AUTH_ACTIVE=true         # n8n ≥ 1.x
```

If the API is disabled, set `N8N_PUBLIC_API_DISABLED=false`, regenerate the
API key in the n8n UI (Settings → n8n API → Create), update the new key in
Doppler, and restart the container:

```bash
docker restart n8n-n8n-1
```

---

## Step 3 — Clean up the crashing Traefik container

The duplicate `traefik-bzuc-traefik-1` container is restarting on a loop.
Either it is part of an old/abandoned stack or it is the `bzuc` one-click
template Hostinger ships. It cannot bind 80/443 because `n8n-traefik-1`
already owns them, hence the crash loop.

Check what it is:

```bash
docker inspect traefik-bzuc-traefik-1 --format '{{.Config.Labels}}' | tr ',' '\n'
docker logs --tail 30 traefik-bzuc-traefik-1
```

If it is unused, remove the whole stack so it stops thrashing:

```bash
# find the compose project it belongs to
docker inspect traefik-bzuc-traefik-1 \
  --format '{{ index .Config.Labels "com.docker.compose.project.working_dir" }}'

# then from that directory
docker compose down --remove-orphans
```

A flapping Traefik is unlikely to cause the n8n 502 directly (the working
Traefik is healthy), but eliminating the noise makes future debugging easier
and frees CPU.

---

## Step 4 — Hostinger firewall (hPanel)

Hostinger's per-VPS firewall blocks unsolicited inbound by default.

- Open **hPanel → VPS → your server → Firewall**.
- Confirm **80/TCP** and **443/TCP** are `Accept` from `Any` source. They
  almost certainly are, because the Nexus sign-in page loads.
- Do **not** open `5678/TCP` — n8n is intentionally bound to loopback.
  Exposing 5678 would let the world bypass Traefik's TLS.
- If you want to lock things down further, restrict 443 to Vercel's egress
  IP range (Vercel publishes them at
  <https://vercel.com/docs/edge-network/regions>), but that is an
  optimisation, not a fix.

---

## Step 5 — Cloudflare DDoS / hot-fingerprint blocks

Hostinger applies aggressive DDoS heuristics that sometimes flag rapid API
calls as suspicious. Symptoms: works for a few minutes, then `fetch failed`
for 5–15 minutes, then works again.

Mitigations, in order of cost:

1. **Add Cloudflare in front of `n8n.srv1610898.hstgr.cloud`** (free tier).
   Set the DNS record to `Proxied` (orange cloud). Cloudflare presents
   traffic with its own ASN, which Hostinger trusts more than raw Vercel
   egress.
2. Throttle Nexus's polling: the new `N8N_TIMEOUT_MS` env var (default 8s)
   limits each individual call; you can also bump
   `RATE_LIMIT_N8N_LIST_PER_MIN` if you've added one. The current code only
   calls n8n on explicit user action ("Load from n8n", workflow generate),
   so this is rarely the culprit.
3. **Whitelist Vercel egress** in the Hostinger firewall as a positive rule
   so DDoS heuristics see them as known-good.

---

## Step 6 — Reverse proxy header check

If Traefik is mis-routed, you'd see a 502 with an HTML body from Traefik
itself (look for the `traefik` server header). Quick test from any laptop:

```bash
curl -i https://n8n.srv1610898.hstgr.cloud/healthz
```

Expected:

```
HTTP/2 200
server: ...
{"status":"ok"}
```

If you get `404 page not found` from Traefik, the `n8n` router rule is
missing or the labels on the n8n container are wrong. Check
`/srv/n8n/docker-compose.yml` for labels of the form:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.n8n.rule=Host(`n8n.srv1610898.hstgr.cloud`)"
  - "traefik.http.routers.n8n.entrypoints=websecure"
  - "traefik.http.routers.n8n.tls.certresolver=letsencrypt"
  - "traefik.http.services.n8n.loadbalancer.server.port=5678"
```

If the labels are correct, restart the stack:

```bash
docker compose -f /srv/n8n/docker-compose.yml up -d --force-recreate n8n
```

---

## Verification checklist

After each change, re-test in this order — stop at the first one that fails:

1. **From the VPS**: `curl -sf http://127.0.0.1:5678/healthz` → `200`
2. **From the VPS**: `curl -sfI https://n8n.srv1610898.hstgr.cloud/healthz` →
   `200`
3. **From your laptop**: same URL → `200`
4. **From your laptop**:
   `curl -i -H "X-N8N-API-KEY: $KEY" https://n8n.srv1610898.hstgr.cloud/api/v1/workflows`
   → `200` with JSON
5. **From the Nexus app**: open `/tools/n8n` → click "Load from n8n" →
   workflows appear, no warning banner

If step 1 fails, the n8n container itself is unhealthy. If step 2 fails,
Traefik routing is wrong. If step 3 fails, Hostinger firewall or DNS is
wrong. If step 4 fails, the API key or `N8N_PUBLIC_API_DISABLED` is wrong.
If only step 5 fails, the issue is in Doppler or the Vercel deployment, not
n8n.

---

## Related code

- `lib/n8n/client.ts` — REST client, URL normalisation, 8s timeout.
- `app/api/n8n/workflows/route.ts` — GET endpoint, returns 200 with `error`
  field on unreachable so the browser console stays clean.
- `app/(protected)/tools/n8n/page.tsx` — "Load from n8n" button and warning
  banner.
- `memory/platform/SECRETS.md` — canonical list of n8n env vars.
