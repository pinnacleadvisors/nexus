# paperclip — the `/workforce` engine

Reproducible launch artifacts for [Paperclip](https://www.npmjs.com/package/paperclipai)
running on the Mac mini as the autonomous-workforce engine. Nexus surfaces it at
`/workforce`. Full cutover procedure + rationale:
[`docs/runbooks/paperclip-cutover.md`](../../../docs/runbooks/paperclip-cutover.md)
(P0 user-isolation, per [`docs/runbooks/p0-security-remediation.md`](../../../docs/runbooks/p0-security-remediation.md)).

## What runs where

- **App**: `npx paperclipai@latest run -d ~/Dev/workforce-lab/paperclip-data`, served on
  `127.0.0.1:3100` (loopback). Self-fetched via `npx` — no clone/build step.
- **Persistence of state**: everything (embedded Postgres DB + config + companies/agents/
  skills + any provider keys) lives inside the single `paperclip-data/` dir. Migrating the
  engine = a quiesced directory copy of that dir, NOT a `pg_dump`/restore.
- **Process persistence**: launchd agent `com.workforce.paperclip` (KeepAlive + RunAtLoad)
  → runs [`run-paperclip.sh`](run-paperclip.sh). Survives reboot + restarts on crash.
- **Nexus side**: the owner-only `/workforce` proxy
  ([`app/api/workforce/[...path]/route.ts`](../../../app/api/workforce/[...path]/route.ts)
  + `ui/[[...path]]`) calls `PAPERCLIP_API_BASE` (default `http://host.docker.internal:3100`).
  From inside the OrbStack container that resolves to the host loopback, so **no Nexus env
  change** is needed once paperclip binds `:3100`. When paperclip is down the proxy returns
  `200 {ok:false}` and `/workforce` shows a soft "not reachable" card (no retry storm).

## Files here (machine-local copies, committed for reproducibility)

| File | Lives at runtime |
|------|------------------|
| `run-paperclip.sh` | `~/Dev/workforce-lab/run-paperclip.sh` |
| `com.workforce.paperclip.plist` | `~/Library/LaunchAgents/com.workforce.paperclip.plist` |

`run-paperclip.sh` is `$HOME`-relative and resolves `node` dynamically (do NOT hardcode a
node version — that crash-looped the claudecodeui agent across accounts). The plist carries
`/Users/dylan_mini` placeholder paths (same convention as `../com.nexus.local-os.plist`);
rewrite them per-account with `sed 's#/Users/dylan_mini#$HOME#g'`.

## Install under an account (e.g. nexus-host)

```bash
# 1. State must already be present (rsync'd from the previous host while paperclip was STOPPED):
#    ~/Dev/workforce-lab/paperclip-data/   (carries the embedded-PG DB + config + keys)

# 2. Launch artifacts
cp services/local-os/paperclip/run-paperclip.sh ~/Dev/workforce-lab/run-paperclip.sh
chmod +x ~/Dev/workforce-lab/run-paperclip.sh
sed 's#/Users/dylan_mini#'"$HOME"'#g' \
  services/local-os/paperclip/com.workforce.paperclip.plist \
  > ~/Library/LaunchAgents/com.workforce.paperclip.plist

# 3. Load it (RunAtLoad + KeepAlive → binds :3100, survives reboot/crash)
GUI="gui/$(id -u)"
launchctl bootout   "$GUI/com.workforce.paperclip" 2>/dev/null || true
launchctl bootstrap "$GUI" ~/Library/LaunchAgents/com.workforce.paperclip.plist
```

## Verify

```bash
lsof -nP -iTCP:3100 -sTCP:LISTEN                                   # owned by this account
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health   # 200
npm run test:e2e:authed -- code-page.spec.ts                      # (and open /workforce — card gone, data populates)
```

## Restart / rollback

```bash
launchctl kickstart -k gui/$(id -u)/com.workforce.paperclip        # clean restart
# Rollback to the previous host: stop here, then on the old account:
#   cd ~/Dev/workforce-lab && npx paperclipai@latest run -d ./paperclip-data
```
