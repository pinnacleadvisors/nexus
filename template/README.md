# agent-template

GitHub template repo for projects that integrate with the **memory-hq** cross-project knowledge graph and follow the org's agent framework. Created via `pinnacleadvisors/nexus`'s `scripts/bootstrap-agent-template.sh`.

## Use this template

Click **"Use this template"** at the top of [pinnacleadvisors/agent-template](https://github.com/pinnacleadvisors/agent-template). Or via gh CLI:

```bash
gh repo create my-new-project --template pinnacleadvisors/agent-template --private
cd my-new-project
./scripts/setup.sh
```

You get instantly:

- `.claude/skills/molecularmemory_local/` — the CLI for writing atoms to memory-hq
- `.claude/hooks/check-write-size.sh` — Opus stream-timeout guard
- `.claude/hooks/skill-router.sh` — skill-routing hints
- `.claude/framework/AGENT-FRAMEWORK.md` — model-agnostic protocols
- `.claude/framework/ADAPTERS/CLAUDE-CODE.md` — Claude-specific overlay
- `CLAUDE.md` — drop-in for Claude Code sessions in this repo
- `AGENTS.md` — placeholder for **your** project-specific stack rules
- `task_plan.md` — placeholder for the active long-horizon plan
- `.github/workflows/sync-framework.yml` — daily auto-sync from memory-hq

## First-time setup (per-clone)

```bash
./scripts/setup.sh                  # sanity-checks Node version + prereqs
# Add MEMORY_HQ_TOKEN to your repo's GitHub Actions secrets (for the sync workflow)
# Add MEMORY_HQ_TOKEN to your local Doppler / env (for writing atoms locally)
```

After that, the sync workflow keeps `.claude/framework/` and `CLAUDE.md` fresh by opening a daily PR whenever memory-hq's framework changes.

## Writing atoms

```bash
node .claude/skills/molecularmemory_local/cli.mjs --backend=github \
  atom "Some durable fact" \
  --fact="Detailed explanation" \
  --source=https://example.com
```

Scope auto-fills from `git remote get-url origin`. See `.claude/framework/AGENT-FRAMEWORK.md` §4 for the full memory-hq protocol.

## What this template is **not**

- Not Nexus-specific. No `app/`, no Supabase migrations, no Next.js. If you need those, copy from `pinnacleadvisors/nexus` directly.
- Not opinionated about your stack. Add your own `package.json`, `pyproject.toml`, `Cargo.toml`, etc.
- Not auto-bootstrapped. `setup.sh` is a checklist — you still wire the secrets.

## Updating the template itself

The template repo is owned by `pinnacleadvisors/nexus`'s `scripts/bootstrap-agent-template.sh`. Re-run that script whenever you want to push fresh `.claude/`, `lib/molecular/`, or framework files into the template. Existing repos created from this template stay current via their own `sync-framework.yml`.
