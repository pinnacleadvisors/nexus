# Operator Commands — quick reference

Single page covering every script the operator runs by hand. Group by task; show the canonical invocation, what it does, and what success looks like. When in doubt about which command applies, search this file first.

> **Maintenance discipline** — this file is the canonical operator reference. **If you add, rename, or change the interface of any script in `scripts/`, `.claude/skills/*/cli.mjs`, or `package.json#scripts`, update this file in the same PR.** AGENTS.md's Pre-commit Checklist enforces. Stale commands here are worse than no docs — they get pasted into terminals and run as-is.

---

## TL;DR by task

| I want to… | Run |
|---|---|
| Deploy the Next.js platform | `npm run deploy -- --nexus-app` |
| Deploy everything Coolify | `npm run deploy -- --all` |
| Run the deploy picker | `npm run deploy` |
| Migrate Vercel crons → cron-job.org | `doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --apply` |
| Move a Coolify app KVM2 → KVM4 | `doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply` |
| Run a DB migration | `npm run migrate` |
| Regenerate `lib/database.types.ts` after a migration | `npm run types:regen` |
| Diagnose codex-gateway 502 incidents | `npm run diagnose:codex` (add `--probe-dispatch` for a full dispatch test) |
| Repair codex-gateway routing after KVM migration | `npm run repair:codex` (`--apply` to update Doppler + Cloudflare tunnel) |
| Move a Cloudflare hostname between tunnels | `npm run migrate:tunnel -- --hostname=X --to-tunnel=Y --service=Z` (`--apply` to mutate) |
| Write a fact to memory-hq | `doppler run -- node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom "<title>" --fact="..."` |
| Pre-commit safety checks | `npm run check:all` |
| Look up a Doppler secret | `doppler secrets get K --project nexus --config prd --plain` |
| Set a Doppler secret | `echo "<value>" \| doppler secrets set K --project nexus --config prd --no-interactive` |
| Install local git hooks | `bash scripts/install-git-hooks.sh` |

---

## 1. Deploy (Coolify only — lean mode)

The deploy script triggers fresh Coolify deploys via the Coolify API. Vercel is disabled in lean mode ([PR #238](https://github.com/pinnacleadvisors/nexus/pull/238)); re-enable by uncommenting `# [vercel-disabled]` blocks in [`scripts/deploy.sh`](../../scripts/deploy.sh).

```bash
npm run deploy                                # interactive picker
npm run deploy -- --all                       # every Coolify service whose UUID env var is set
npm run deploy -- --nexus-app                 # the Next.js platform on KVM4
npm run deploy -- --nexus-sandbox             # rootless-Podman exec sandbox on KVM4
npm run deploy -- --claude                    # claude-gateway (KVM4)
npm run deploy -- --codex                     # codex-gateway (KVM4 preferred, KVM2 legacy fallback)
npm run deploy -- --qa                        # qa-runner (KVM4)
npm run deploy -- --firecrawl                 # firecrawl (KVM4)
npm run deploy -- --skip-typecheck --nexus-app  # bypass `tsc --noEmit` for rapid iteration
```

**Required env (in Doppler `prd`)**: `COOLIFY_KVM4_URL`, `COOLIFY_KVM4_API_TOKEN`, plus one `COOLIFY_KVM4_*_UUID` per service deployed. See [scripts/deploy.sh](../../scripts/deploy.sh) header for the full list.

**Success looks like**: each section prints `✓ <service> deploy queued (HTTP 201)` and the closing `── done ──` block. Watch the build via Coolify dashboard → resource → Logs.

**On failure**: deploy.sh prints HTTP code + body. 401/403 = bad token, 404 = wrong UUID, 5xx = Coolify instance issue.

---

## 2. Cron jobs — cron-job.org

The platform's scheduler is cron-job.org (free tier + $5 donation). All 10 jobs are declared in [`vercel.json`](../../vercel.json) and pushed by the migration script. See [`cron-migration-to-cronjob-org.md`](cron-migration-to-cronjob-org.md) for the long-form runbook.

```bash
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --dry-run        # preview, no writes
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --apply          # create/skip per title (idempotent)
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --list           # show every job on the account
doppler run -- node scripts/migrate-crons-to-cronjob-org.mjs --delete-nexus   # remove all Nexus-prefixed jobs
```

**Required env (Doppler `prd`)**: `CRONJOB_ORG_API_KEY`, `CRON_SECRET`, `NEXUS_BASE_URL`.

**Rate-limit note** ([PR #237](https://github.com/pinnacleadvisors/nexus/pull/237)): cron-job.org rate-limits PUT/PATCH/DELETE around 1 req/sec per key. The script paces successful writes at 1500ms and retries 429s with 3s/5s/8s backoff — first `--apply` of 10 jobs takes ~20s.

---

## 3. Coolify migrations (KVM2 → KVM4 lean mode)

```bash
doppler run -- node scripts/migrate-to-lean-kvm.mjs --dry-run                 # preview migration plan
doppler run -- node scripts/migrate-to-lean-kvm.mjs --apply                   # create apps + push envs + deploy
```

**Required env (Doppler `prd`)**: `COOLIFY_KVM4_URL`, `COOLIFY_KVM4_API_TOKEN`, `COOLIFY_PROJECT_ID_NEXUS_PLATFORM`. See [`migrate-to-lean-kvm.md`](migrate-to-lean-kvm.md) for the full runbook including pre/post checklists.

---

## 4. Database migrations

Migrations live in `migrations/*.sql` (Supabase). Runner is [`scripts/migrate.mjs`](../../scripts/migrate.mjs).

```bash
npm run migrate                # doppler-wrapped — connects to Supabase via env
npm run migrate:local          # if you already have env set up locally
```

**Pre-flight**: `node scripts/dryrun-044-backfill.mjs` (or similar `dryrun-NNN-*.mjs`) for migrations whose backfill needs validation before running. **Post-flight**: `node scripts/verify-044-applied.mjs` to confirm a specific migration landed.

### Regenerate `lib/database.types.ts` after a migration

The generated Supabase types live at [`lib/database.types.ts`](../../lib/database.types.ts) and are checked into the repo. App code that touches new columns / new tables either uses the untyped `as unknown as` shim pattern (see `lib/cost-guard.ts` / `lib/board/insert-task.ts`) OR depends on regenerated types. Regenerate after every migration that adds tables or columns so TS sees the new shape and the shims can be tightened in follow-up PRs.

```bash
npm run types:regen           # canonical — wraps the supabase CLI safely
npm run types:regen:local     # if you already have SUPABASE_PROJECT_REF in your shell env
```

The wrapper at [`scripts/regenerate-database-types.mjs`](../../scripts/regenerate-database-types.mjs) runs the Supabase CLI with `npx --yes` (so the "Ok to proceed? (y)" install prompt doesn't get captured into the file), writes to a tempfile, validates the output starts with the expected TypeScript header, and atomically moves into place. A bad run leaves `lib/database.types.ts` untouched.

**Pre-requisites**: `SUPABASE_PROJECT_REF` in Doppler — the project slug at `https://supabase.com/dashboard/project/<slug>` (just the slug, not the URL). `npx supabase login` once per machine if you haven't already.

**Success looks like**: the script prints `Wrote /…/lib/database.types.ts — N bytes, M lines.` then `git diff lib/database.types.ts` shows the new tables/columns added (nothing else churns). Re-run `npx tsc --noEmit` — TS errors that depended on the missing types should resolve.

**Common pitfalls**:
- **2026-05-22 incident — npx prompt captured into file**: pre-script, the docs recommended `npx supabase@latest gen … > lib/database.types.ts`. npx wrote `Need to install the following packages: supabase@2.101.0\nOk to proceed? (y)` to stdout, which the shell redirect captured into the file. The new wrapper script's `--yes` + tempfile + header-validation prevents this from recurring. If you ever see the prompt text in your `database.types.ts`, revert the file (`git checkout lib/database.types.ts`) and re-run `npm run types:regen`.
- Running before the migration is applied to the **remote** Supabase project produces an out-of-date file. Confirm `npm run migrate` against prod completed first.
- Generated file uses absolute timestamps — re-run in CI / pre-commit produces noisy diffs. Commit only after a real schema change; otherwise revert.
- If the command 401s, run `npx supabase login` in an interactive shell and retry. The CLI caches credentials per-machine.
- If `SUPABASE_PROJECT_REF` is unset, the script exits with a clear error message instead of producing a broken file.

---

## 5. Memory / knowledge graph (memory-hq)

The cross-project graph lives in `pinnacleadvisors/memory-hq`. Local CLI:

```bash
# Always pass --backend=github (or set MOLECULAR_BACKEND=github) to write to memory-hq
# instead of the dev-only local cache at memory/molecular/.
node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom "<title>" --fact="..." --source=<ref>
node .claude/skills/molecularmemory_local/cli.mjs --backend=github entity person|company|concept|project "<name>"
node .claude/skills/molecularmemory_local/cli.mjs --backend=github moc "<topic>" --atoms=a,b --entities=x,y
node .claude/skills/molecularmemory_local/cli.mjs --backend=github ingest <url> --title="..." --body=/tmp/<slug>.md --moc=<topic>
node .claude/skills/molecularmemory_local/cli.mjs --backend=github synthesis "<title>" --body=/tmp/<answer>.md --question="..." --moc=<topic>

# Maintenance / query / cache
node .claude/skills/molecularmemory_local/cli.mjs query <text>            # slug + frontmatter search
node .claude/skills/molecularmemory_local/cli.mjs lint --write            # health check + auto-fix
node .claude/skills/molecularmemory_local/cli.mjs reindex                 # rebuild INDEX.md
node .claude/skills/molecularmemory_local/cli.mjs graph                   # regenerate .graph.json
node .claude/skills/molecularmemory_local/cli.mjs framework-pull          # sync framework files → ~/.claude/

# Doppler-wrapped (when MEMORY_HQ_TOKEN / NEXUS_BASE_URL aren't in your shell)
doppler run --project nexus --config dev -- node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom "..." --fact="..."
```

**MCP alternative** (inside a Claude Code session): the `memory_atom`, `memory_entity`, `memory_moc`, `memory_query`, `memory_search` tools do the same writes but the MCP server holds the connection. CLI is the fallback when MCP is 503ing or when scripting.

**Backfills / one-offs**:

```bash
node scripts/backfill-memory-hq.mjs              # one-time backfill of legacy molecular notes
node scripts/backfill-memory-hq-subfolders.mjs   # one-time reshape into <kind>/<scope-id>/<slug>.md layout
node scripts/smoke-memory-event.mjs              # smoke test against POST /api/memory/event
node scripts/populate-memory.mjs                 # populate from `populate-memory:local` source (legacy)
```

---

## 6. Pre-commit checks

Run before every commit (and certainly before opening a PR).

```bash
npm run check:all              # lint + tsc + retry-storm + sentry-config + lockfile (one shot)
npm run lint                   # eslint
npx tsc --noEmit               # TypeScript only — fastest single check
npm run check:retry-storm      # blocks the 6 grep-detectable retry-storm patterns
npm run check:sentry-config    # blocks Sentry sample-rate regressions (2026-05-12 budget cap)
npm run check:lockfile         # blocks package.json ↔ package-lock.json drift (PR-274 incident class)
```

Every check exits non-zero on any finding. See [AGENTS.md "Pre-commit Checklist"](../../AGENTS.md) for the full mental checklist.

### `check:lockfile` — what it catches

Two-tier check:

1. **Fast custom check** (< 100 ms) — every `package.json` dep must have BOTH a root-deps entry AND a `node_modules/<dep>` entry in the lockfile. Catches the specific PR-274 failure mode where a new dep was added but the lockfile only got the declaration line, not the resolved-URL + integrity entry.
2. **Authoritative `npm ci --dry-run`** (3-5 s) — catches subtler drift: version mismatches, phantom entries, conflicting peer deps. Only runs if the fast check passes.

On failure, the script prints which packages drifted + the exact `npm install` + `git add package-lock.json` sequence to fix it on the PR branch.

---

## 7. Doppler / secrets

```bash
# Inspect
doppler secrets --project nexus --config <dev|stg|prd> --only-names         # list names only
doppler secrets get K --project nexus --config <env> --plain                 # value (raw — careful in shared terminals)

# Mutate
echo "<value>" | doppler secrets set K --project nexus --config <env> --no-interactive
doppler secrets delete K --project nexus --config <env> --yes

# Run a command with env injected
doppler run --project nexus --config <env> -- <command>                      # streams env into child process

# Mirror a secret across configs (prd → dev)
doppler secrets get K --project nexus --config prd --plain | \
  doppler secrets set K --project nexus --config dev --no-interactive

# Set DOPPLER_TOKEN for this terminal (no per-command --project flag needed)
export DOPPLER_TOKEN=$(doppler configure get token --plain)
```

**Tier classification + per-env placement** — see [`memory/platform/SECRETS.md`](../../memory/platform/SECRETS.md) section "Doppler inventory & environment strategy".

---

## 8. Git hooks

```bash
git config core.hooksPath .githooks    # one-time, per clone (and per worktree)
bash scripts/install-git-hooks.sh      # alternative — copies into .git/hooks/
```

The pre-push hook blocks pushes to branches whose PR is already MERGED (see [`docs/runbooks/git-multi-agent-collaboration.md`](git-multi-agent-collaboration.md)).

---

## 9. Repair codex-gateway routing (post-KVM-migration)

When `npm run diagnose:codex` returns `Cloudflare Tunnel cannot reach the codex-gateway container` AND Coolify says "Application not found" on the configured UUID, the gateway was migrated between KVMs but Doppler + Cloudflare didn't follow.

```bash
npm run repair:codex                       # DRY-RUN — prints the exact fixes
npm run repair:codex -- --apply            # apply: updates Doppler UUID + Cloudflare tunnel ingress + DNS CNAME
```

Three things the script auto-fixes:

1. **Doppler `COOLIFY_KVM4_CODEX_UUID`** — discovers the live codex-gateway on KVM4 by name-matching, updates the secret.
2. **Cloudflare tunnel ingress** for `codex-gw.<your-domain>` — points the `service:` field at `http://codex-gateway:3000` on the right tunnel.
3. **DNS CNAME** — repoints the CNAME at the correct `<tunnel-id>.cfargotunnel.com` if it's stale.

**Required env (in Doppler `prd`)**: `COOLIFY_KVM4_URL`, `COOLIFY_KVM4_API_TOKEN`, `CLOUDFLARE_API_TOKEN`.

**Token scopes the operator needs** (see [`docs/runbooks/cloudflare-admin-token.md`](cloudflare-admin-token.md) for the click-by-click):
- `Account:Cloudflare Tunnel:Edit`
- `Account:Account Settings:Read`
- `Zone:DNS:Edit` (specific zones only — not "All zones")
- `Zone:Zone:Read` (same zones)
- `User:User Details:Read`

After `--apply` succeeds the script waits 5s for Cloudflare propagation, then probes `/health` and reports. Re-run `npm run diagnose:codex` to confirm the 502 is gone.

### Migrate a Cloudflare hostname between tunnels

When `repair:codex` says the existing tunnel ingress is "already correct" but `/health` still 502s, the hostname is routed via the WRONG tunnel — likely a stale tunnel running on the old host. Use `migrate:tunnel` to move the hostname to the correct tunnel:

```bash
npm run migrate:tunnel -- \
  --hostname=codex-gw.coolifycloudtunnel.uk \
  --to-tunnel=nexus-fleet \
  --service=http://codex-gateway:3000               # dry-run by default

npm run migrate:tunnel -- \
  --hostname=codex-gw.coolifycloudtunnel.uk \
  --to-tunnel=nexus-fleet \
  --service=http://codex-gateway:3000 \
  --apply                                            # actually mutate
```

The script:
1. Resolves `--to-tunnel` by name (case-insensitive substring) — fails clearly if no match.
2. Auto-detects the source tunnel by walking every active tunnel's ingress (override with `--from-tunnel=NAME` when needed).
3. Removes the hostname entry from the source tunnel.
4. Inserts the hostname entry into the target tunnel BEFORE its catch-all (preserves catch-all).
5. Updates the DNS CNAME for the hostname to point at the target tunnel's `<id>.cfargotunnel.com`.
6. Waits 8s for CF propagation and smoke-tests `https://<hostname>/health`.

**Optional flags**: `--keep-source` (skip removal — useful for parallel-tunnel testing), `--skip-dns` (when DNS is already correct).

**Token scopes**: same as `repair:codex` — see [`docs/runbooks/cloudflare-admin-token.md`](cloudflare-admin-token.md).

---

## 10. Diagnose codex-gateway 502 incidents

```bash
npm run diagnose:codex                       # full read-only sweep — Coolify state + logs + /health + /health?deep=1
npm run diagnose:codex -- --probe-dispatch   # also fire a real dispatch (uses one Codex Pro plan call)
npm run diagnose:codex -- --logs-lines=500   # pull 500 log lines instead of 200
```

Hits four surfaces in one command and prints a verdict that maps the symptoms to a most-likely root cause:

| Symptom | Verdict and next steps |
|---|---|
| `Cloudflare` 502 + `/health` from outside fails | **`cloudflared` tunnel is down (configured outside Coolify)** — `docker ps \| grep cloudflared` on the Coolify host; check daemon + tunnel logs |
| Coolify state ≠ `running` | Container down — Start it from the Coolify UI; check Doppler for required env |
| ≥3 start markers in recent logs | Crash-loop — open Coolify UI logs and find the boot-time error |
| `Killed` / `out of memory` in logs | OOM during codex CLI spawn — raise the memory limit in Coolify (try 1.5–2GB) |
| `not logged in` / `auth.json` in logs | Codex auth.json expired — see [`docs/runbooks/codex-gateway-auth-rotation.md`](codex-gateway-auth-rotation.md) |
| Basic `/health` 200 but `/health?deep=1` reports `dispatchReady:false` | CLI binary or env is broken — restart the container; re-check |

**Required env (in Doppler `prd`)**: `COOLIFY_KVM4_URL`, `COOLIFY_KVM4_API_TOKEN`, `COOLIFY_KVM4_CODEX_UUID` (or `COOLIFY_KVM2_CODEX_UUID`), `CODEX_GATEWAY_URL`. `--probe-dispatch` additionally needs `CODEX_GATEWAY_BEARER_TOKEN` and one entry in `ALLOWED_USER_IDS`.

**Important topology note**: the **Cloudflare Tunnel is configured OUTSIDE Coolify** (see comments in [`services/codex-gateway/docker-compose.yaml`](../../services/codex-gateway/docker-compose.yaml)). `cloudflared` runs as a separate container attached to the shared external `coolify` network, mapping `codex-gw.<your-domain>` → `codex-gateway:3000`. A Cloudflare 502 with `server=cloudflare` + an HTML body is almost never an issue Coolify can show — it means `cloudflared` itself can't reach the origin. SSH to the host and inspect the `cloudflared` container directly. The diagnostic script catches the symptom; the fix lives in the cloudflared sidecar's logs + config.

---

## 11. Specialised / one-off scripts

Less-frequent commands that may show up during incidents, audits, or rollouts.

```bash
# Composio auth-config sync (after editing lib/oauth/providers.ts)
npx tsx scripts/sync-composio-auth-configs.ts

# PDF info-product experiment
npx tsx scripts/seed-pdf-experiment.ts                     # seed the experiment row + initial actions
npx tsx scripts/smoke-experiment.ts                        # end-to-end smoke (mocked LLM by default)

# Diagnose / repair
node scripts/diagnose-tasks-business-slug.mjs              # report tasks missing business_slug
bash scripts/scan-secrets.sh                               # repo-wide scan for committed-secret patterns

# Bootstrap helpers
bash scripts/bootstrap-agent-template.sh <slug>            # scaffold a new managed agent
bash scripts/bootstrap-memory-hq.sh                        # one-time setup of memory-hq locally

# Sync Doppler → Vercel env (legacy — Vercel deploy is disabled in lean mode)
bash scripts/sync-vercel-env.sh
```

---

## 12. Memory MCP server (recovery)

If `memory_atom` / `memory_search` MCP tools return 503 inside a Claude Code session:

```bash
# 1. Confirm env resolves
doppler run --project nexus --config dev -- bash -c 'echo "NEXUS_BASE_URL=$NEXUS_BASE_URL; TOKEN_SET=${MEMORY_HQ_TOKEN:+yes}"'

# 2. Confirm the endpoint is alive (expect 400 = auth ok, body invalid)
doppler run --project nexus --config dev -- bash -c 'curl -sS -o /dev/null -w "%{http_code}\n" -X POST "$NEXUS_BASE_URL/api/memory/event" -H "Authorization: Bearer $MEMORY_HQ_TOKEN" -H "Content-Type: application/json" -d "{}"'

# 3. If both pass but MCP still 503s, the MCP server cached the old URL at startup.
#    /exit the Claude Code session and start a new one — the MCP child re-reads Doppler.

# Fallback: write via CLI (fetches Doppler fresh per invocation)
doppler run --project nexus --config dev -- node .claude/skills/molecularmemory_local/cli.mjs --backend=github atom "<title>" --fact="..." --source=<ref>
```

The MCP server itself is registered in `~/.claude/settings.json` under `mcpServers.memory-hq`, pointing at `services/mcp-memory/dist/index.js`. To rebuild after pulling repo changes:

```bash
cd services/mcp-memory && npm run build
```

---

## See also

- [AGENTS.md](../../AGENTS.md) — operating principles for every agent + pre-commit checklist
- [memory/INDEX.md](../../memory/INDEX.md) — topic map across platform docs
- [docs/runbooks/lean-mode.md](lean-mode.md) — full Vercel→Coolify transition plan
- [docs/runbooks/doppler-coolify-sync.md](doppler-coolify-sync.md) — how Doppler injects env at container start
- [docs/runbooks/git-multi-agent-collaboration.md](git-multi-agent-collaboration.md) — stranded-commit prevention + worktree pattern
