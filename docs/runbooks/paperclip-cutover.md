# Paperclip cutover — move `:3100` off `dylan_mini` onto `nexus-host`

Final step of the P0 user-isolation migration ([`p0-security-remediation.md`](p0-security-remediation.md)):
the web stack + `/code` already run under the dedicated non-admin `nexus-host` account;
**Paperclip (the `/workforce` engine) is the last service still under the iCloud/admin
`dylan_mini` account.** Nexus's `/workforce` proxy reaches it via machine-wide loopback
`host.docker.internal:3100`, which only works while `dylan_mini` is logged in — so this
defeats the isolation goal until Paperclip moves. Mirrors the completed claudecodeui
`:3010` cutover. **Operator-gated; not auto-runnable.**

Launch artifacts: [`services/local-os/paperclip/`](../../services/local-os/paperclip/).

## Why a directory copy, not pg_dump

Paperclip uses **embedded Postgres** (bundled `@embedded-postgres/darwin-arm64`, not system
PG). The entire state — DB + config + companies/agents/skills + any provider keys — lives in
the single `~/Dev/workforce-lab/paperclip-data/` dir. So the migration is a consistency-safe
directory copy (same-arch arm64 Mac→Mac on the same machine), not a logical dump/restore.

**Key difference vs claudecodeui** (which was a stateless prebuilt bundle): Paperclip carries
a LIVE DB, so the copy must be **quiesced — stop Paperclip BEFORE the final rsync** or the
embedded-PG data can tear. Expect a brief planned `:3100` outage during the sync; `/workforce`
degrades to a soft "not reachable" card (proxy returns `200 {ok:false}`, no retry storm).

## Phase A — operator, as `dylan_mini` (admin Terminal, sudo)

`nexus-host` (non-admin) can't read `dylan_mini`'s `0700` home or stop its process.

> **zsh shell note (run this FIRST).** Interactive `zsh` does NOT treat `#` as a comment
> by default, so pasting a block with `# …` lines or trailing `# …` annotations throws
> `command not found: #`, `no matches found: (…)`, `missing delimiter for 'u' glob qualifier`,
> etc. Enable comments for the session before pasting any block below:
> ```zsh
> setopt interactive_comments        # add to ~/.zshrc to make it permanent
> ```

A1 — GATED STOP. On `dylan_mini`, paperclip is a **KeepAlive LaunchAgent**
(`com.workforce.paperclip`, parent PID 1), NOT a foreground `npx` — so Ctrl-C / `kill`
just lets launchd **respawn** it. You must bootout + disable the agent (which SIGTERMs the
process so embedded-PG shuts down cleanly), then confirm down:

```bash
GUI="gui/$(id -u)"
launchctl bootout  "$GUI/com.workforce.paperclip" 2>/dev/null || true
launchctl disable  "$GUI/com.workforce.paperclip" 2>/dev/null || true
sleep 5
lsof -nP -iTCP:3100 -sTCP:LISTEN
ps aux | grep -E 'paperclipai|postgres: paperclip' | grep -v grep
```

Both of the last two commands must print **nothing**. If a `postgres: paperclip` worker
lingers past ~10s, give it another `sleep 5` (graceful shutdown) — only `pkill -TERM -f
'postgres: paperclip'` as a last resort (never SIGKILL embedded-PG — it can tear the DB).

A2 — only AFTER A1 shows empty, copy the quiesced data dir cross-user, then chown:

```bash
sudo rsync -a --delete \
  /Users/dylan_mini/Dev/workforce-lab/paperclip-data/ \
  /Users/nexus-host/Dev/workforce-lab/paperclip-data/
sudo chown -R nexus-host:staff /Users/nexus-host/Dev/workforce-lab
```

> ⚠️ If you ran the rsync while paperclip was STILL up (A1 hadn't actually stopped it), the
> copied embedded-PG data may be torn — **re-run the A2 rsync after A1 shows empty**; the
> `--delete` flag makes the redo overwrite the suspect copy cleanly.

Keep the stopped `dylan_mini` paperclip **recoverable** (do not delete its data, leave the
plist in place) until Phase C is green.

## Phase B — `nexus-host` stands up paperclip (as `nexus-host`)

```bash
# B1. Tooling check — node/npx + the `claude` CLI (paperclip drives it). No install: npx self-fetches.
node -v && npx -v && command -v claude

# B2. Install the launch artifacts (committed in services/local-os/paperclip/).
cp services/local-os/paperclip/run-paperclip.sh ~/Dev/workforce-lab/run-paperclip.sh
chmod +x ~/Dev/workforce-lab/run-paperclip.sh
sed 's#/Users/dylan_mini#'"$HOME"'#g' \
  services/local-os/paperclip/com.workforce.paperclip.plist \
  > ~/Library/LaunchAgents/com.workforce.paperclip.plist

# B3. Load it (RunAtLoad + KeepAlive → binds :3100, survives reboot/crash).
GUI="gui/$(id -u)"
launchctl bootout   "$GUI/com.workforce.paperclip" 2>/dev/null || true
launchctl bootstrap "$GUI" ~/Library/LaunchAgents/com.workforce.paperclip.plist
```

The `run-paperclip.sh` script resolves `node` dynamically — it will NOT crash-loop on a
version-path mismatch the way the first claudecodeui script did (dylan v24.8.0 vs nexus-host
v24.16.0, exit 127).

## Phase C — verify, then permanently release `dylan_mini`

```bash
# C1. nexus-host owns :3100?
lsof -nP -iTCP:3100 -sTCP:LISTEN                                    # pid owned by nexus-host (uid 502)
curl -sf -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/health   # 200
ps aux | grep paperclipai | grep -v grep                           # owner = nexus-host, not dylan_mini

# C2. /workforce green end-to-end: open the Clerk-authed /workforce page — the "not reachable"
#     card is gone, Companies/Agents/heartbeats populate, the Full-Paperclip iframe
#     (/api/workforce/ui/) loads. No PAPERCLIP_API_BASE change needed.
```

When C1 + C2 are green → leave `dylan_mini`'s paperclip permanently stopped. `:3100` is now
owned solely by `nexus-host`. (`lsof` from `dylan_mini` can't see `nexus-host`'s listening
socket without sudo — use the `curl` 200 as proof, same as the :3010 cutover.)

**Rollback** (any time before you delete the old data): on `dylan_mini`,
`cd ~/Dev/workforce-lab && npx paperclipai@latest run -d ./paperclip-data` — `/workforce`
works again with zero Nexus changes.

## Guardrails

- `nexus-host` never stops/teardowns `dylan_mini` — the operator (dylan_mini session) does the
  stop + release; `nexus-host` only receives, launches, verifies.
- No secret VALUES in the `/Users/Shared` coordination files — key NAMES / status only.
- OUT OF SCOPE for `teardown-dylan-services.sh` (paperclip was deliberately left alone there) —
  this is a follow-up of the P0 closeout, not part of the web-stack teardown.

## Post-cutover (AGENTS.md infra-change protocol)

- memory-hq atom (`kind: infra-change`, link `[[mocs/platform-topology]]`):
  "paperclip: dylan_mini (uid 501) → nexus-host (uid 502) :3100 migrated YYYY-MM-DD".
- Add a Topology line under the Mac-mini PRIMARY HOST bullet in [`AGENTS.md`](../../AGENTS.md):
  paperclip now runs under `nexus-host` via `com.workforce.paperclip` on `:3100`.
