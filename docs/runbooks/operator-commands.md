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
npm run check:all              # lint + tsc + retry-storm + sentry-config (one shot)
npm run lint                   # eslint
npx tsc --noEmit               # TypeScript only — fastest single check
npm run check:retry-storm      # blocks the 6 grep-detectable retry-storm patterns
npm run check:sentry-config    # blocks Sentry sample-rate regressions (2026-05-12 budget cap)
```

Every check exits non-zero on any finding. See [AGENTS.md "Pre-commit Checklist"](../../AGENTS.md) for the full mental checklist.

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

## 9. Specialised / one-off scripts

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

## 10. Memory MCP server (recovery)

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
